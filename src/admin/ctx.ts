import type { Snapshot } from '@/data/api';
import type { Session } from './session';

/** Что вкладкам админки нужно от каркаса: вызовы с PIN сессии и свежий снимок по запросу (без опроса). */
export interface AdminCtx {
  session: Session;
  snapshot(): Promise<Snapshot>;
  /** На время записи: вкладки и «Выйти» недоступны, иначе вкладка с идущей записью исчезнет из-под неё. */
  lockNav(locked: boolean): void;
}
