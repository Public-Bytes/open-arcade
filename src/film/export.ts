import { getAsset } from "../lib/db";
import { referencedAssets, type Project } from "../lib/model";
import { ensureFilm } from "./project";
export type RenderProgress = { value: number; fps: number };
export async function exportFilm(
  original: Project,
  options: {
    format: "mp4" | "gif";
    width: number;
    fps: number;
    quality: number;
  },
  progress: (p: RenderProgress) => void,
  signal?: AbortSignal,
) {
  const project = ensureFilm(original),
    assets: Record<string, Blob> = {};
  for (const id of referencedAssets(project)) {
    const a = await getAsset(id);
    if (!a) throw Error("A recording file is missing.");
    assets[id] = a.blob;
  }
  const worker = new Worker(new URL("./export-worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<{
    blob: Blob;
    extension: string;
    elapsed: number;
    duration: number;
    frames: number;
    width: number;
    height: number;
  }>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      reject(Error("Export cancelled."));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    const clean = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    worker.onerror = (e) => {
      clean();
      reject(Error(e.message || "Video export failed."));
    };
    worker.onmessage = (e) => {
      if (e.data.type === "progress") progress(e.data);
      if (e.data.type === "error") {
        clean();
        reject(Error(e.data.message));
      }
      if (e.data.type === "done") {
        const d = e.data;
        clean();
        resolve({
          blob: new Blob([d.buffer], { type: d.mime }),
          extension: d.extension,
          elapsed: d.elapsed,
          duration: d.duration,
          frames: d.frames,
          width: d.width,
          height: d.height,
        });
      }
    };
    worker.postMessage({ project, assets, ...options });
  });
}
