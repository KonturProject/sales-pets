/**
 * Прогоняет настоящий apps-script/Code.gs в Node поверх подделок сервисов Google (SpreadsheetApp,
 * PropertiesService, CacheService, LockService, Utilities, ContentService): так бэкенд тестируется и
 * поднимается локально (tools/mock-backend.mjs) без таблицы и без публикации.
 *
 * Имитируется только то, что нужно Code.gs. Часовой пояс — Europe/Moscow (UTC+3, без перевода часов).
 * Подделка листа повторяет две ловушки настоящих таблиц, на которых легко споткнуться:
 * строка вида «2026-11-03» в ячейке без текстового формата превращается в дату, а «12345» — в число.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CODE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'Code.gs');
const MOSCOW_OFFSET_MS = 3 * 3600 * 1000;

/** Админ-PIN тестового бэкенда; в боевом развёртывании PIN задаёт человек, в репозитории его нет. */
export const TEST_ADMIN_PIN = '123456';

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Utilities.formatDate для шаблонов, которые использует Code.gs; всегда время Москвы. */
function formatDate(date, _tz, pattern) {
  const d = new Date(date.getTime() + MOSCOW_OFFSET_MS);
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (token, literal) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'yyyy': return pad(d.getUTCFullYear(), 4);
      case 'MM': return pad(d.getUTCMonth() + 1);
      case 'dd': return pad(d.getUTCDate());
      case 'HH': return pad(d.getUTCHours());
      case 'mm': return pad(d.getUTCMinutes());
      case 'ss': return pad(d.getUTCSeconds());
      default: return token;
    }
  });
}

class FakeSheet {
  constructor() {
    this.rows = [];
    this.maxRows = 1000;
    this.maxColumns = 26;
    this.textCells = new Set();
    /** Сколько раз писали диапазон через setValues (импорт обязан писать одним махом). */
    this.setValuesCalls = 0;
  }
  /** Как в Google: последняя строка с непустым значением (пустая строка значением не считается). */
  getLastRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) if ((this.rows[r] ?? []).some((v) => v !== '' && v !== undefined)) return r + 1;
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  setFrozenRows() {}
  appendRow(values) {
    const row = this.getLastRow() + 1;
    if (row > this.maxRows) this.maxRows = row;
    this.getRange(row, 1, 1, values.length).setValues([values]);
  }
  /** Ячейка с текстовым форматом хранит текст; без него «2026-11-03» становится датой, «12345» — числом. */
  coerce(r, c, v) {
    if (v === null || v === undefined) return '';
    if (this.textCells.has(`${r},${c}`)) return String(v);
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(Date.parse(`${v}T00:00:00+03:00`));
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    }
    return v;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1 || row + numRows - 1 > sheet.maxRows || col + numCols - 1 > sheet.maxColumns) {
      throw new Error('The coordinates or dimensions of the range are invalid.');
    }
    const put = (r, c, value) => {
      while (sheet.rows.length < r) sheet.rows.push([]);
      sheet.rows[r - 1][c - 1] = sheet.coerce(r, c, value);
    };
    return {
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) line.push((sheet.rows[row - 1 + r] || [])[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValue: (value) => put(row, col, value),
      setValues: (values) => {
        if (values.length !== numRows || values.some((line) => line.length !== numCols)) throw new Error('The number of rows or columns in the data does not match the range.');
        sheet.setValuesCalls++;
        values.forEach((line, r) => line.forEach((value, c) => put(row + r, col + c, value)));
      },
      clearContent() {
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) if (sheet.rows[row - 1 + r]) sheet.rows[row - 1 + r][col - 1 + c] = '';
      },
      setNumberFormat(format) {
        if (format !== '@') return this;
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) sheet.textCells.add(`${row + r},${col + c}`);
        return this;
      },
      setFontWeight() { return this; },
    };
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.startAt]  «сейчас» (мс); по умолчанию четверг 2026-11-12, 10:00 по Москве
 * @param {boolean} [options.realClock]  идти по настоящим часам (для локального мок-сервера)
 * @param {string|null} [options.adminPin]  админ-PIN; null — не задавать
 */
export function loadBackend({ startAt = Date.parse('2026-11-12T10:00:00+03:00'), realClock = false, adminPin = TEST_ADMIN_PIN } = {}) {
  const clock = { offset: 0, fixed: startAt };
  const now = () => (realClock ? Date.now() + clock.offset : clock.fixed + clock.offset);

  // Date, который идёт по поддельным часам (как Apps Script, читает ISO без пояса как московское время).
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() { return now(); }
  }

  const sheets = new Map();
  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name) ?? null,
    insertSheet: (name) => { const s = new FakeSheet(); sheets.set(name, s); return s; },
    getSpreadsheetTimeZone: () => 'Europe/Moscow',
  };
  const props = new Map([['SPREADSHEET_ID', 'fake-spreadsheet']]);
  const cacheStore = new Map();

  const sandbox = {
    console,
    Date: FakeDate,
    Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const hit = cacheStore.get(k);
          if (!hit || hit.expires <= now()) { cacheStore.delete(k); return null; }
          return hit.value;
        },
        put: (k, v, ttlSec = 600) => { cacheStore.set(k, { value: String(v), expires: now() + ttlSec * 1000 }); },
        remove: (k) => { cacheStore.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_alg, input) => Array.from(crypto.createHash('sha256').update(String(input), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate,
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), sandbox, { filename: 'Code.gs' });
  if (adminPin !== null) sandbox.storePin_(adminPin);

  return {
    /** Публичный GET; `parameter` — как query-параметры. */
    get: (parameter = {}) => JSON.parse(sandbox.doGet({ parameter }).getContent()),
    /** POST с JSON-телом (страница шлёт его как text/plain). */
    post: (body) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    /** Сырое тело — для проверок на мусор. */
    postRaw: (contents) => JSON.parse(sandbox.doPost({ postData: { contents } }).getContent()),
    /** Запрос вообще без тела. */
    postEmpty: () => JSON.parse(sandbox.doPost({}).getContent()),
    /** Вызов функции верхнего уровня Code.gs. */
    run: (name, ...args) => sandbox[name](...args),
    advance: (ms) => { clock.offset += ms; },
    now,
    props,
    sheet: (name) => sheets.get(name) ?? null,
  };
}
