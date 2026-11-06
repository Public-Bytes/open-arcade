import { openDB, type DBSchema } from "idb";
import {
  type Project,
  type Asset,
  referencedAssets,
  remapAssets,
  uid,
} from "./model";
interface Schema extends DBSchema {
  projects: { key: string; value: Project };
  assets: { key: string; value: Asset; indexes: { projectId: string } };
  chunks: {
    key: string;
    value: {
      id: string;
      projectId: string;
      order: number;
      blob: Blob;
      channel?: "main" | "mic" | "camera" | "events";
    };
    indexes: { projectId: string };
  };
}
let database: ReturnType<typeof openDB<Schema>> | undefined;
const db = () =>
  (database ??= openDB<Schema>("open-arcade", 1, {
    upgrade(d) {
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("assets", { keyPath: "id" }).createIndex(
        "projectId",
        "projectId",
      );
      d.createObjectStore("chunks", { keyPath: "id" }).createIndex(
        "projectId",
        "projectId",
      );
    },
  }));
export const listProjects = async () =>
  (await (await db()).getAll("projects")).sort((a, b) => b.updated - a.updated);
export const getProject = async (id: string) =>
  (await db()).get("projects", id);
export const saveProject = async (p: Project) => {
  await (await db()).put("projects", p);
};
export const getAsset = async (id: string) => (await db()).get("assets", id);
export const putAsset = async (a: Asset) => {
  await (await db()).put("assets", a);
};
export const putChunk = async (
  projectId: string,
  order: number,
  blob: Blob,
  channel: "main" | "mic" | "camera" | "events" = "main",
) => {
  await (
    await db()
  ).put("chunks", {
    id:
      channel === "main"
        ? `${projectId}:${order}`
        : `${projectId}:${channel}:${order}`,
    projectId,
    order,
    blob,
    channel,
  });
};
export const chunksFor = async (
  id: string,
  channel: "main" | "mic" | "camera" | "events" = "main",
) =>
  (await (await db()).getAllFromIndex("chunks", "projectId", id))
    .filter((c) => (c.channel || "main") === channel)
    .sort((a, b) => a.order - b.order);
export async function clearChunks(id: string) {
  const d = await db();
  const keys = await d.getAllKeysFromIndex("chunks", "projectId", id);
  const t = d.transaction("chunks", "readwrite");
  for (const k of keys) t.store.delete(k);
  await t.done;
}
export async function deleteProject(id: string) {
  const d = await db();
  const a = await d.getAllKeysFromIndex("assets", "projectId", id);
  const c = await d.getAllKeysFromIndex("chunks", "projectId", id);
  const t = d.transaction(["projects", "assets", "chunks"], "readwrite");
  t.objectStore("projects").delete(id);
  for (const k of a) t.objectStore("assets").delete(k);
  for (const k of c) t.objectStore("chunks").delete(k);
  await t.done;
}
export async function duplicateProject(p: Project) {
  const q = structuredClone(p);
  q.id = uid();
  q.title += " (copy)";
  q.created = q.updated = Date.now();
  q.status = "draft";
  const map = new Map<string, string>();
  for (const id of referencedAssets(q)) {
    const a = await getAsset(id);
    if (a) {
      const next = uid();
      map.set(id, next);
      await putAsset({ id: next, projectId: q.id, blob: a.blob });
    }
  }
  remapAssets(q, map);
  await saveProject(q);
  return q;
}
export async function recoverProject(p: Project) {
  const chunks = await chunksFor(p.id);
  if (chunks.length) {
    await putAsset({
      id: `${p.id}-video`,
      projectId: p.id,
      blob: new Blob(
        chunks.map((c) => c.blob),
        { type: chunks[0].blob.type || "video/webm" },
      ),
    });
  }
  if (p.film) {
    const events = await chunksFor(p.id, "events");
    for (const item of events) {
      const data = JSON.parse(await item.blob.text());
      p.film.pointer.push(...data.pointer);
    }
    for (const channel of ["mic", "camera"] as const) {
      const data = await chunksFor(p.id, channel);
      if (data.length)
        await putAsset({
          id: `${p.id}-${channel}`,
          projectId: p.id,
          blob: new Blob(
            data.map((c) => c.blob),
            { type: data[0].blob.type },
          ),
        });
    }
  }
  p.status = "draft";
  p.updated = Date.now();
  await saveProject(p);
  await clearChunks(p.id);
  return p;
}
