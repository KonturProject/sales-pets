import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';
import { applyPatch, removeChange } from '../../src/admin/configPreview.ts';
import { configOf } from '../../src/data/config.ts';

// Клиент (предпросмотр) и сервер (Code.gs) обязаны давать одно и то же при одинаковой последовательности правок:
// иначе «что изменится» в предпросмотре разойдётся с тем, что запишется.
const admin = (b, extra) => b.post({ pin: PIN, ...extra });

const STEPS = [
  { patch: { maxPiles: 4 } },
  { patch: { sickDaysNoPay: 3, norms: { experienced: { quality: 2 } } }, from: '2026-11-12' },
  { patch: { maxPiles: 2, norms: { experienced: { quality: 1, long: 1 } } }, from: '2026-11-09' },
  { patch: { norms: { experienced: { long: 2 } } }, from: '2026-11-12' },
  { patch: { norms: { rookie2: { payments: 0.35 } } }, from: '2026-11-16' },
  { patch: { norms: { experienced: { quality: 7 } } } },
  { patch: { maxPiles: 6 } },
  { remove: '2026-11-12' },
  { patch: { stageThresholds: [10, 30, 50, 70] } },
  { patch: { norms: { experienced: { long: 5 } } } },
  { patch: { norms: { rookie2: { payments: 0.2 } } } },
  { patch: { norms: { experienced: { quality: 1.5, long: 0.25 } } } },
  { patch: { norms: { rookie1: { quality: 2.75, long: 0.5 } } }, from: '2026-11-14' },
  { patch: { norms: { rookie1: { long: 3.5 } } } },
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

describe('дробные нормы и выходные в config', () => {
  test('дробные quality и long сервер принимает, а applyPatch сохраняет как есть', () => {
    const b = loadBackend();
    const patch = { norms: { experienced: { quality: 1.5, long: 0.25, payments: 0.35 } } };
    expect(admin(b, { action: 'setConfig', config: patch }).ok).toBe(true);
    const state = applyPatch({ config: {}, configChanges: [] }, patch);
    expect(state.config).toEqual(b.get().config);
    expect(state.config.norms.experienced).toEqual({ quality: 1.5, long: 0.25, payments: 0.35 });
  });

  test('configOf принимает дробные quality и long так же, как сервер, и отвергает то же самое', () => {
    const b = loadBackend();
    const patch = { norms: { experienced: { quality: 1.5, long: 0.25 } } };
    expect(admin(b, { action: 'setConfig', config: patch }).ok).toBe(true);
    expect(configOf(b.get().config).norms.experienced).toEqual({ quality: 1.5, long: 0.25, payments: 0.4 });
    for (const bad of [1.555, -0.5, 50.01]) {
      const norms = { experienced: { long: bad } };
      expect(admin(b, { action: 'setConfig', config: { norms } }).ok, `сервер ${bad}`).toBe(false);
      expect(configOf({ norms }).norms.experienced.long, `клиент ${bad}`).toBe(3);
    }
  });

  test('configOf берёт выходные из config в том же виде, что хранит сервер', () => {
    const b = loadBackend();
    expect(admin(b, { action: 'setNonWorking', nonWorking: ['2026-11-07', '2026-11-04'] }).ok).toBe(true);
    expect(configOf(b.get().config).nonWorking).toEqual(['2026-11-04', '2026-11-07']);
    expect(admin(b, { action: 'setNonWorking', nonWorking: [] }).ok).toBe(true);
    expect(configOf(b.get().config).nonWorking).toEqual([]);
  });

  test('config.nonWorking переживает setConfig на сервере и applyPatch на клиенте', () => {
    const b = loadBackend();
    const nonWorking = ['2026-11-04', '2026-11-07'];
    expect(admin(b, { action: 'setNonWorking', nonWorking: ['2026-11-07', '2026-11-04'] }).ok).toBe(true);
    let state = { config: b.get().config, configChanges: b.get().configChanges };
    expect(state.config.nonWorking).toEqual(nonWorking);
    const steps = [
      { patch: { maxPiles: 3 } },
      { patch: { norms: { experienced: { quality: 1.5 } } } },
      { patch: { maxPiles: 2 }, from: '2026-11-09' },
      { patch: { stageThresholds: [10, 30, 50, 70] } },
    ];
    steps.forEach((step, i) => {
      const body = { action: 'setConfig', config: step.patch, ...(step.from ? { from: step.from } : {}) };
      expect(admin(b, body).ok, `шаг ${i}`).toBe(true);
      state = applyPatch(state, step.patch, step.from);
      const server = b.get();
      expect(server.config.nonWorking, `шаг ${i}`).toEqual(nonWorking);
      expect({ config: state.config, configChanges: state.configChanges }, `шаг ${i}`).toEqual({ config: server.config, configChanges: server.configChanges });
    });
  });
});
