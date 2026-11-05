/** Мяч не подкатывается к стене комнаты ближе этого (px комнаты). */
export const BALL_EDGE = 50;
/** Ближе этого к границе мяч считается «в углу»: пинок в стену не годится, питомец перекидывает мяч через себя. */
const CORNER = 60;

/** Результат пинка: новый `x` мяча, прирост угла поворота и `toss` — мяч перекинут через питомца дугой. */
export interface Kick {
  x: number;
  rot: number;
  toss: boolean;
}

/**
 * Куда полетит мяч от пинка. Координаты комнаты; питомец стоит у мяча (`petX`), пинает от себя.
 * Улетающий за стену мяч отскакивает; если мяч уже в углу, а пинок в стену, питомец перекидывает его
 * через себя в другую сторону. `rot` — прирост поворота (смещение × 2.2).
 */
export function kickBall(ballX: number, petX: number, roomW: number, rnd: () => number): Kick {
  const lo = BALL_EDGE;
  const hi = roomW - BALL_EDGE;
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
  const dir = ballX > petX ? 1 : -1;
  const intoWall = dir === 1 ? hi - ballX < CORNER : ballX - lo < CORNER;
  let x: number;
  let toss = false;
  if (intoWall) {
    toss = true;
    x = clamp(petX - dir * (120 + rnd() * 80));
  } else {
    x = ballX + dir * (90 + rnd() * 90);
    if (x > hi) x = hi - (x - hi);
    else if (x < lo) x = lo + (lo - x);
    x = clamp(x);
  }
  return { x, rot: (x - ballX) * 2.2, toss };
}
