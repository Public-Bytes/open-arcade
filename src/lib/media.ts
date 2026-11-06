import { putAsset } from "./db";
import { webmDuration } from "./webm";
import { newStep, uid, type Project, type Step } from "./model";
export const blobData = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const f = new FileReader();
    f.onload = () => resolve(f.result as string);
    f.onerror = () => reject(f.error);
    // A comma in a codec MIME parameter would terminate a data URL early.
    f.readAsDataURL(
      blob.slice(
        0,
        blob.size,
        blob.type.split(";")[0] || "application/octet-stream",
      ),
    );
  });
export async function addMedia(p: Project, files: File[]): Promise<Step[]> {
  const result: Step[] = [];
  for (const file of files) {
    if (
      !/^(image\/(png|jpeg|webp|gif)|video\/(webm|mp4)|audio\/)/.test(file.type)
    )
      throw Error(`Unsupported media: ${file.name}`);
    const url = URL.createObjectURL(file);
    try {
      const video = file.type.startsWith("video/");
      const s = newStep(video ? "video" : "image");
      s.title = file.name.replace(/\.[^.]+$/, "");
      if (video) {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = url;
        await new Promise<void>((r, j) => {
          v.onloadedmetadata = () => r();
          v.onerror = () => j(Error("Unable to read video."));
        });
        const duration = Number.isFinite(v.duration)
          ? v.duration
          : await webmDuration(file);
        s.width = v.videoWidth;
        s.height = v.videoHeight;
        s.start = 0;
        s.end = duration;
        s.duration = s.end;
        s.sourceDuration = s.end;
      } else {
        const img = new Image();
        img.src = url;
        await img.decode();
        s.width = img.naturalWidth;
        s.height = img.naturalHeight;
      }
      s.assetId = uid();
      await putAsset({ id: s.assetId, projectId: p.id, blob: file });
      result.push(s);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return result;
}
export async function redactImage(
  blob: Blob,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = "#18251f";
  ctx.fillRect(
    (rect.x / 100) * c.width,
    (rect.y / 100) * c.height,
    (rect.width / 100) * c.width,
    (rect.height / 100) * c.height,
  );
  bitmap.close();
  return new Promise((r, j) =>
    c.toBlob((b) => (b ? r(b) : j(Error("Redaction failed."))), "image/png"),
  );
}
