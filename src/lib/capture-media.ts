import type { Project, Redaction, Step } from "./model";
import { getAsset, saveProject } from "./db";
export async function contentPadding(
  blob: Blob,
): Promise<
  | { crop: Redaction; width: number; height: number; leading?: number }
  | undefined
> {
  const url = URL.createObjectURL(blob);
  let source: HTMLImageElement | HTMLVideoElement;
  let leading = 0;
  try {
    if (blob.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true;
      v.src = url;
      await new Promise<void>((r, j) => {
        v.onloadeddata = () => r();
        v.onerror = () => j(Error("Could not inspect captured video."));
      });
      const probe = document.createElement("canvas");
      probe.width = probe.height = 16;
      const context = probe.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(v, 0, 0, 16, 16);
      const initial = context.getImageData(0, 0, 16, 16).data;
      let lit = false;
      for (let i = 0; i < initial.length; i += 4)
        if (initial[i] > 10 || initial[i + 1] > 10 || initial[i + 2] > 10)
          lit = true;
      if (!lit) leading = 0.15;
      await new Promise<void>((r) => {
        const timer = setTimeout(r, 1500);
        v.onseeked = () => {
          clearTimeout(timer);
          r();
        };
        v.currentTime = Number.isFinite(v.duration)
          ? Math.min(0.15, v.duration * 0.5)
          : 0.15;
      });
      source = v;
    } else {
      const i = new Image();
      i.src = url;
      await i.decode();
      source = i;
    }
    const width =
        source instanceof HTMLVideoElement
          ? source.videoWidth
          : source.naturalWidth,
      height =
        source instanceof HTMLVideoElement
          ? source.videoHeight
          : source.naturalHeight;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const darkRow = (y: number) => {
      for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 256))) {
        const at = (y * width + x) * 4;
        if (pixels[at] > 10 || pixels[at + 1] > 10 || pixels[at + 2] > 10)
          return false;
      }
      return true;
    };
    let top = 0,
      bottom = height;
    while (top < height * 0.3 && darkRow(top)) top++;
    while (bottom > height * 0.7 && darkRow(bottom - 1)) bottom--;
    const vertical =
      top < height * 0.3 &&
      bottom > height * 0.7 &&
      top >= height * 0.015 &&
      height - bottom >= height * 0.015 &&
      Math.abs(top - (height - bottom)) <= Math.max(4, height * 0.01);
    if (!vertical) {
      top = 0;
      bottom = height;
    }
    const darkColumn = (x: number) => {
      for (
        let y = top;
        y < bottom;
        y += Math.max(1, Math.floor((bottom - top) / 256))
      ) {
        const at = (y * width + x) * 4;
        if (pixels[at] > 10 || pixels[at + 1] > 10 || pixels[at + 2] > 10)
          return false;
      }
      return true;
    };
    let left = 0,
      right = width;
    while (left < width * 0.3 && darkColumn(left)) left++;
    while (right > width * 0.7 && darkColumn(right - 1)) right--;
    const horizontal =
      left < width * 0.3 &&
      right > width * 0.7 &&
      left >= width * 0.015 &&
      width - right >= width * 0.015 &&
      Math.abs(left - (width - right)) <= Math.max(4, width * 0.01);
    if (!horizontal) {
      left = 0;
      right = width;
    }
    if (!vertical && !horizontal && !leading) return undefined;
    return {
      width: right - left,
      height: bottom - top,
      leading,
      crop: {
        x: (left / width) * 100,
        y: (top / height) * 100,
        width: ((right - left) / width) * 100,
        height: ((bottom - top) / height) * 100,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function normalizeCapture(
  p: Project,
  asset: (id: string) => Promise<Blob | undefined>,
): Promise<Project> {
  if (p.captureVersion === 2 || p.steps[0]?.title !== "Start here") return p;
  const q = structuredClone(p);
  if (
    q.steps.length > 1 &&
    q.steps[0].type === "image" &&
    q.steps[1].type === "image" &&
    q.steps[0].assetId &&
    !q.steps[0].body &&
    q.steps[0].hotspots.length === 0 &&
    q.steps[1].title.startsWith("Click ")
  ) {
    const initial = q.steps.shift()!;
    q.steps[0].assetId = initial.assetId;
  }
  const inspected = new Map<
    string,
    Awaited<ReturnType<typeof contentPadding>>
  >();
  for (const s of q.steps) {
    if (!s.assetId || s.type === "chapter" || s.crop) continue;
    if (!inspected.has(s.assetId)) {
      const blob = await asset(s.assetId);
      inspected.set(s.assetId, blob ? await contentPadding(blob) : undefined);
    }
    const found = inspected.get(s.assetId);
    if (found) {
      s.crop = found.crop;
      s.width = found.width;
      s.height = found.height;
      if (
        s.type === "video" &&
        found.leading &&
        (s.start || 0) < found.leading
      ) {
        s.start = found.leading;
        s.duration = s.end! - s.start;
      }
    }
  }
  q.captureVersion = 2;
  return q;
}
export async function repairStoredCapture(p: Project) {
  const q = await normalizeCapture(p, async (id) => (await getAsset(id))?.blob);
  if (q !== p) await saveProject(q);
  return q;
}
export async function cropImage(blob: Blob, crop: Redaction): Promise<Blob> {
  const bitmap = await createImageBitmap(blob),
    c = document.createElement("canvas");
  c.width = Math.round((bitmap.width * crop.width) / 100);
  c.height = Math.round((bitmap.height * crop.height) / 100);
  c.getContext("2d")!.drawImage(
    bitmap,
    (bitmap.width * crop.x) / 100,
    (bitmap.height * crop.y) / 100,
    c.width,
    c.height,
    0,
    0,
    c.width,
    c.height,
  );
  bitmap.close();
  return new Promise((r, j) =>
    c.toBlob(
      (b) => (b ? r(b) : j(Error("Could not crop captured image."))),
      "image/png",
    ),
  );
}
