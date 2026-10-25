/**
 * Режимы экономии для слабых устройств и настенных мониторов.
 * active — вкладка видна и с ней недавно работали; ambient — видна, но ввода нет (монитор на стене):
 * анимации идут вдвое медленнее; idle — вкладка скрыта: анимации на паузе, обновление редкое.
 */
export type PowerMode = 'active' | 'ambient' | 'idle';

export const TICK_MS: Record<PowerMode, number> = { active: 1000, ambient: 3000, idle: 15000 };

export function modeFor(now: number, lastInput: number, hidden: boolean, ambientAfterMs = 60_000): PowerMode {
  if (hidden) return 'idle';
  return now - lastInput >= ambientAfterMs ? 'ambient' : 'active';
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const;

export class PowerSaver {
  private mode: PowerMode = 'active';
  private lastInput = Date.now();
  private timer: number | undefined;
  private readonly listeners = new Set<(mode: PowerMode) => void>();

  /** `el` получает атрибут data-power (по нему CSS замедляет/останавливает анимации). */
  constructor(private readonly el: HTMLElement, private readonly ambientAfterMs = 60_000) {}

  onTick(cb: (mode: PowerMode) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    INPUT_EVENTS.forEach((e) => window.addEventListener(e, this.onInput, { passive: true }));
    document.addEventListener('visibilitychange', this.onVisibility);
    this.evaluate();
    this.schedule();
  }

  stop(): void {
    INPUT_EVENTS.forEach((e) => window.removeEventListener(e, this.onInput));
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.clearTimeout(this.timer);
  }

  private evaluate(): void {
    this.mode = modeFor(Date.now(), this.lastInput, document.hidden, this.ambientAfterMs);
    this.el.dataset.power = this.mode;
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.evaluate();
      this.listeners.forEach((cb) => cb(this.mode));
      this.schedule();
    }, TICK_MS[this.mode]);
  }

  private readonly onInput = (): void => {
    this.lastInput = Date.now();
    if (this.mode !== 'active') {
      this.evaluate();
      this.schedule();
    }
  };

  private readonly onVisibility = (): void => {
    this.evaluate();
    this.schedule();
    if (!document.hidden) this.listeners.forEach((cb) => cb(this.mode));
  };
}
