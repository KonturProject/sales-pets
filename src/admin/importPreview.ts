import { serverToday, type Snapshot } from '@/data/api';
import type { DateStr, GroupCode } from '@/engine/types';
import { describeChange } from './configPreview';
import { errorText, h, ruDate } from './dom';
import { dayChangeText, effectsOf } from './effects';
import { correctionItems, correctionViews, dayResults, type EmployeeLine, type Kind } from './results';
import { INTERRUPTED_TEXT, STALE_TEXT, WriteRefused, type FlowView, type ResultsFlow } from './resultsFlow';
import { correctionLine, shortDate, staleLine } from './resultsText';
import { renderResults } from './resultsView';

/** Снимок «как будто файл уже загружен» и день, за который показывается таблица. */
export interface Computed {
  /** свежий снимок сервера */
  before: Snapshot;
  /** он же после загрузки файла (`withFunnelImport` / `withPaymentsImport`) */
  after: Snapshot;
  /** последний день файла: за него таблица и правки */
  date: DateStr;
  /** период загрузки оплат: по нему собирается список правок оплат */
  period?: { from: DateStr; to: DateStr };
}

export interface PreviewSpec {
  id: 'funnel' | 'payments';
  /** Расчёт по свежему снимку с тем же разобранным файлом (файл заново не читается); `message` — файл больше не подходит. */
  compute(snapshot: Snapshot): Computed | { message: string };
}

interface Live {
  node: HTMLElement;
  apply(snapshot: Snapshot): void;
  setBusy(busy: boolean): void;
  setStale(stale: boolean): void;
}

const list = (lines: string[]) => h('ul', {}, ...lines.map((t) => h('li', {}, t)));

/**
 * Разборы загрузок вкладки «Импорт»: таблица «Итогов» за последний день файла «как будто файл уже загружен», что изменится
 * и устаревшие правки. «Поправить» пишет правку через общий поток записи страницы (`ctx.resultsFlow`), а не сам: у потока
 * один вид на страницу, поэтому все разборы вкладки подключены к нему одним видом `view`, который раздаёт свежие данные,
 * «занято» и «устарело» каждому живому разбору (воронки и оплат). После записи поток читает новый снимок, разбор
 * пересчитывается с тем же файлом; кнопка «Загрузить» принадлежит блоку файла и не перерисовывается.
 *
 * Снимок для нового разбора блок файла читает сам, вне потока и без блокировки, поэтому он мог устареть: пока читался,
 * в соседнем разборе могла записаться правка (или эта же запись ещё шла). Разбор, построенный по такому снимку, показал
 * бы значения без правки, и «Поправить» в нём задвоило бы её. Поэтому вид помнит последний снимок потока и счёт его
 * раздач: блок называет счёт до чтения (`mark`), и если за время чтения поток раздавал данные, разбор строится по ним.
 */
export function createPreviews(flow: ResultsFlow<Snapshot>, onLock: () => void) {
  const live = new Map<string, Live>();
  let latest: Snapshot | null = null;
  let applied = 0;

  const view: FlowView<Snapshot> = {
    apply(snapshot) {
      latest = snapshot;
      applied++;
      for (const [id, p] of live) {
        if (p.node.isConnected) p.apply(snapshot);
        else live.delete(id); // вкладку сменили или файл загрузили: этот разбор уже не на экране
      }
    },
    setBusy: (busy) => {
      live.forEach((p) => p.setBusy(busy));
      onLock();
    },
    setStale: (stale) => {
      live.forEach((p) => p.setStale(stale));
      onLock();
    },
  };

  /** Счёт раздач потока: брать до чтения снимка, а передавать в `add`. */
  const mark = (): number => applied;

  /**
   * Новый разбор на место прежнего того же блока; возвращает узел, который блок файла кладёт между строками и «Загрузить».
   * `since` — `mark()` до чтения `snapshot`: если после него поток раздал свежие данные, `snapshot` старше их и не годится.
   */
  function add(spec: PreviewSpec, snapshot: Snapshot, since: number): HTMLElement {
    const open = new Set<GroupCode>();
    const alert = h('p', { role: 'alert', 'data-alert': `${spec.id}-preview` });
    const status = h('p', { role: 'status', 'data-status': `${spec.id}-preview` });
    const refreshButton = h('button', { type: 'button', 'data-refresh': spec.id, onclick: () => void reload() }, 'Обновить');
    const staleBox = h('p', { role: 'alert', class: 'results-stale', 'data-stale': spec.id, hidden: true }, `${STALE_TEXT} `, refreshButton);
    const body = h('div', {});
    const node = h('div', { class: 'import-preview', 'data-preview': spec.id }, staleBox, alert, status, body);
    let busy = false;
    let stale = false;
    const lock = () => { body.inert = busy || stale; };

    /** «Сохранить» в редакторе строки: правка за день файла. Ошибку запроса показывает редактор, итог записи — разбор. */
    async function correct(line: EmployeeLine, wanted: Record<Kind, number>, date: DateStr): Promise<void> {
      alert.textContent = '';
      status.textContent = '';
      const items = correctionItems(line, wanted, date);
      if ('error' in items || items.length === 0) return; // редактор уже сказал об этом сам
      const done = await flow.correct(items);
      if (done.refreshError) {
        alert.textContent = done.result === 'saved'
          ? `Правка сохранена, но пересчитать разбор не удалось: ${errorText(done.refreshError)}.`
          : `Связь прерывалась: прошлая правка проверена, но данные перечитать не удалось: ${errorText(done.refreshError)}.`;
      } else if (done.result === 'changed') alert.textContent = INTERRUPTED_TEXT;
      else status.textContent = 'Правка сохранена, разбор пересчитан';
    }

    /** «Обновить»: проверить потерянную запись повтором, прочитать данные; разбор пересчитает поток. */
    async function reload(): Promise<void> {
      alert.textContent = '';
      status.textContent = '';
      try {
        const done = await flow.reload();
        if (done.error) {
          alert.textContent = `Обновить не удалось: ${errorText(done.error)}`;
          refreshButton.focus(); // на время чтения разбор был inert: фокус с кнопки ушёл
        } else if (done.checked) alert.textContent = INTERRUPTED_TEXT;
        else status.textContent = 'Данные обновлены';
      } catch (e) {
        alert.textContent = e instanceof WriteRefused ? e.message : errorText(e);
      }
    }

    function render(s: Snapshot): void {
      const c = spec.compute(s);
      if ('message' in c) return body.replaceChildren(h('p', {}, c.message));
      const effects = effectsOf(c.before, c.after);
      const views = correctionViews(c.after);
      const inPeriod = c.period
        ? views.filter((v) => v.c.kind === 'payments' && v.c.date >= c.period!.from && v.c.date <= c.period!.to)
        : [];
      const shown = new Set(inPeriod.map((v) => v.c.id));
      const stale = effects.stale.filter((v) => !shown.has(v.c.id)); // правка оплат периода уже в своём списке, с пометкой
      const sections: HTMLElement[] = [];
      if (effects.days.length) {
        sections.push(h('section', { 'data-effects': 'days' }, h('h3', {}, 'Изменятся итоги прошлых дней'), list(effects.days.map(dayChangeText))));
      }
      sections.push(h(
        'section',
        { 'data-effects': 'now' },
        h('h3', {}, 'Сейчас станет'),
        h('p', {}, `У питомцев сегодня (${ruDate(serverToday(c.before))}) изменится:`),
        effects.now.length ? list(effects.now.map(describeChange)) : h('p', {}, 'ничего: стадии, запасы и кучки сегодня те же.'),
      ));
      if (c.period) {
        sections.push(h(
          'section',
          { 'data-effects': 'period-corrections' },
          h('h3', {}, `Правки оплат за период ${ruDate(c.period.from)} — ${ruDate(c.period.to)}`),
          inPeriod.length ? list(inPeriod.map(correctionLine)) : h('p', {}, 'Правок оплат за период нет'),
        ));
      }
      if (stale.length) {
        sections.push(h(
          'section',
          { 'data-effects': 'stale' },
          h('h3', {}, 'Устаревшие правки'),
          h('p', { class: 'muted' }, 'Значение «из файла» взято после этой загрузки. Если пропавший счёт пришёл в файле, правка его задвоит: отмените её во вкладке «Итоги».'),
          list(stale.map(staleLine)),
        ));
      }
      body.replaceChildren(
        h('h3', {}, `Итоги за ${shortDate(c.date)} — как будто файл уже загружен`),
        renderResults(dayResults(c.after, c.date), { date: c.date, open, onCorrect: (line, wanted) => correct(line, wanted, c.date) }),
        ...sections,
      );
    }

    const impl: Live = {
      node,
      apply(s) {
        // сбой пересчёта не должен выглядеть для потока как сбой чтения: он объявил бы запись «устаревшей»
        try {
          render(s);
        } catch {
          body.replaceChildren(h('p', { role: 'alert' }, 'Не удалось пересчитать разбор: выберите файл ещё раз'));
        }
      },
      setBusy(next) { busy = next; lock(); },
      setStale(next) { stale = next; staleBox.hidden = !next; lock(); },
    };
    impl.apply(latest !== null && applied > since ? latest : snapshot);
    impl.setBusy(flow.busy);
    impl.setStale(flow.stale);
    live.set(spec.id, impl);
    return node;
  }

  return { view, mark, add };
}
