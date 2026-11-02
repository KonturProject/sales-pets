import { isWorkingDay, workingDaysBetween } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import { HATCH_AT, type PetState } from '@/engine/pet';
import type { RankData } from '@/engine/ranking';
import { groupOn } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { MAX_STAGE } from '@/game/PetView';

export interface TickerItem {
  label: string;
  value: string;
  unit?: string;
}

export interface FunnelTotal {
  quality: number;
  long: number;
}

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

/** Цифры, которые по очереди показывает табло комнаты. */
export function tickerItems(s: PetState, funnel?: FunnelTotal): TickerItem[] {
  if (!s.alive) return [{ label: 'Питомец погиб', value: 'ждём', unit: 'оплату' }];
  if (s.phase !== 'pet') return [{ label: 'До вылупления', value: String(s.totalPayments), unit: `из ${HATCH_AT} оплат` }];
  return [
    { label: 'Стадия', value: String(s.stage), unit: `/ ${MAX_STAGE}` },
    s.planPercent === null ? { label: 'Оплат', value: String(s.totalPayments) } : { label: 'Оплат', value: String(s.totalPayments), unit: `${s.planPercent} % плана` },
    ...(funnel ? [
      { label: 'Качественных счетов', value: String(funnel.quality) },
      { label: 'Длинных презентаций', value: String(funnel.long) },
    ] : []),
  ];
}

/** Воронка каждой группы с начала игры по `asOf`: строка идёт группе, где сотрудник был в день строки. */
export function groupFunnel(rank: RankData, asOf: DateStr): Record<GroupCode, FunnelTotal> {
  const totals = Object.fromEntries(GROUPS.map((g) => [g, { quality: 0, long: 0 }])) as Record<GroupCode, FunnelTotal>;
  const byId = new Map(rank.staff.map((e) => [e.id, e]));
  for (const row of rank.funnel) {
    const e = byId.get(row.employeeId);
    if (!e || row.date > asOf || row.date < rank.cfg.startDate) continue;
    const t = totals[groupOn(e, row.date)];
    if (!t) continue;
    t.quality += row.quality;
    t.long += row.long;
  }
  return totals;
}

export interface PaymentGain {
  group: GroupCode;
  gain: number;
}

/** Новые оплаты между обновлениями экрана, больший прирост первым. `prev === null` — первая загрузка, праздника нет. */
export function paymentGains(prev: Record<GroupCode, number> | null, next: Record<GroupCode, number>): PaymentGain[] {
  if (!prev) return [];
  return GROUPS.map((group) => ({ group, gain: next[group] - prev[group] }))
    .filter((g) => g.gain > 0)
    .sort((a, b) => b.gain - a.gain);
}

const payWord = (n: number) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'оплата';
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'оплаты' : 'оплат';
};

/** Текст плашки праздника. */
export function partyBanner(gains: PaymentGain[]): string {
  if (gains.length === 1) return `${gains[0].group}: +${gains[0].gain} ${payWord(gains[0].gain)}! Все на праздник`;
  return `Новые оплаты: ${gains.map((g) => `${g.group} +${g.gain}`).join(' · ')} · все на праздник`;
}

/** День игры для верхней строки. */
export function dayLine(asOf: DateStr, cfg: Config): string {
  if (asOf < cfg.startDate) return `старт ${short(cfg.startDate)}`;
  if (asOf > cfg.endDate) return 'игра окончена';
  const total = workingDaysBetween(cfg.startDate, cfg.endDate, cfg).length;
  const day = `день ${workingDaysBetween(cfg.startDate, asOf, cfg).length} из ${total}`;
  return isWorkingDay(asOf, cfg) ? day : `выходной · ${day}`;
}

const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });

/** Свежесть данных: когда экран последний раз получил ответ сервера и по какой день загружены файлы. */
export function freshLine(o: { at: Date; funnelThrough: DateStr | null; paymentsThrough: DateStr | null }): string {
  return [
    `обновлено ${MOSCOW_TIME.format(o.at)}`,
    o.funnelThrough ? `воронка по ${short(o.funnelThrough)}` : 'воронки ещё нет',
    o.paymentsThrough ? `оплаты по ${short(o.paymentsThrough)}` : 'оплат из файла ещё нет',
  ].join(' · ');
}
