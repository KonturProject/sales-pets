import { describe, expect, test, vi } from 'vitest';
import { createNavLock } from './navLock';

describe('createNavLock', () => {
  test('замок снимается, когда его сняли все, кто ставил', () => {
    const apply = vi.fn();
    const lock = createNavLock(apply);
    lock(true);
    lock(false);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  test('ушедший с экрана экземпляр вкладки не снимает замок видимой: счётчик, а не флаг', () => {
    const apply = vi.fn();
    const lock = createNavLock(apply);
    lock(true); // видимая вкладка пишет
    lock(true); // старый экземпляр тоже что-то делает (повтор потерянной записи)
    lock(false); // старый закончил
    expect(apply.mock.calls.at(-1)).toEqual([true]); // видимая ещё пишет — вкладки по-прежнему закрыты
    lock(false);
    expect(apply.mock.calls.at(-1)).toEqual([false]);
  });

  test('лишнее снятие не уводит счётчик в минус: следующая запись снова закрывает вкладки', () => {
    const apply = vi.fn();
    const lock = createNavLock(apply);
    lock(false);
    lock(true);
    expect(apply.mock.calls.at(-1)).toEqual([true]);
    lock(false);
    expect(apply.mock.calls.at(-1)).toEqual([false]);
  });
});
