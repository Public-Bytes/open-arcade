import type { FilmData, PointerPoint, ZoomRegion } from "./types";
import { cursorPath } from "./cursor";
import {
  createSpringState,
  getZoomSpringConfig,
  stepSpringValue,
} from "./recordly-spring";
export type Pose = {
  z: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  angle: number;
  click: number;
  kind: PointerPoint["kind"];
  visible: boolean;
};
export function autoZooms(film: FilmData): ZoomRegion[] {
  if (!film.settings.autoZoom) return film.zooms.filter((z) => !z.automatic);
  const manual = film.zooms.filter((z) => !z.automatic),
    groups: ZoomRegion[] = [],
    dismissed = new Set(film.dismissed || []);
  for (const c of film.clicks) {
    if (dismissed.has("auto-" + c.id)) continue;
    if (manual.some((z) => c.t >= z.start && c.t <= z.end)) continue;
    const start = Math.max(0, c.t - 0.85),
      end = Math.min(film.duration, c.t + 1.8),
      last = groups.at(-1);
    if (last && start <= last.end + 0.65) {
      last.end = Math.max(last.end, end);
    } else
      groups.push({
        id: "auto-" + c.id,
        start,
        end,
        scale: film.settings.zoom,
        x: c.x,
        y: c.y,
        automatic: true,
      });
  }
  return [...groups, ...manual].sort((a, b) => a.start - b.start);
}
// Gaps between zooms shorter than this (seconds) are held instead of zooming
// out and back in.
const BRIDGE = 1.2;
export function createMotion(film: FilmData) {
  const rate = Math.min(120, Math.max(12, 240000 / Math.max(1, film.duration))),
    count = Math.ceil(film.duration * rate) + 2,
    poses: Pose[] = new Array(count),
    regions = autoZooms(film),
    manual = regions.filter((r) => !r.automatic),
    cursor = cursorPath(film);
  let region = 0,
    clickIndex = 0;
  const zs = createSpringState(1),
    ax = createSpringState(0.5),
    ay = createSpringState(0.5),
    config = getZoomSpringConfig(film.settings.cameraSmoothness);
  // Start from the full view even when an early click's zoom region begins at
  // zero. An uninitialized spring would snap straight to that first target.
  zs.initialized = ax.initialized = ay.initialized = true;
  let angle = 0,
    targetX = 0.5,
    targetY = 0.5,
    z = 1;
  // Every zoom is a pure scale about one fixed point, so the camera never
  // pans: the view grows straight into the box with nothing sliding sideways.
  // That point is the one that sits in the same place on screen at full view
  // and at full zoom, which puts the box's centre in the middle of the frame
  // (or the box flush against the edge it was pushed to). Since it lies inside
  // the frame, no zoom level in between exposes an edge.
  const anchor = (focus: number, scale: number) => {
    const c = Math.max(50 / scale, Math.min(100 - 50 / scale, focus)) / 100;
    return scale > 1 ? (scale * c - 0.5) / (scale - 1) : 0.5;
  };
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    while (region < regions.length && regions[region].end < t) region++;
    let active =
      manual.find((r) => r.start <= t && r.end >= t) ||
      (regions[region] && regions[region].start <= t
        ? regions[region]
        : undefined);
    // Two zooms close together are one continuous shot: the camera holds the
    // first until the second begins, then travels straight across to it.
    // Starting to pull out only to push back in reads as a wobble.
    if (!active && region > 0 && regions[region]) {
      const prev = regions[region - 1],
        next = regions[region];
      if (next.start - prev.end <= BRIDGE && t < next.start) active = prev;
    }
    const raw = cursor(t);
    // Zooming out keeps the last box's point, so the way out mirrors the way in.
    if (active) {
      targetX = anchor(active.x, active.scale);
      targetY = anchor(active.y, active.scale);
    }
    // From the full view the point is free to jump, as nothing moves on screen.
    // Only going from one zoom straight into another does the view travel.
    if (z < 1.001) {
      ax.value = targetX;
      ay.value = targetY;
      ax.velocity = ay.velocity = 0;
    }
    z = i ? stepSpringValue(zs, active?.scale || 1, 1000 / rate, config) : 1;
    const px = i ? stepSpringValue(ax, targetX, 1000 / rate, config) : 0.5,
      py = i ? stepSpringValue(ay, targetY, 1000 / rate, config) : 0.5;
    while (
      clickIndex + 1 < film.clicks.length &&
      film.clicks[clickIndex + 1].t <= t
    )
      clickIndex++;
    const click = film.clicks[clickIndex],
      age = click ? t - click.t : 99;
    const impulse =
      age >= 0 && age < 0.32 ? Math.sin((age / 0.32) * Math.PI) : 0;
    const desiredAngle = film.settings.cursorTilt
      ? Math.max(-0.22, Math.min(0.22, raw.vx * 0.002))
      : 0;
    angle += (desiredAngle - angle) * 0.12;
    poses[i] = {
      z,
      x: px * (1 - z),
      y: py * (1 - z),
      cx: raw.x / 100,
      cy: raw.y / 100,
      angle,
      click: impulse,
      kind: raw.kind,
      visible: raw.visible,
    };
  }
  return {
    regions,
    at(t: number): Pose {
      const pointer = cursor(t);
      const n = Math.max(0, Math.min(count - 1, t * rate)),
        i = Math.floor(n),
        a = poses[i],
        b = poses[Math.min(count - 1, i + 1)],
        q = n - i;
      return {
        z: a.z + (b.z - a.z) * q,
        x: a.x + (b.x - a.x) * q,
        y: a.y + (b.y - a.y) * q,
        cx: pointer.x / 100,
        cy: pointer.y / 100,
        angle: a.angle + (b.angle - a.angle) * q,
        click: a.click + (b.click - a.click) * q,
        kind: pointer.kind,
        visible: pointer.visible,
      };
    },
  };
}
