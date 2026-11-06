import type { Step } from "./model";
/** Shared camera math for the HTML player and frame-by-frame video/GIF renders. */
export function cameraFrame(step: Step, time: number, duration: number) {
  const manual = step.zoom > 1.001,
    target = manual ? step.focus : step.hotspots[0] || step.focus;
  const peak =
    step.motion === false
      ? step.zoom
      : manual
        ? step.zoom
        : step.hotspots.length
          ? 1.75
          : 1;
  const ease = (n: number) => {
    const x = Math.max(0, Math.min(1, n));
    return x * x * x * (x * (x * 6 - 15) + 10);
  };
  const enter = Math.min(0.9, duration * 0.32),
    exit = Math.min(0.65, duration * 0.23),
    lead = Math.min(0.15, duration * 0.05);
  const clickAmount = step.click
    ? ease(
        (time - Math.max(0, step.click.time - 0.65)) /
          Math.max(0.1, Math.min(0.65, step.click.time)),
      ) *
      (1 - ease((time - step.click.time - 0.15) / 0.65))
    : undefined;
  const amount =
    step.motion === false
      ? 1
      : (clickAmount ??
        Math.min(
          ease((time - lead) / Math.max(0.01, enter)),
          ease((duration - time) / Math.max(0.01, exit)),
        ));
  const zoom = 1 + (peak - 1) * amount;
  const tx = Math.min(0, Math.max(100 - zoom * 100, 50 - target.x * zoom));
  const ty = Math.min(0, Math.max(100 - zoom * 100, 50 - target.y * zoom));
  return { zoom, tx, ty };
}
