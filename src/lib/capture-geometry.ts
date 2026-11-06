/** Chrome may letterbox the tab into a display-sized stream. Use the tab viewport, not the display, as the recording bounds. */
export function captureRect(
  width: number,
  height: number,
  viewport: { width: number; height: number },
) {
  const ratio = viewport.width / viewport.height,
    streamRatio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0)
    return { x: 0, y: 0, width, height };
  if (ratio > streamRatio) {
    const h = Math.max(1, Math.floor(width / ratio));
    return { x: 0, y: Math.round((height - h) / 2), width, height: h };
  }
  const w = Math.max(1, Math.floor(height * ratio));
  return { x: Math.round((width - w) / 2), y: 0, width: w, height };
}
