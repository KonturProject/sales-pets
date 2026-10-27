/**
 * Бэкенд «Питомцев отделов продаж»: Google Apps Script + Google Sheets.
 * Хранит только факты (оплаты, воронку, штат, отсутствия); состояние питомцев считает страница.
 * Публичный GET отдаёт снимок, запись идёт POST-запросами с PIN в теле (JSON как text/plain).
 * Развёртывание и PIN — apps-script/README.md. Тесты гоняют этот же файл: apps-script/test/.
 *
 * Ответ POST: { ok: true, … } или { ok: false, error: 'invalid_pin' | 'locked' | 'bad_request' | 'server_error' }.
 * Все ячейки текстовые ('@'): иначе таблица превратит «2026-11-03» в дату, а номер счёта «000123» в число.
 */

const GROUPS = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const LEVELS = ['experienced', 'rookie1', 'rookie2'];
const ABSENCE_KINDS = ['vacation', 'sick', 'other'];
const TIME_ZONE = 'Europe/Moscow';
const MAX_PIN_FAILURES = 5;
const PIN_BLOCK_SEC = 600;
const MAX_IMPORT_DAYS = 62;
const MAX_COUNT = 10000;
const PIN_FORMAT = /^\d{4,12}$/;
const HIDDEN_REASON_MAX = 200;

/** Допустимые правки config (целые, включительно); календарь (startDate, endDate, nonWorking) не правится. */
const CONFIG_RANGES = {
  dailyNorm: [1, 1000],
  maxPiles: [1, 20],
  boredomBelow: [0, 100],
  sickDaysNoPay: [1, 30],
  sickPilesAbove: [0, 20],
  deathDaysNoPay: [1, 30],
};
/** Правок «с даты» (configChanges) не больше: ячейка листа не безразмерна. */
const CONFIG_CHANGES_MAX = 30;
const NORM_FIELDS = ['quality', 'long'];
const NORM_MAX = 50;
const STAGE_COUNT = 15;
const STAGE_THRESHOLD_MAX = 100000;
const OVERRIDE_KINDS = ['piles', 'medkits', 'toys'];
const OVERRIDE_DELTA_MAX = 20;
/** Предмет, который тратит РГ → вид строки в Overrides (тот же `kind`, что у движка). */
const ITEM_KINDS = { medkit: 'useMedkit', toy: 'useToy' };
const MAX_USES_PER_DAY = 20;
const REF_MAX = 64;

/** Листы и колонки; первая строка — заголовок, данные с второй. */
const SHEETS = {
  Payments: ['date', 'group', 'author', 'invoice'],
  Provisional: ['date', 'group', 'count'],
  Funnel: ['employeeId', 'date', 'quality', 'long'],
  Staff: ['id', 'name', 'shortName', 'group', 'hireDate', 'fireDate', 'baseLevel', 'hiddenFromRating', 'transfers', 'hiddenReason'],
  Absences: ['employeeId', 'kind', 'from', 'to'],
  Overrides: ['id', 'date', 'group', 'kind', 'delta', 'ref'],
  Settings: ['key', 'value'],
};

// ---------------------------------------------------------------- общие помощники

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Ошибка во входных данных: doPost превращает её в bad_request. */
function fail_() {
  const err = new Error('bad_request');
  err.badRequest = true;
  throw err;
}

function compare_(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function isGroup_(v) {
  return typeof v === 'string' && GROUPS.indexOf(v) >= 0;
}

function isCount_(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;
}

function isIntIn_(v, min, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isPlainObject_(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Так же, как normalizeName на странице: обрезать, схлопнуть пробелы, нижний регистр, «ё» как «е». */
function normalizeName_(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

function today_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
}

function daysInclusive_(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
}

// ---------------------------------------------------------------- таблицы

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Лист для записи: создаётся с заголовком при первой записи. */
function sheetFor_(name) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SHEETS[name].length).setNumberFormat('@').setValues([SHEETS[name]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function cellText_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v);
}

/** Строки данных листа как массивы строк; чтение не создаёт листов, пустые строки пропускаются. */
function readRows_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = spreadsheet_().getSpreadsheetTimeZone();
  return sheet
    .getRange(2, 1, last - 1, SHEETS[name].length)
    .getValues()
    .map(function (row) {
      return row.map(function (v) {
        return cellText_(v, tz);
      });
    })
    .filter(function (row) {
      return row.some(function (v) {
        return v !== '';
      });
    });
}

/** Заменяет все строки данных листа одним setValues; хвост старых строк очищается после записи. */
function writeRows_(name, rows) {
  const sheet = sheetFor_(name);
  const width = SHEETS[name].length;
  const oldLast = sheet.getLastRow();
  if (rows.length > 0) {
    const needed = rows.length + 1;
    if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    const range = sheet.getRange(2, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setValues(
      rows.map(function (row) {
        return row.map(function (v) {
          return v === null || v === undefined ? '' : String(v);
        });
      })
    );
  }
  if (oldLast > rows.length + 1) sheet.getRange(rows.length + 2, 1, oldLast - rows.length - 1, width).clearContent();
}

function readSettings_() {
  const out = Object.create(null);
  readRows_('Settings').forEach(function (r) {
    out[r[0]] = r[1];
  });
  return out;
}

function currentVersion_() {
  return Number(readSettings_().version) || 0;
}

/** Версия растёт последней в каждой записи: недописанный снимок при чтении сам исправится на следующем опросе. */
function bump_(patch) {
  const settings = readSettings_();
  const version = (Number(settings.version) || 0) + 1;
  settings.version = String(version);
  Object.keys(patch).forEach(function (k) {
    settings[k] = patch[k];
  });
  writeRows_(
    'Settings',
    Object.keys(settings).map(function (k) {
      return [k, settings[k]];
    })
  );
  return version;
}

/** Сотрудники вместе с причиной исключения из рейтинга (она не публична: в GET уходит publicStaff_). */
function readStaff_() {
  return readRows_('Staff').map(function (r) {
    let transfers = [];
    try {
      const parsed = JSON.parse(r[8] || '[]');
      if (Array.isArray(parsed)) transfers = parsed;
    } catch (err) {
      transfers = [];
    }
    return {
      id: r[0],
      name: r[1],
      shortName: r[2],
      group: r[3],
      hireDate: r[4] || null,
      fireDate: r[5] || null,
      baseLevel: r[6],
      hiddenFromRating: r[7].toLowerCase() === 'true',
      transfers: transfers,
      hiddenReason: r[9] || '',
    };
  });
}

function publicStaff_(e) {
  return { id: e.id, name: e.name, shortName: e.shortName, group: e.group, hireDate: e.hireDate, fireDate: e.fireDate, baseLevel: e.baseLevel, hiddenFromRating: e.hiddenFromRating, transfers: e.transfers };
}

function writeStaff_(staff) {
  writeRows_(
    'Staff',
    staff.map(function (e) {
      return [e.id, e.name, e.shortName, e.group, e.hireDate || '', e.fireDate || '', e.baseLevel, e.hiddenFromRating ? 'true' : 'false', JSON.stringify(e.transfers), e.hiddenReason];
    })
  );
}

/** Сохранённый config; испорченная руками ячейка (не JSON, не объект) читается как {}. */
function parseConfig_(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return isPlainObject_(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

/** Правки config по датам: [{from, config}] по возрастанию from; не-JSON, не массив и негодные записи (ячейку могли испортить руками) отбрасываются. */
function parseConfigChanges_(text) {
  let parsed;
  try {
    parsed = JSON.parse(text || '[]');
  } catch (err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(function (e) {
      return isPlainObject_(e) && isDate_(e.from) && isPlainObject_(e.config);
    })
    .sort(function (a, b) {
      return compare_(a.from, b.from);
    });
}

function readAbsences_() {
  return readRows_('Absences').map(function (r) {
    return { employeeId: r[0], kind: r[1], from: r[2], to: r[3] || null };
  });
}

/** Ручные правки админа и расходы РГ по возрастанию id; `ref` (ключ повтора расхода) остаётся только здесь, в GET не уходит. */
function readOverrides_() {
  return readRows_('Overrides')
    .map(function (r) {
      return { id: Number(r[0]) || 0, date: r[1], group: r[2], kind: r[3], delta: Number(r[4]), ref: r[5] };
    })
    .sort(function (a, b) {
      return a.id - b.id;
    });
}

function appendOverride_(rows, date, group, kind, delta, ref) {
  const id =
    rows.reduce(function (max, r) {
      return Math.max(max, Number(r[0]) || 0);
    }, 0) + 1;
  rows.push([String(id), date, group, kind, String(delta), ref]);
  writeRows_('Overrides', rows);
  return id;
}

// ---------------------------------------------------------------- PIN

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) {
      return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1);
    })
    .join('');
}

function hashPin_(pin, salt) {
  return salt + '$' + sha256Hex_(salt + ':' + pin);
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function matchesHash_(pin, stored) {
  if (typeof stored !== 'string') return false;
  const i = stored.indexOf('$');
  return i > 0 && sameText_(hashPin_(pin, stored.slice(0, i)), stored);
}

/** Сохраняет админ-PIN солёным хешем; сам PIN нигде не хранится. */
function storePin_(pin) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN_HASH', hashPin_(pin, Utilities.getUuid()));
}

function matchesAdminPin_(pin) {
  return matchesHash_(pin, PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH'));
}

function readGroupHashes_() {
  try {
    const parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty('GROUP_PINS') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function groupOfPin_(pin) {
  const hashes = readGroupHashes_();
  let found = null;
  GROUPS.forEach(function (g) {
    if (matchesHash_(pin, hashes[g])) found = g;
  });
  return found;
}

/** Секунд до конца блокировки для связки PIN (`pin` — админ, `group_pin_<группа>` — каждая группа отдельно); 0 — не заблокировано. */
function lockRemainingSec_(prefix) {
  const until = Number(CacheService.getScriptCache().get(prefix + '_lock_until'));
  if (!until) return 0;
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/** Записывает неверный PIN; на пятом подряд ставит блокировку и возвращает её длину в секундах (иначе 0). */
function recordPinFailure_(prefix) {
  const cache = CacheService.getScriptCache();
  const fails = (Number(cache.get(prefix + '_fails')) || 0) + 1;
  if (fails < MAX_PIN_FAILURES) {
    cache.put(prefix + '_fails', String(fails), PIN_BLOCK_SEC);
    return 0;
  }
  cache.put(prefix + '_lock_until', String(Date.now() + PIN_BLOCK_SEC * 1000), PIN_BLOCK_SEC);
  cache.remove(prefix + '_fails');
  return PIN_BLOCK_SEC;
}

/**
 * { denied } с готовым ответом или { group } (для админа null). PIN группы проверяется только против хеша заявленной
 * `body.group` и считает ошибки отдельно по каждой группе: общий счётчик давал бы перебор 6-значных PIN чужих групп,
 * сбрасываясь верным входом «своей». PIN не строка — просто отказ, в счётчик не идёт.
 */
function authorize_(who, body) {
  if (who === 'group' && !isGroup_(body.group)) return { denied: { ok: false, error: 'bad_request' } };
  const prefix = who === 'admin' ? 'pin' : 'group_pin_' + body.group;
  const waitSec = lockRemainingSec_(prefix);
  if (waitSec > 0) return { denied: { ok: false, error: 'locked', retryAfterSec: waitSec } };
  const given = body[who === 'admin' ? 'pin' : 'groupPin'];
  if (typeof given !== 'string') return { denied: { ok: false, error: 'invalid_pin' } };
  const group = who === 'admin' ? null : body.group;
  const verified = who === 'admin' ? matchesAdminPin_(given) : matchesHash_(given, readGroupHashes_()[group]);
  if (!verified) {
    const blockSec = recordPinFailure_(prefix);
    return { denied: blockSec > 0 ? { ok: false, error: 'locked', retryAfterSec: blockSec } : { ok: false, error: 'invalid_pin' } };
  }
  CacheService.getScriptCache().remove(prefix + '_fails');
  return { group: group };
}

/** Шесть цифр из случайных байтов UUID; байты ≥ 250 отбрасываются, чтобы цифры были равновероятны. */
function randomPin_() {
  let digits = '';
  while (digits.length < 6) {
    const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    for (let i = 0; i + 1 < hex.length && digits.length < 6; i += 2) {
      const byte = parseInt(hex.substr(i, 2), 16);
      if (byte < 250) digits += String(byte % 10);
    }
  }
  return digits;
}

// ---------------------------------------------------------------- действия

function loginAction_() {
  return { ok: true };
}

function changePinAction_(body) {
  const pin = body.newPin;
  if (typeof pin !== 'string' || !PIN_FORMAT.test(pin) || groupOfPin_(pin) !== null) fail_();
  storePin_(pin);
  return { ok: true };
}

function setGroupPinsAction_() {
  const groupPins = {};
  const hashes = {};
  const used = [];
  GROUPS.forEach(function (g) {
    let pin;
    do {
      pin = randomPin_();
    } while (used.indexOf(pin) >= 0 || matchesAdminPin_(pin));
    used.push(pin);
    groupPins[g] = pin;
    hashes[g] = hashPin_(pin, Utilities.getUuid());
  });
  PropertiesService.getScriptProperties().setProperty('GROUP_PINS', JSON.stringify(hashes));
  return { ok: true, groupPins: groupPins };
}

function groupLoginAction_(body, auth) {
  return { ok: true, group: auth.group };
}

function setProvisionalAction_(body) {
  const date = body.date;
  const group = body.group;
  if (!isDate_(date) || date > today_() || !isGroup_(group) || !isCount_(body.count)) fail_();
  const through = readSettings_().paymentsImportedThrough;
  if (through && date <= through) fail_();
  const rows = readRows_('Provisional');
  const row = rows.filter(function (r) {
    return r[0] === date && r[1] === group;
  })[0];
  if (row) row[2] = String(body.count);
  else rows.push([date, group, String(body.count)]);
  rows.sort(function (a, b) {
    return compare_(a[0], b[0]) || compare_(a[1], b[1]);
  });
  writeRows_('Provisional', rows);
  return { ok: true, version: bump_({}) };
}

function importPaymentsAction_(body) {
  const from = body.from;
  const to = body.to;
  if (!isDate_(from) || !isDate_(to) || from > to || to >= today_() || daysInclusive_(from, to) > MAX_IMPORT_DAYS) fail_();
  if (!Array.isArray(body.rows)) fail_();
  // Форма строки проверяется у всех (мусор отклоняет файл), а выгрузка «хвостом» (сегодня, прошлый месяц) не ломает
  // импорт: строки вне периода отбрасываются и считаются в ignored.
  const valid = body.rows.map(function (r) {
    const ok =
      r && typeof r === 'object' && isDate_(r.date) && isGroup_(r.group) &&
      typeof r.author === 'string' && typeof r.invoice === 'string' && r.invoice.trim() !== '';
    if (!ok) fail_();
    return [r.date, r.group, r.author.trim(), r.invoice.trim()];
  });
  const added = valid.filter(function (r) {
    return r[0] >= from && r[0] <= to;
  });
  const inPeriod = function (r) {
    return r[0] >= from && r[0] <= to;
  };
  const old = readRows_('Payments');
  const kept = old.filter(function (r) {
    return !inPeriod(r);
  });
  const provisional = readRows_('Provisional');
  const provisionalKept = provisional.filter(function (r) {
    return !inPeriod(r);
  });
  const removedProvisional = provisional.filter(inPeriod).reduce(function (sum, r) {
    return sum + Number(r[2]);
  }, 0);
  const summary = {
    added: added.length,
    ignored: valid.length - added.length,
    removed: old.length - kept.length,
    removedProvisional: removedProvisional,
  };
  if (body.dryRun === true) return Object.assign({ ok: true, dryRun: true }, summary);

  const payments = kept.concat(added).sort(function (a, b) {
    return compare_(a[0], b[0]) || compare_(a[3], b[3]) || compare_(a[1], b[1]) || compare_(a[2], b[2]);
  });
  writeRows_('Payments', payments);
  if (provisionalKept.length !== provisional.length) writeRows_('Provisional', provisionalKept);
  const previous = readSettings_().paymentsImportedThrough;
  const version = bump_({ paymentsImportedThrough: previous && previous > to ? previous : to });
  return Object.assign({ ok: true, version: version }, summary);
}

function importFunnelAction_(body) {
  const through = body.through;
  if (!isDate_(through) || through >= today_() || !Array.isArray(body.rows)) fail_();
  const staff = readStaff_();
  const byName = Object.create(null);
  staff.forEach(function (e) {
    byName[normalizeName_(e.name)] = e.id;
  });
  const rank = Object.create(null);
  staff.forEach(function (e, i) {
    rank[e.id] = i;
  });
  // Файл воронки содержит колонки до конца месяца (нули без данных): дни после through отбрасываются и считаются в
  // ignored, а мусор (неизвестное ФИО, плохая дата, счётчики) по-прежнему отклоняет весь файл.
  const valid = body.rows.map(function (r) {
    const employeeId = r && typeof r === 'object' && typeof r.name === 'string' ? byName[normalizeName_(r.name)] : undefined;
    if (!employeeId || !isDate_(r.date) || !isCount_(r.quality) || !isCount_(r.long)) fail_();
    return [employeeId, r.date, String(r.quality), String(r.long)];
  });
  const incoming = valid.filter(function (r) {
    return r[1] <= through;
  });
  const merged = Object.create(null);
  readRows_('Funnel').concat(incoming).forEach(function (r) {
    merged[r[0] + '|' + r[1]] = r;
  });
  const rows = Object.keys(merged)
    .map(function (k) {
      return merged[k];
    })
    .sort(function (a, b) {
      const ra = a[0] in rank ? rank[a[0]] : 1e9;
      const rb = b[0] in rank ? rank[b[0]] : 1e9;
      return compare_(a[1], b[1]) || ra - rb || compare_(a[0], b[0]);
    });
  writeRows_('Funnel', rows);
  return { ok: true, version: bump_({ funnelThrough: through }), added: incoming.length, ignored: valid.length - incoming.length };
}

/** «Фамилия И.» из полного ФИО; одно слово остаётся как есть. */
function defaultShortName_(name) {
  const parts = name.split(' ');
  return parts.length > 1 ? parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.' : name;
}

function optionalDate_(v) {
  if (v !== null && !isDate_(v)) fail_();
  return v;
}

function validTransfers_(v) {
  if (!Array.isArray(v)) fail_();
  return v
    .map(function (t) {
      if (!t || typeof t !== 'object' || !isDate_(t.date) || !isGroup_(t.group)) fail_();
      return { date: t.date, group: t.group };
    })
    .sort(function (a, b) {
      return compare_(a.date, b.date);
    });
}

function setStaffAction_(body) {
  if (!Array.isArray(body.staff)) fail_();
  const staff = readStaff_();
  const byKey = Object.create(null);
  let maxId = 0;
  staff.forEach(function (e) {
    byKey[normalizeName_(e.name)] = e;
    const n = /^e(\d+)$/.exec(e.id);
    if (n) maxId = Math.max(maxId, Number(n[1]));
  });
  const seen = Object.create(null);
  let added = 0;
  let updated = 0;
  body.staff.forEach(function (item) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') fail_();
    const name = item.name.trim().replace(/\s+/g, ' ');
    const key = normalizeName_(name);
    if (name === '' || seen[key]) fail_();
    seen[key] = true;
    let e = byKey[key];
    if (e) {
      updated++;
    } else {
      if (!isGroup_(item.group)) fail_();
      e = { id: 'e' + ++maxId, name: name, shortName: defaultShortName_(name), group: item.group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], hiddenReason: '' };
      byKey[key] = e;
      staff.push(e);
      added++;
    }
    if (item.group !== undefined) {
      if (!isGroup_(item.group)) fail_();
      e.group = item.group;
    }
    if (item.shortName !== undefined) {
      if (typeof item.shortName !== 'string' || item.shortName.trim() === '') fail_();
      e.shortName = item.shortName.trim();
    }
    if (item.hireDate !== undefined) e.hireDate = optionalDate_(item.hireDate);
    if (item.fireDate !== undefined) e.fireDate = optionalDate_(item.fireDate);
    if (item.baseLevel !== undefined) {
      if (LEVELS.indexOf(item.baseLevel) < 0) fail_();
      e.baseLevel = item.baseLevel;
    }
    if (item.hiddenFromRating !== undefined) {
      if (typeof item.hiddenFromRating !== 'boolean') fail_();
      e.hiddenFromRating = item.hiddenFromRating;
    }
    if (item.hiddenReason !== undefined) {
      if (typeof item.hiddenReason !== 'string') fail_();
      e.hiddenReason = item.hiddenReason.trim();
      if (e.hiddenReason.length > HIDDEN_REASON_MAX) fail_();
    }
    // скрытие требует причины (прежняя остаётся, если новую не прислали), снятие флага её стирает
    if (item.hiddenFromRating !== undefined || item.hiddenReason !== undefined) {
      if (!e.hiddenFromRating) e.hiddenReason = '';
      else if (e.hiddenReason === '') fail_();
    }
    if (item.transfers !== undefined) e.transfers = validTransfers_(item.transfers);
  });
  if (added + updated === 0) return { ok: true, version: currentVersion_(), added: 0, updated: 0 };
  writeStaff_(staff);
  return { ok: true, version: bump_({}), added: added, updated: updated };
}

/** Причины исключения из рейтинга: в публичный GET они не попадают, админ читает их отдельно. */
function getPrivateAction_() {
  const hiddenReasons = {};
  readStaff_().forEach(function (e) {
    if (e.hiddenFromRating && e.hiddenReason !== '') hiddenReasons[e.id] = e.hiddenReason;
  });
  return { ok: true, hiddenReasons: hiddenReasons };
}

function validThresholds_(v) {
  if (!Array.isArray(v) || v.length !== STAGE_COUNT) return false;
  for (let i = 0; i < v.length; i++) {
    if (!isIntIn_(v[i], 1, STAGE_THRESHOLD_MAX) || (i > 0 && v[i] <= v[i - 1])) return false;
  }
  return true;
}

/** Сливает частичные нормы по уровням в сохранённые; пустой уровень или поле вне quality|long — bad_request. */
function mergeNorms_(base, patch) {
  if (!isPlainObject_(patch) || Object.keys(patch).length === 0) fail_();
  const out = isPlainObject_(base) ? base : {};
  Object.keys(patch).forEach(function (level) {
    const fields = isPlainObject_(patch[level]) ? Object.keys(patch[level]) : [];
    if (LEVELS.indexOf(level) < 0 || fields.length === 0) fail_();
    const norm = isPlainObject_(out[level]) ? out[level] : {};
    fields.forEach(function (f) {
      if (NORM_FIELDS.indexOf(f) < 0 || !isIntIn_(patch[level][f], 0, NORM_MAX)) fail_();
      norm[f] = patch[level][f];
    });
    out[level] = norm;
  });
  return out;
}

/** Проверяет и вносит патч в `target`; пороги стадий — только когда они разрешены (на всю игру, не с даты). Негодное — bad_request. */
function applyConfigPatch_(target, patch, allowThresholds) {
  Object.keys(patch).forEach(function (k) {
    const v = patch[k];
    if (Object.prototype.hasOwnProperty.call(CONFIG_RANGES, k)) {
      if (!isIntIn_(v, CONFIG_RANGES[k][0], CONFIG_RANGES[k][1])) fail_();
      target[k] = v;
    } else if (k === 'norms') {
      target.norms = mergeNorms_(target.norms, v);
    } else if (k === 'stageThresholds' && allowThresholds) {
      if (!validThresholds_(v)) fail_();
      target.stageThresholds = v;
    } else {
      fail_();
    }
  });
}

/** Правка на всю игру отменяет записи по датам для тех же полей (нормы — по уровню и полю); опустевшие записи удаляются. */
function stripConfigFields_(changes, patch) {
  changes.forEach(function (e) {
    Object.keys(patch).forEach(function (k) {
      if (k === 'norms') {
        Object.keys(patch.norms).forEach(function (level) {
          if (!isPlainObject_(e.config.norms) || !isPlainObject_(e.config.norms[level])) return;
          Object.keys(patch.norms[level]).forEach(function (f) {
            delete e.config.norms[level][f];
          });
          if (Object.keys(e.config.norms[level]).length === 0) delete e.config.norms[level];
        });
        if (isPlainObject_(e.config.norms) && Object.keys(e.config.norms).length === 0) delete e.config.norms;
      } else if (k !== 'stageThresholds') {
        delete e.config[k];
      }
    });
  });
  return changes.filter(function (e) {
    return Object.keys(e.config).length > 0;
  });
}

/** setConfig: без `from` (нет или null) — на всю игру; с `from` — правка, действующая с этой даты (без порогов стадий). */
function setConfigAction_(body) {
  const patch = body.config;
  if (!isPlainObject_(patch) || Object.keys(patch).length === 0) fail_();
  const settings = readSettings_();
  const config = parseConfig_(settings.config);
  let changes = parseConfigChanges_(settings.configChanges);
  if (body.from === undefined || body.from === null) {
    applyConfigPatch_(config, patch, true);
    changes = stripConfigFields_(changes, patch);
  } else {
    if (!isDate_(body.from)) fail_();
    let entry = null;
    changes.forEach(function (e) {
      if (entry === null && e.from === body.from) entry = e;
    });
    if (entry === null) {
      if (changes.length >= CONFIG_CHANGES_MAX) fail_();
      entry = { from: body.from, config: {} };
      changes.push(entry);
      changes.sort(function (a, b) {
        return compare_(a.from, b.from);
      });
    }
    applyConfigPatch_(entry.config, patch, false);
  }
  return {
    ok: true,
    version: bump_({ config: JSON.stringify(config), configChanges: JSON.stringify(changes) }),
    config: config,
    configChanges: changes,
  };
}

function removeConfigChangeAction_(body) {
  if (!isDate_(body.from)) fail_();
  const changes = parseConfigChanges_(readSettings_().configChanges);
  const kept = changes.filter(function (e) {
    return e.from !== body.from;
  });
  if (kept.length === changes.length) fail_();
  return { ok: true, version: bump_({ configChanges: JSON.stringify(kept) }), configChanges: kept };
}

/** Ручная правка админа: дельта к кучкам, аптечкам или игрушкам группы на дату (не позже сегодня). Исправляется компенсирующей правкой. */
function setOverrideAction_(body) {
  if (!isDate_(body.date) || body.date > today_() || !isGroup_(body.group)) fail_();
  if (OVERRIDE_KINDS.indexOf(body.kind) < 0 || body.delta === 0 || !isIntIn_(body.delta, -OVERRIDE_DELTA_MAX, OVERRIDE_DELTA_MAX)) fail_();
  const rows = readRows_('Overrides');
  const id = appendOverride_(rows, body.date, body.group, body.kind, body.delta, '');
  return { ok: true, version: bump_({}), id: id };
}

/**
 * Расход предмета РГ. Группа — из проверенного PIN, дата — сегодня на сервере, остаток сервер не знает (его считает движок).
 * `ref` — случайная строка клиента: повтор того же запроса той же группы ничего не пишет и версию не двигает.
 */
function useItemAction_(body, auth) {
  const item = body.item;
  const ref = body.ref;
  if (typeof item !== 'string' || !Object.prototype.hasOwnProperty.call(ITEM_KINDS, item)) fail_();
  if (typeof ref !== 'string' || ref === '' || ref.length > REF_MAX) fail_();
  const group = auth.group;
  const kind = ITEM_KINDS[item];
  const rows = readRows_('Overrides');
  const same = rows.filter(function (r) {
    return r[2] === group && r[5] === ref;
  })[0];
  if (same) return { ok: true, version: currentVersion_(), id: Number(same[0]), duplicate: true };
  const date = today_();
  const usedToday = rows.filter(function (r) {
    return r[1] === date && r[2] === group && (r[3] === 'useMedkit' || r[3] === 'useToy');
  }).length;
  if (usedToday >= MAX_USES_PER_DAY) fail_();
  const id = appendOverride_(rows, date, group, kind, 1, ref);
  return { ok: true, version: bump_({}), id: id };
}

function setAbsenceAction_(body) {
  const employeeId = body.employeeId;
  const known = typeof employeeId === 'string' && readStaff_().some(function (e) {
    return e.id === employeeId;
  });
  if (!known || ABSENCE_KINDS.indexOf(body.kind) < 0 || !isDate_(body.from)) fail_();
  const to = body.to === undefined ? null : body.to;
  if (to !== null && (!isDate_(to) || to < body.from)) fail_();
  const rows = readRows_('Absences');
  const row = rows.filter(function (r) {
    return r[0] === employeeId && r[2] === body.from;
  })[0];
  if (row) {
    row[1] = body.kind;
    row[3] = to || '';
  } else {
    rows.push([employeeId, body.kind, body.from, to || '']);
  }
  writeRows_('Absences', rows);
  return { ok: true, version: bump_({}) };
}

function removeAbsenceAction_(body) {
  if (typeof body.employeeId !== 'string' || !isDate_(body.from)) fail_();
  const rows = readRows_('Absences');
  const kept = rows.filter(function (r) {
    return !(r[0] === body.employeeId && r[2] === body.from);
  });
  const removed = rows.length - kept.length;
  if (removed === 0) return { ok: true, version: currentVersion_(), removed: 0 };
  writeRows_('Absences', kept);
  return { ok: true, version: bump_({}), removed: removed };
}

/** who: чей PIN нужен — 'admin' (поле pin) или 'group' (поле groupPin). Админ-действия PIN группы не открывает. */
const ACTIONS_ = {
  login: { who: 'admin', run: loginAction_ },
  changePin: { who: 'admin', run: changePinAction_ },
  setGroupPins: { who: 'admin', run: setGroupPinsAction_ },
  groupLogin: { who: 'group', run: groupLoginAction_ },
  setProvisional: { who: 'admin', run: setProvisionalAction_ },
  importPayments: { who: 'admin', run: importPaymentsAction_ },
  importFunnel: { who: 'admin', run: importFunnelAction_ },
  setStaff: { who: 'admin', run: setStaffAction_ },
  getPrivate: { who: 'admin', run: getPrivateAction_ },
  setConfig: { who: 'admin', run: setConfigAction_ },
  removeConfigChange: { who: 'admin', run: removeConfigChangeAction_ },
  setOverride: { who: 'admin', run: setOverrideAction_ },
  useItem: { who: 'group', run: useItemAction_ },
  setAbsence: { who: 'admin', run: setAbsenceAction_ },
  removeAbsence: { who: 'admin', run: removeAbsenceAction_ },
};

// ---------------------------------------------------------------- точки входа

function handlePost_(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : undefined);
  } catch (err) {
    return { ok: false, error: 'bad_request' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_request' };
  const action = body.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS_, action)) return { ok: false, error: 'bad_request' };
  const def = ACTIONS_[action];
  return withLock_(function () {
    const auth = authorize_(def.who, body);
    if (auth.denied) return auth.denied;
    try {
      return def.run(body, auth);
    } catch (err) {
      if (err && err.badRequest) return { ok: false, error: 'bad_request' };
      throw err;
    }
  });
}

function doPost(e) {
  try {
    return jsonResponse_(handlePost_(e));
  } catch (err) {
    console.error(String((err && err.stack) || err));
    return jsonResponse_({ ok: false, error: 'server_error' });
  }
}

/**
 * Публичный снимок: ФИО и группы, оплаты {date, group, author, invoice}, воронка, отсутствия, правки и расходы {id, date, group, kind, delta}.
 * Сумм, хешей, солей и `ref` расходов в нём нет. `config` — то, что сохранил setConfig (иначе {}), `configChanges` — его правки «с даты» [{from, config}] (иначе []); причин исключения из рейтинга здесь нет (getPrivate).
 * `?since=<версия>` при той же версии отдаёт {unchanged, version, serverNow}: «сейчас» нужно клиенту, чтобы заметить смену суток без новой версии.
 */
function doGet(e) {
  try {
    const settings = readSettings_();
    const version = Number(settings.version) || 0;
    const since = e && e.parameter ? e.parameter.since : undefined;
    const serverNow = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss'+03:00'");
    if (typeof since === 'string' && /^\d+$/.test(since) && Number(since) === version) return jsonResponse_({ ok: true, unchanged: true, version: version, serverNow: serverNow });
    return jsonResponse_({
      ok: true,
      version: version,
      serverNow: serverNow,
      funnelThrough: settings.funnelThrough || null,
      paymentsImportedThrough: settings.paymentsImportedThrough || null,
      config: parseConfig_(settings.config),
      configChanges: parseConfigChanges_(settings.configChanges),
      staff: readStaff_().map(publicStaff_),
      absences: readAbsences_(),
      payments: readRows_('Payments').map(function (r) {
        return { date: r[0], group: r[1], author: r[2], invoice: r[3] };
      }),
      provisional: readRows_('Provisional').map(function (r) {
        return { date: r[0], group: r[1], count: Number(r[2]) };
      }),
      funnel: readRows_('Funnel').map(function (r) {
        return { employeeId: r[0], date: r[1], quality: Number(r[2]), long: Number(r[3]) };
      }),
      overrides: readOverrides_().map(function (o) {
        return { id: o.id, date: o.date, group: o.group, kind: o.kind, delta: o.delta };
      }),
    });
  } catch (err) {
    console.error(String((err && err.stack) || err));
    return jsonResponse_({ ok: false, error: 'server_error' });
  }
}

// ---------------------------------------------------------------- запуск вручную из редактора Apps Script

/** Создаёт все листы с заголовками (один раз после указания SPREADSHEET_ID). */
function setupSpreadsheet() {
  Object.keys(SHEETS).forEach(sheetFor_);
}

/** Задаёт первый админ-PIN из свойства INITIAL_PIN и стирает его; повторно PIN меняется через changePin. */
function initAdminPin() {
  const props = PropertiesService.getScriptProperties();
  const pin = props.getProperty('INITIAL_PIN');
  props.deleteProperty('INITIAL_PIN');
  if (props.getProperty('ADMIN_PIN_HASH')) throw new Error('Админ-PIN уже задан; его меняет действие changePin.');
  if (!pin || !PIN_FORMAT.test(pin)) throw new Error('Положите в свойство INITIAL_PIN от 4 до 12 цифр и запустите функцию снова.');
  storePin_(pin);
}

/** Поднимает версию снимка после правки листов руками, чтобы открытые страницы перечитали данные. */
function bumpVersion() {
  return withLock_(function () {
    return bump_({});
  });
}
