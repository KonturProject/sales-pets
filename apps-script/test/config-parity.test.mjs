import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';
import { applyPatch, removeChange } from '../../src/admin/configPreview.ts';

// Клиент (предпросмотр) и сервер (Code.gs) обязаны давать одно и то же при одинаковой последовательности правок:
// иначе «что изменится» в предпросмотре разойдётся с тем, что запишется.
const admin = (b, extra) => b.post({ pin: PIN, ...extra });

const STEPS = [
  { patch: { maxPiles: 4 } },
  { patch: { sickDaysNoPay: 3, norms: { experienced: { quality: 2 } } }, from: '2026-11-12' },
  { patch: { maxPiles: 2, norms: { experienced: { quality: 1, long: 1 } } }, from: '2026-11-09' },
  { patch: { norms: { experienced: { long: 2 } } }, from: '2026-11-12' },
  { patch: { dailyNorm: 7 }, from: '2026-11-16' },
  { patch: { norms: { experienced: { quality: 7 } } } },
  { patch: { maxPiles: 6 } },
  { remove: '2026-11-12' },
  { patch: { stageThresholds: Array.from({ length: 15 }, (_, i) => (i + 1) * 5) } },
  { patch: { norms: { experienced: { long: 5 } } } },
  { patch: { dailyNorm: 3 } },
];

describe('клиентское зеркало setConfig / removeConfigChange', () => {
  test('после каждого шага config и configChanges совпадают с серверными', () => {
    const b = loadBackend();
    let state = { config: {}, configChanges: [] };
    STEPS.forEach((step, i) => {
      if (step.remove) {
        expect(admin(b, { action: 'removeConfigChange', from: step.remove }).ok, `шаг ${i}`).toBe(true);
        state = removeChange(state, step.remove);
      } else {
        const body = { action: 'setConfig', config: step.patch, ...(step.from ? { from: step.from } : {}) };
        expect(admin(b, body).ok, `шаг ${i}`).toBe(true);
        state = applyPatch(state, step.patch, step.from);
      }
      const server = b.get();
      expect({ config: state.config, configChanges: state.configChanges }, `шаг ${i}`).toEqual({ config: server.config, configChanges: server.configChanges });
    });
  });
});
