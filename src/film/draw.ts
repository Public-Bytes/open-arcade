import type { FilmAnnotation, FilmData } from "./types";
import { backgrounds } from "./types";
import type { Pose } from "./motion";
import type { Redaction } from "../lib/model";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function filmDimensions(aspect: number, film: FilmData, width = 1920) {
  const p = film.settings.padding;
  const ratio =
    film.settings.aspect === "16:9"
      ? 16 / 9
      : film.settings.aspect === "1:1"
        ? 1
        : film.settings.aspect === "9:16"
          ? 9 / 16
          : (1920 + 2 * p) / (1920 / aspect + 2 * p);
  return {
    width: Math.round(width / 2) * 2,
    height: Math.round(width / ratio / 2) * 2,
  };
}
export const textThemes = {
  light: { background: "#ffffffee", color: "#1d1d1f" },
  dark: { background: "#1c1c1ee8", color: "#f5f5f7" },
  accent: { background: "#0a84ff", color: "#ffffff" },
};
const fontStack = 'Inter, -apple-system, "Segoe UI", Arial, sans-serif';
// Shared by the renderer and the editor's drag handles so both agree on size.
export function textLayout(
  ctx: { font: string; measureText(text: string): { width: number } },
  a: FilmAnnotation,
  width: number,
) {
  const size = ((a.size ?? 32) * width) / 1920,
    font = `600 ${size}px ${fontStack}`,
    lines = a.text.split("\n"),
    previous = ctx.font;
  ctx.font = font;
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.font = previous;
  const padX = size * 0.75,
    padY = size * 0.5,
    line = size * 1.3;
  return {
    size,
    font,
    lines,
    padX,
    padY,
    line,
    width: textWidth + padX * 2,
    height: line * lines.length + padY * 2,
  };
}
export function frameRect(
  width: number,
  height: number,
  aspect: number,
  padding: number,
) {
  const pad = (padding * width) / 1920,
    w = Math.min(width - 2 * pad, (height - 2 * pad) * aspect),
    h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
const cache = new WeakMap<
  object,
  { key: string; canvas: HTMLCanvasElement | OffscreenCanvas }
>();
export function drawFilm(
  ctx: Context,
  source: CanvasImageSource | OffscreenCanvas | undefined,
  sourceWidth: number,
  sourceHeight: number,
  film: FilmData,
  pose: Pose,
  time: number,
  options: {
    crop?: Redaction;
    redactions?: Redaction[];
    webcam?: CanvasImageSource | OffscreenCanvas;
    webcamWidth?: number;
    webcamHeight?: number;
  } = {},
) {
  const width = ctx.canvas.width,
    height = ctx.canvas.height,
    s = film.settings,
    crop = options.crop || { x: 0, y: 0, width: 100, height: 100 },
    sw = (sourceWidth * crop.width) / 100,
    sh = (sourceHeight * crop.height) / 100,
    rect = frameRect(width, height, sw / sh, s.padding),
    radius = (s.radius * width) / 1920;
  const key = [
    width,
    height,
    s.background,
    s.padding,
    s.radius,
    s.shadow,
    sw / sh,
  ].join(":");
  let background = cache.get(ctx);
  if (!background || background.key !== key) {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const c = canvas.getContext("2d") as Context;
    const colors = backgrounds[s.background]?.colors || [
      s.background,
      s.background,
      s.background,
    ];
    const g = c.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.5, colors[1]);
    g.addColorStop(1, colors[2]);
    c.fillStyle = g;
    c.fillRect(0, 0, width, height);
    c.shadowColor = "#0d201c50";
    c.shadowBlur = (s.shadow * width) / 1920;
    c.shadowOffsetY = (s.shadow * 0.3 * width) / 1920;
    c.fillStyle = "#fff";
    c.beginPath();
    c.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    c.fill();
    background = { key, canvas };
    cache.set(ctx, background);
  }
  ctx.drawImage(background.canvas, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.clip();
  ctx.translate(rect.x + rect.width * pose.x, rect.y + rect.height * pose.y);
  ctx.scale(pose.z, pose.z);
  if (source)
    ctx.drawImage(
      source as CanvasImageSource,
      (sourceWidth * crop.x) / 100,
      (sourceHeight * crop.y) / 100,
      sw,
      sh,
      0,
      0,
      rect.width,
      rect.height,
    );
  ctx.fillStyle = "#1c1c1e";
  for (const r of options.redactions || [])
    ctx.fillRect(
      (r.x / 100) * rect.width,
      (r.y / 100) * rect.height,
      (r.width / 100) * rect.width,
      (r.height / 100) * rect.height,
    );
  ctx.restore();
  for (const a of film.annotations) {
    if (time < a.start || time > a.end) continue;
    ctx.save();
    if (a.type === "cover") {
      // Covers hide content, so they move with the camera.
      const x = rect.x + rect.width * (pose.x + (a.x / 100) * pose.z),
        y = rect.y + rect.height * (pose.y + (a.y / 100) * pose.z);
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
      ctx.clip();
      ctx.fillStyle = "#1c1c1e";
      ctx.fillRect(
        x,
        y,
        ((rect.width * (a.width ?? 20)) / 100) * pose.z,
        ((rect.height * (a.height ?? 10)) / 100) * pose.z,
      );
    } else if (a.text.trim()) {
      // Text is a caption on the frame: it stays put while the camera moves.
      const box = textLayout(ctx, a, width),
        x = rect.x + (rect.width * a.x) / 100,
        y = rect.y + (rect.height * a.y) / 100,
        theme = textThemes[a.theme || "light"];
      ctx.globalAlpha = Math.min(1, (time - a.start) / 0.2, (a.end - time) / 0.2);
      ctx.translate(0, (1 - ctx.globalAlpha) * box.size * 0.3);
      ctx.font = box.font;
      ctx.fillStyle = theme.background;
      ctx.shadowColor = "#0003";
      ctx.shadowBlur = box.size * 0.6;
      ctx.shadowOffsetY = box.size * 0.12;
      ctx.beginPath();
      ctx.roundRect(x, y, box.width, box.height, box.size * 0.45);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = theme.color;
      ctx.textBaseline = "middle";
      box.lines.forEach((line, i) =>
        ctx.fillText(
          line,
          x + box.padX,
          y + box.padY + box.line * (i + 0.5),
        ),
      );
    }
    ctx.restore();
  }
  if (pose.visible && !film.cursorEmbedded && s.cursorStyle !== "native") {
    const x = rect.x + rect.width * (pose.x + pose.cx * pose.z),
      y = rect.y + rect.height * (pose.y + pose.cy * pose.z),
      size = (s.cursorSize * width) / 1920;
    if (s.clickEffect && pose.click > 0) {
      ctx.save();
      ctx.globalAlpha = (1 - pose.click) * 0.65;
      ctx.strokeStyle = s.cursorColor;
      ctx.lineWidth = (3 * width) / 1920;
      ctx.beginPath();
      ctx.arc(x, y, size * (0.2 + pose.click * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pose.angle);
    ctx.scale(
      (size / 36) * (1 - pose.click * 0.13),
      (size / 36) * (1 - pose.click * 0.13),
    );
    ctx.shadowColor = "#0006";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = s.cursorColor;
    ctx.strokeStyle = s.cursorColor === "#ffffff" ? "#1d1d1f" : "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    if (s.cursorStyle === "dot") {
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.translate(-2, -2);
      const path = new Path2D(
        "M3 2 Q1 1 1 5 L1 32 Q1 36 4 33 L11 26 L18 40 Q19 42 21 41 L25 39 Q27 38 26 36 L19 23 L31 23 Q35 23 32 20 Z",
      );
      ctx.fill(path);
      ctx.stroke(path);
    }
    ctx.restore();
  }
  if (options.webcam) {
    const diameter = (rect.width * s.webcamSize) / 100,
      x = rect.x + (rect.width * s.webcamX) / 100 - diameter / 2,
      y = rect.y + (rect.height * s.webcamY) / 100 - diameter / 2,
      nw = options.webcamWidth || 640,
      nh = options.webcamHeight || 480,
      side = Math.min(nw, nh);
    ctx.save();
    ctx.shadowColor = "#0004";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(
      x - 3,
      y - 3,
      diameter + 6,
      diameter + 6,
      s.webcamShape === "circle" ? diameter / 2 : diameter * 0.18,
    );
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.roundRect(
      x,
      y,
      diameter,
      diameter,
      s.webcamShape === "circle" ? diameter / 2 : diameter * 0.18,
    );
    ctx.clip();
    ctx.drawImage(
      options.webcam as CanvasImageSource,
      (nw - side) / 2,
      (nh - side) / 2,
      side,
      side,
      x,
      y,
      diameter,
      diameter,
    );
    ctx.restore();
  }
}
