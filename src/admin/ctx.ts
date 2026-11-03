import type { Snapshot } from '@/data/api';
import type { ResultsFlow } from './resultsFlow';
import type { Session } from './session';

/** Что вкладкам админки нужно от каркаса: вызовы с PIN сессии и свежий снимок по запросу (без опроса). */
export interface AdminCtx {
  session: Session;
  snapshot(): Promise<Snapshot>;
  /**
   * Поток записи правок «Итогов»: один на всю страницу, его создаёт каркас. Состояние записи (занято, устарело,
   * неотвеченный запрос, идущая проверка) живёт в нём, а не во вкладке: экземпляров вкладки за сеанс много, и каждый
   * со своим состоянием повторял бы потерянный запрос сам.
   */
  resultsFlow: ResultsFlow<Snapshot>;
}
