import type { SnapshotOverride } from '@/data/api';

/** За один снимок рука показывается не больше чем для стольких расходов: иначе анимации встанут в очередь на минуты. */
const MAX_PER_SNAPSHOT = 3;

const isUse = (o: SnapshotOverride) => o.kind === 'useMedkit' || o.kind === 'useToy';

/**
 * Расходы РГ, которых экран ещё не показывал (R20): сравнение по `id`, часы монитора не участвуют.
 * `prevMax === null` — первый снимок страницы: рука не играет, расходы прошлых минут не повторяются.
 * Возвращает новые расходы по порядку `id` (последние три) и наибольший виденный `id`.
 */
export function newUses(prevMax: number | null, overrides: SnapshotOverride[]): { uses: SnapshotOverride[]; max: number } {
  const used = overrides.filter(isUse).sort((a, b) => a.id - b.id);
  const max = Math.max(prevMax ?? 0, ...used.map((o) => o.id));
  if (prevMax === null) return { uses: [], max };
  return { uses: used.filter((o) => o.id > prevMax).slice(-MAX_PER_SNAPSHOT), max };
}
