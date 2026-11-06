import { useMemo, useRef } from "react";
import type {
  FilmAnnotation,
  FilmData,
  FilmSettings,
  ZoomRegion,
} from "./types";
import { frameRect, textLayout } from "./draw";
import type { StageSize } from "./Preview";
type Drag = {
  x: number;
  y: number;
  move: (dx: number, dy: number, px: number, py: number) => void;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const focusClamp = (v: number, scale: number) =>
  clamp(v, 50 / scale, 100 - 50 / scale);
// Handles drawn over the preview. Everything is placed in stage pixels using
// the same frame geometry as the renderer, so what you drag is what renders.
export function Overlay({
  stage,
  film,
  time,
  playing,
  selected,
  region,
  onSelect,
  onBegin,
  onZoom,
  onAnnotation,
  onSettings,
}: {
  stage: StageSize;
  film: FilmData;
  time: number;
  playing: boolean;
  selected: string | null;
  region?: ZoomRegion;
  onSelect: (id: string, tab: string) => void;
  onBegin: () => void;
  onZoom: (region: ZoomRegion, patch: Partial<ZoomRegion>) => void;
  onAnnotation: (id: string, patch: Partial<FilmAnnotation>) => void;
  onSettings: (patch: Partial<FilmSettings>) => void;
}) {
  const drag = useRef<Drag | null>(null),
    measure = useMemo(() => new OffscreenCanvas(1, 1).getContext("2d")!, []);
  if (playing) return null;
  const fr = frameRect(
      stage.width,
      stage.height,
      stage.aspect,
      film.settings.padding,
    ),
    s = film.settings,
    selectedNote = film.annotations.find((a) => a.id === selected),
    framing = !!region || !!selectedNote || selected === "webcam";
  const grab =
    (move: Drag["move"], select?: () => void) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      select?.();
      onBegin();
      drag.current = { x: e.clientX, y: e.clientY, move };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
  const handlers = {
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const host = (e.currentTarget as HTMLElement)
        .closest(".film-stage")!
        .getBoundingClientRect();
      d.move(
        e.clientX - d.x,
        e.clientY - d.y,
        e.clientX - host.left,
        e.clientY - host.top,
      );
    },
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  };
  const items: React.ReactNode[] = [];
  if (region) {
    const z = region.scale,
      fx = focusClamp(region.x, z),
      fy = focusClamp(region.y, z),
      w = fr.width / z,
      h = fr.height / z,
      left = fr.x + (fr.width * fx) / 100 - w / 2,
      top = fr.y + (fr.height * fy) / 100 - h / 2;
    // Resizing keeps whatever the box is touching pinned. In a corner both
    // edges hold, so the box grows and shrinks diagonally out of that corner;
    // against one edge only that edge holds; in open space it scales about
    // its centre. Pinning is decided when the drag starts, so the box never
    // jumps from one anchor to another mid-drag.
    const pin = (focus: number): "low" | "high" | "mid" =>
      z <= 1.001
        ? "mid"
        : focus <= 50 / z + 0.01
          ? "low"
          : focus >= 100 - 50 / z - 0.01
            ? "high"
            : "mid";
    const pinX = pin(fx),
      pinY = pin(fy);
    const resize = (_dx: number, _dy: number, px: number, py: number) => {
      const cx = fr.x + (fr.width * fx) / 100,
        cy = fr.y + (fr.height * fy) / 100,
        span = (
          p: number,
          mode: string,
          low: number,
          high: number,
          c: number,
        ) =>
          mode === "low"
            ? p - low
            : mode === "high"
              ? high - p
              : 2 * Math.abs(p - c),
        next = clamp(
          Math.min(
            fr.width / Math.max(1, span(px, pinX, left, left + w, cx)),
            fr.height / Math.max(1, span(py, pinY, top, top + h, cy)),
          ),
          1,
          3,
        ),
        scale = Math.round(next * 20) / 20,
        place = (mode: string, focus: number) =>
          mode === "low"
            ? 50 / scale
            : mode === "high"
              ? 100 - 50 / scale
              : focusClamp(focus, scale);
      onZoom(region, {
        scale,
        x: place(pinX, region.x),
        y: place(pinY, region.y),
      });
    };
    items.push(
      <div
        key="zoom"
        className="ov-zoom"
        style={{ left, top, width: w, height: h }}
        onPointerDown={grab((dx, dy) =>
          onZoom(region, {
            x: focusClamp(fx + (dx / fr.width) * 100, z),
            y: focusClamp(fy + (dy / fr.height) * 100, z),
          }),
        )}
        {...handlers}
      >
        <span>{z.toFixed(2).replace(/0$/, "")}× · drag to reframe</span>
        {(["nw", "ne", "sw", "se"] as const)
          // A handle on a pinned side can't move without unpinning it.
          .filter(
            (c) =>
              !(pinY === "low" && c[0] === "n") &&
              !(pinY === "high" && c[0] === "s") &&
              !(pinX === "low" && c[1] === "w") &&
              !(pinX === "high" && c[1] === "e"),
          )
          .map((c) => (
            <i
              key={c}
              className={`ov-corner ${c}`}
              aria-label="Resize zoom"
              onPointerDown={grab(resize)}
              {...handlers}
            />
          ))}
      </div>,
    );
  }
  for (const a of film.annotations) {
    const visible = time >= a.start && time <= a.end;
    if (!visible && a.id !== selected) continue;
    const isSelected = a.id === selected,
      left = fr.x + (fr.width * a.x) / 100,
      top = fr.y + (fr.height * a.y) / 100;
    if (a.type === "text") {
      if (!a.text.trim()) continue;
      const box = textLayout(measure, a, stage.width);
      items.push(
        <div
          key={a.id}
          className={`ov-text ${isSelected ? "selected" : ""}`}
          style={{ left, top, width: box.width, height: box.height }}
          title="Drag to move"
          onPointerDown={grab(
            (dx, dy) =>
              onAnnotation(a.id, {
                x: clamp(a.x + (dx / fr.width) * 100, 0, 100),
                y: clamp(a.y + (dy / fr.height) * 100, 0, 100),
              }),
            () => onSelect(a.id, "annotations"),
          )}
          {...handlers}
        />,
      );
    } else if (framing) {
      // Covers follow the camera; edit them against the full frame.
      const w = (fr.width * (a.width ?? 20)) / 100,
        h = (fr.height * (a.height ?? 10)) / 100;
      items.push(
        <div
          key={a.id}
          className={`ov-cover ${isSelected ? "selected" : ""}`}
          style={{ left, top, width: w, height: h }}
          onPointerDown={grab(
            (dx, dy) =>
              onAnnotation(a.id, {
                x: clamp(a.x + (dx / fr.width) * 100, 0, 100 - (a.width ?? 20)),
                y: clamp(
                  a.y + (dy / fr.height) * 100,
                  0,
                  100 - (a.height ?? 10),
                ),
              }),
            () => onSelect(a.id, "annotations"),
          )}
          {...handlers}
        >
          <span>Privacy cover</span>
          <i
            className="ov-corner se"
            aria-label="Resize cover"
            onPointerDown={grab((dx, dy) =>
              onAnnotation(a.id, {
                width: clamp(
                  (a.width ?? 20) + (dx / fr.width) * 100,
                  1,
                  100 - a.x,
                ),
                height: clamp(
                  (a.height ?? 10) + (dy / fr.height) * 100,
                  1,
                  100 - a.y,
                ),
              }),
            )}
            {...handlers}
          />
        </div>,
      );
    }
  }
  if (film.webcamId) {
    const d = (fr.width * s.webcamSize) / 100,
      cx = fr.x + (fr.width * s.webcamX) / 100,
      cy = fr.y + (fr.height * s.webcamY) / 100;
    items.push(
      <div
        key="webcam"
        className={`ov-webcam ${s.webcamShape} ${selected === "webcam" ? "selected" : ""}`}
        style={{ left: cx - d / 2, top: cy - d / 2, width: d, height: d }}
        title="Drag to move the webcam"
        onPointerDown={grab(
          (dx, dy) =>
            onSettings({
              webcamX: clamp(s.webcamX + (dx / fr.width) * 100, 0, 100),
              webcamY: clamp(s.webcamY + (dy / fr.height) * 100, 0, 100),
            }),
          () => onSelect("webcam", "webcam"),
        )}
        {...handlers}
      >
        <i
          className="ov-corner se"
          aria-label="Resize webcam"
          onPointerDown={grab((_dx, _dy, px, py) =>
            onSettings({
              webcamSize: Math.round(
                clamp(
                  ((2 * Math.max(Math.abs(px - cx), Math.abs(py - cy))) /
                    fr.width) *
                    100,
                  5,
                  60,
                ),
              ),
            }),
          )}
          {...handlers}
        />
      </div>,
    );
  }
  return (
    <div className={`film-overlay ${framing ? "framing" : ""}`}>{items}</div>
  );
}
