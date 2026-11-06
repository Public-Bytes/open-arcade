import type { FilmData, PointerPoint } from "./types";
type Knot = PointerPoint & { dx: number; dy: number };
// Offline, symmetric filtering: looking both directions removes jitter without
// the phase delay of a following spring. Clicks remain exact interpolation knots.
export function cursorPath(film: FilmData) {
  const merged = [
    ...film.pointer,
    ...film.clicks.map((c) => ({ ...c, anchor: true })),
  ].sort((a, b) => a.t - b.t);
  const source: (PointerPoint & { anchor?: boolean })[] = [];
  for (const p of merged) {
    const last = source.at(-1);
    if (film.cursorRecorded && last && p.t - last.t > 0.08) last.anchor = true;
    // Mouse events stop while the pointer rests. A gap is a hold, not a slow
    // journey to the next event. Preserve that rest before interpolating motion.
    if (
      film.cursorRecorded &&
      last &&
      p.t - last.t > 0.08 &&
      (p.x !== last.x || p.y !== last.y)
    ) {
      source.push({ ...last, t: p.t - 0.016, anchor: true });
    }
    if (source.at(-1)?.t === p.t) {
      source[source.length - 1] = { ...source.at(-1)!, ...p };
    } else source.push({ ...p });
  }
  const find = (t: number) => {
    let lo = 0,
      hi = Math.max(0, source.length - 1);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (source[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const raw = (t: number) => {
    const i = find(t),
      a = source[i],
      b = source[Math.min(i + 1, source.length - 1)];
    if (!a) return { x: 50, y: 50 };
    const q = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q };
  };
  const sigma = 0.025 * film.settings.cursorSmoothing;
  const knots: Knot[] = source.map((p) => {
    let x = p.x,
      y = p.y;
    if (!p.anchor && p !== source[0] && p !== source.at(-1) && sigma > 0) {
      x = 0;
      y = 0;
      let sum = 0;
      for (let n = -4; n <= 4; n++) {
        const weight = Math.exp((-n * n) / 8),
          v = raw(p.t + n * sigma);
        x += v.x * weight;
        y += v.y * weight;
        sum += weight;
      }
      x /= sum;
      y /= sum;
    }
    return { ...p, x, y, dx: 0, dy: 0 };
  });
  const slope = (a: number, b: number, dtA: number, dtB: number) => {
    if (a * b <= 0) return 0;
    return (
      Math.sign(a) *
      Math.min(
        Math.abs((a * dtB + b * dtA) / (dtA + dtB)),
        3 * Math.abs(a),
        3 * Math.abs(b),
      )
    );
  };
  for (let i = 0; i < knots.length; i++) {
    const a = knots[Math.max(0, i - 1)],
      b = knots[i],
      c = knots[Math.min(knots.length - 1, i + 1)];
    const da = b.t - a.t,
      dc = c.t - b.t;
    if (da > 0 && dc > 0) {
      b.dx = slope((b.x - a.x) / da, (c.x - b.x) / dc, da, dc);
      b.dy = slope((b.y - a.y) / da, (c.y - b.y) / dc, da, dc);
    }
  }
  return (t: number) => {
    const i = find(t),
      a = knots[i],
      b = knots[Math.min(i + 1, knots.length - 1)];
    if (!a)
      return { x: 50, y: 50, vx: 0, kind: "arrow" as const, visible: false };
    const d = b.t - a.t,
      q = d > 0 ? Math.max(0, Math.min(1, (t - a.t) / d)) : 0,
      q2 = q * q,
      q3 = q2 * q;
    const hermite = (x: number, y: number, dx: number, dy: number) =>
      (2 * q3 - 3 * q2 + 1) * x +
      (q3 - 2 * q2 + q) * d * dx +
      (-2 * q3 + 3 * q2) * y +
      (q3 - q2) * d * dy;
    return {
      x: hermite(a.x, b.x, a.dx, b.dx),
      y: hermite(a.y, b.y, a.dy, b.dy),
      vx:
        d > 0
          ? ((6 * q2 - 6 * q) * a.x +
              (3 * q2 - 4 * q + 1) * d * a.dx +
              (-6 * q2 + 6 * q) * b.x +
              (3 * q2 - 2 * q) * d * b.dx) /
            d
          : 0,
      kind: a.kind,
      visible: t >= source[0].t && a.visible !== false,
    };
  };
}
