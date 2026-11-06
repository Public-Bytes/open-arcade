import type { Project } from "../lib/model";
import { blankFilm } from "./types";
export function ensureFilm(p: Project): Project {
  const embedded =
    (p.captureVersion ?? (p.steps.some((s) => s.recorded) ? 3 : 4)) < 4;
  if (p.film) {
    if (embedded && p.film.cursorEmbedded === undefined)
      return { ...p, film: { ...p.film, cursorEmbedded: true } };
    return p;
  }
  const film = blankFilm();
  film.cursorEmbedded = embedded;
  let time = 0;
  const raw =
    p.steps.length > 0 &&
    p.steps.every(
      (s) => s.type === "video" && s.assetId === p.steps[0].assetId,
    ) &&
    p.steps[0].sourceDuration;
  if (raw) {
    for (const s of p.steps)
      if (s.click)
        film.clicks.push({
          id: s.id,
          t: (s.start || 0) + s.click.time,
          x: s.click.x,
          y: s.click.y,
          label: s.title,
        });
    const s = {
      ...p.steps[0],
      start: 0,
      end: Number(raw),
      duration: Number(raw),
      title: "Recording",
      hotspots: [],
      click: undefined,
    };
    p = { ...p, steps: [s] };
    film.duration = Number(raw);
  } else {
    for (const s of p.steps) {
      for (const h of s.hotspots)
        film.clicks.push({
          id: h.id,
          t: time + Math.min(0.8, s.duration * 0.35),
          x: h.x,
          y: h.y,
          label: h.label,
        });
      time += s.type === "video" ? s.end! - s.start! : s.duration;
    }
    film.duration = time;
  }
  film.trimEnd = film.duration;
  film.pointer = film.clicks
    .flatMap((c, i) => [
      {
        t: Math.max(0, c.t - 0.6),
        x: i ? film.clicks[i - 1].x : 50,
        y: i ? film.clicks[i - 1].y : 50,
        kind: "arrow" as const,
      },
      { t: c.t, x: c.x, y: c.y, kind: "arrow" as const },
    ])
    .sort((a, b) => a.t - b.t);
  return { ...p, film };
}
export function clipAt(p: Project, t: number) {
  let start = 0;
  for (let i = 0; i < p.steps.length; i++) {
    const clip = p.steps[i],
      duration =
        clip.type === "video" ? clip.end! - clip.start! : clip.duration;
    if (t < start + duration || i === p.steps.length - 1)
      return {
        clip,
        index: i,
        offset: Math.max(0, Math.min(duration - 0.001, t - start)),
        start,
        duration,
      };
    start += duration;
  }
  return undefined;
}
