import { describe, expect, it } from 'vitest';
import { pickBite, type Biter } from './bite';

const w = (id: Biter['id'], plan: number | null, sick = false): Biter => ({ id, plan, sick });
/** rnd, выдающий заданные числа по очереди; дальше последнее. */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};

describe('pickBite', () => {
  const three = [w('СР1', 80), w('СР2', 20), w('СР3', 50)];

  it('лидер кусает отстающего: «кусь»', () => {
    expect(pickBite(three, () => 0.2)).toEqual({ biter: 'СР1', victim: 'СР2', line: 'кусь' });
  });

  it('отстающий кусает лидера: «догоню!»', () => {
    expect(pickBite(three, () => 0.7)).toEqual({ biter: 'СР2', victim: 'СР1', line: 'догоню!' });
  });

  it('больной не участвует, даже если он отстающий', () => {
    const walkers = [w('СР1', 80), w('СР2', 20, true), w('СР3', 50)];
    expect(pickBite(walkers, () => 0.2)).toEqual({ biter: 'СР1', victim: 'СР3', line: 'кусь' });
    expect(pickBite(walkers, () => 0.7)).toEqual({ biter: 'СР3', victim: 'СР1', line: 'догоню!' });
  });

  it('меньше двух здоровых: нет укуса', () => {
    expect(pickBite([], () => 0.1)).toBeNull();
    expect(pickBite([w('СР1', 50)], () => 0.1)).toBeNull();
    expect(pickBite([w('СР1', 50), w('СР2', 10, true)], () => 0.1)).toBeNull();
  });

  it('все без плана или все равны: случайная пара и «кусь»', () => {
    const none = [w('СР1', null), w('СР2', null), w('СР3', null)];
    const same = [w('СР1', 40), w('СР2', 40), w('СР3', 40)];
    for (const walkers of [none, same]) {
      for (const r of [0.1, 0.7]) {
        const bite = pickBite(walkers, seq(r, 0.9, 0.9));
        expect(bite?.line).toBe('кусь');
        expect(bite?.biter).not.toBe(bite?.victim);
      }
    }
    expect(pickBite(none, seq(0.0, 0.0))).toEqual({ biter: 'СР1', victim: 'СР2', line: 'кусь' });
    expect(pickBite(none, seq(0.99, 0.99))).toEqual({ biter: 'СР3', victim: 'СР2', line: 'кусь' });
  });

  it('при равенстве лидеров берётся случайный из равных', () => {
    const walkers = [w('СР1', 80), w('СР2', 80), w('СР3', 20)];
    expect(pickBite(walkers, seq(0.2, 0.0))).toEqual({ biter: 'СР1', victim: 'СР3', line: 'кусь' });
    expect(pickBite(walkers, seq(0.2, 0.9))).toEqual({ biter: 'СР2', victim: 'СР3', line: 'кусь' });
    expect(pickBite(walkers, seq(0.7, 0.9))).toEqual({ biter: 'СР3', victim: 'СР2', line: 'догоню!' });
  });

  it('при равенстве отстающих берётся случайный из равных', () => {
    const walkers = [w('СР1', 90), w('СР2', 10), w('СР3', 10)];
    expect(pickBite(walkers, seq(0.2, 0.0))).toEqual({ biter: 'СР1', victim: 'СР2', line: 'кусь' });
    expect(pickBite(walkers, seq(0.2, 0.9))).toEqual({ biter: 'СР1', victim: 'СР3', line: 'кусь' });
  });
});
