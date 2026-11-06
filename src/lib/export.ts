import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { getAsset, putAsset, saveProject } from "./db";
import {
  uid,
  referencedAssets,
  remapAssets,
  validateProject,
  type Project,
} from "./model";
import { blobData } from "./media";
import { mountPlayer } from "./player";
import playerCSS from "./player.css?raw";
import { trimVideo } from "./trim";
import { normalizeCapture, cropImage } from "./capture-media";
import { cameraFrame } from "./camera";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const filename = (p: Project) =>
  p.title
    .replace(/[^a-z0-9 _-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "demo";
export async function assetData(p: Project) {
  const data: Record<string, string> = {};
  for (const id of referencedAssets(p)) {
    const a = await getAsset(id);
    if (!a)
      throw Error(
        "A media asset is missing. Recover the recording or replace the missing step.",
      );
    data[id] = await blobData(a.blob);
  }
  return data;
}
async function prepareExport(original: Project) {
  const p = await normalizeCapture(
      structuredClone(original),
      async (id) => (await getAsset(id))?.blob,
    ),
    blobs: Record<string, Blob> = {};
  for (const s of p.steps) s.posterId = undefined;
  for (const id of referencedAssets(p)) {
    const a = await getAsset(id);
    if (!a) throw Error("Missing project media.");
    blobs[id] = a.blob;
  }
  for (const s of p.steps) {
    if (s.type === "image" && s.assetId && s.crop) {
      const id = uid();
      blobs[id] = await cropImage(blobs[s.assetId], s.crop);
      s.assetId = id;
      s.crop = undefined;
    }
    if (s.type !== "video" || !s.assetId) continue;
    const old = s.assetId,
      id = uid();
    blobs[id] = await trimVideo(
      blobs[old],
      s.start || 0,
      s.end || s.duration,
      s.redactions,
      s.crop,
    );
    s.assetId = id;
    s.redactions = [];
    s.crop = undefined;
    s.end = (s.end || s.duration) - (s.start || 0);
    s.start = 0;
    s.duration = s.end;
    s.sourceDuration = s.end;
  }
  const used = new Set(referencedAssets(p));
  for (const id of Object.keys(blobs)) if (!used.has(id)) delete blobs[id];
  return { project: p, blobs };
}
async function portableData(original: Project) {
  const { project, blobs } = await prepareExport(original);
  const media: Record<string, string> = {};
  for (const [id, blob] of Object.entries(blobs))
    media[id] = await blobData(blob);
  return { project, media };
}
const escaped = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function portableHTML(original: Project) {
  const { project: p, media: data } = await portableData(original);
  const json = JSON.stringify({ project: p, media: data })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped(p.title)}</title><style>html,body{margin:0;min-height:100%;background:${p.background}}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}#demo{max-width:1200px;width:100%}${playerCSS}</style></head><body><main id="demo" aria-label="Interactive demo"></main><script type="application/json" id="demo-data">${json}</script><script>const data=JSON.parse(document.getElementById('demo-data').textContent);(${mountPlayer.toString()})(document.getElementById('demo'),data.project,data.media,{autoplay:true},${cameraFrame.toString()});</script></body></html>`;
}
export async function exportProject(original: Project) {
  const { project: p, blobs } = await prepareExport(original);
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(p, null, 2)),
  };
  const meta: Record<string, string> = {};
  for (const [id, blob] of Object.entries(blobs)) {
    files[`assets/${id}`] = new Uint8Array(await blob.arrayBuffer());
    meta[id] = blob.type;
  }
  files["media.json"] = strToU8(JSON.stringify(meta));
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}
export async function importProject(file: File) {
  if (/\.html?$/i.test(file.name)) return importHTML(file);
  if (file.size > 1024 * 1024 * 1024)
    throw Error("Project archive is too large.");
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files["project.json"] || !files["media.json"])
    throw Error("Choose an Open Arcade project archive.");
  const p: unknown = JSON.parse(strFromU8(files["project.json"]));
  validateProject(p);
  const types = JSON.parse(strFromU8(files["media.json"]));
  const old = referencedAssets(p);
  p.id = uid();
  p.title += " (imported)";
  p.created = p.updated = Date.now();
  p.status = "draft";
  const map = new Map<string, string>();
  const pending = [];
  for (const id of old) {
    if (
      !files[`assets/${id}`] ||
      typeof types[id] !== "string" ||
      !/^((image\/(png|jpeg|webp|gif))|(video\/(webm|mp4))|(audio\/[a-z0-9.+-]+))($|;)/i.test(
        types[id],
      )
    )
      throw Error("Missing or unsupported media in archive.");
    const next = uid();
    map.set(id, next);
    pending.push({
      id: next,
      projectId: p.id,
      blob: new Blob([new Uint8Array(files[`assets/${id}`])], {
        type: types[id],
      }),
    });
  }
  remapAssets(p, map);
  for (const a of pending) await putAsset(a);
  await saveProject(p);
  return p;
}
export async function exportGuide(original: Project) {
  const { project: p, media } = await portableData(original);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escaped(p.title)}</title><style>body{max-width:900px;margin:60px auto;font:16px/1.6 Arial;padding:20px;color:#203328}h1{font-size:44px}section{margin:60px 0;break-inside:avoid}img,video{width:100%;border-radius:12px}p{white-space:pre-wrap}@media print{video{display:none}}</style><h1>${escaped(p.title)}</h1><p>${escaped(p.description)}</p>${p.steps.map((s, i) => `<section><h2>${i + 1}. ${escaped(s.title)}</h2><p>${escaped(s.body)}</p>${s.assetId ? (s.type === "video" ? `<video controls src="${media[s.assetId]}#t=${s.start},${s.end}"></video>` : `<img alt="${escaped(s.title)}" src="${media[s.assetId]}">`) : ""}</section>`).join("")}</html>`;
  return new Blob([html], { type: "text/html" });
}

export async function importHTML(file: File) {
  const html = await file.text();
  const match = html.match(
    /<script type="application\/json" id="demo-data">([\s\S]*?)<\/script>/,
  );
  if (!match)
    throw Error("This HTML file does not contain an Open Arcade project.");
  const data = JSON.parse(match[1]);
  validateProject(data.project);
  const blobs: Record<string, Blob> = {};
  for (const id of referencedAssets(data.project)) {
    const src = data.media?.[id];
    if (
      typeof src !== "string" ||
      !/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|audio\/[a-z0-9.+-]+)[;,]/i.test(
        src,
      )
    )
      throw Error("Unsupported embedded media.");
    const at = src.indexOf(";base64,");
    if (at < 0) throw Error("Unsupported embedded media encoding.");
    blobs[id] = new Blob(
      [Uint8Array.from(atob(src.slice(at + 8)), (c) => c.charCodeAt(0))],
      { type: src.slice(5, src.indexOf(";")) },
    );
  }
  const p = await normalizeCapture(data.project, async (id) => blobs[id]);
  p.id = uid();
  p.status = "draft";
  p.created = p.updated = Date.now();
  const map = new Map<string, string>();
  for (const old of referencedAssets(p)) {
    const id = uid();
    map.set(old, id);
    await putAsset({ id, projectId: p.id, blob: blobs[old] });
  }
  remapAssets(p, map);
  await saveProject(p);
  return p;
}
