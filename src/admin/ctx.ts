import type { Snapshot } from '@/data/api';
import type { PendingHolder } from './correctionSaver';
import type { Session } from './session';

/** Что вкладкам админки нужно от каркаса: вызовы с PIN сессии и свежий снимок по запросу (без опроса). */
export interface AdminCtx {
  session: Session;
  snapshot(): Promise<Snapshot>;
  /** На время записи: вкладки и «Выйти» недоступны, иначе вкладка с идущей записью исчезнет из-под неё. */
  lockNav(locked: boolean): void;
  /** Запрос правки без ответа живёт здесь, а не во вкладке: после смены вкладки её новый экземпляр его повторит. */
  pendingCorrection: PendingHolder;
}
