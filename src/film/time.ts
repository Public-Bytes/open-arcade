import type { FilmData } from "./types";
// Source time is the recording's own clock. Output time is the finished
// video's clock: trimmed, with cut sections removed, divided by speed.
export type Segment = { start: number; end: number; out: number };
export function segments(film: FilmData): Segment[] {
  const cuts = [...(film.cuts || [])]
    .map((c) => ({
      start: Math.max(film.trimStart, c.start),
      end: Math.min(film.trimEnd, c.end),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const kept: Segment[] = [];
  let at = film.trimStart,
    out = 0;
  for (const c of cuts) {
    if (c.start > at + 1e-6) {
      kept.push({ start: at, end: c.start, out });
      out += (c.start - at) / film.speed;
    }
    at = Math.max(at, c.end);
  }
  if (film.trimEnd > at + 1e-6)
    kept.push({ start: at, end: film.trimEnd, out });
  return kept;
}
export function outputDuration(film: FilmData) {
  const s = segments(film).at(-1);
  return s ? s.out + (s.end - s.start) / film.speed : 0;
}
export function sourceTime(film: FilmData, output: number, list = segments(film)) {
  for (const s of list) {
    const end = s.out + (s.end - s.start) / film.speed;
    if (output < end) return s.start + Math.max(0, output - s.out) * film.speed;
  }
  return list.at(-1)?.end ?? film.trimEnd;
}
export function outputTime(film: FilmData, source: number, list = segments(film)) {
  let last = 0;
  for (const s of list) {
    if (source < s.start) return s.out;
    if (source <= s.end) return s.out + (source - s.start) / film.speed;
    last = s.out + (s.end - s.start) / film.speed;
  }
  return last;
}
// The next playable source time at or after t: skips over removed sections.
export function playable(film: FilmData, t: number, list = segments(film)) {
  for (const s of list) if (t < s.end) return Math.max(t, s.start);
  return film.trimEnd;
}
