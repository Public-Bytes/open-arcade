import type { FilmData } from "../film/types";
import { validateFilm } from "../film/validate";
export type Redaction = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Hotspot = Point & { id: string; label: string; target: string };
export type Step = {
  id: string;
  type: "image" | "video" | "chapter";
  title: string;
  body: string;
  assetId?: string;
  width: number;
  height: number;
  hotspots: Hotspot[];
  zoom: number;
  motion?: boolean;
  crop?: Redaction;
  recorded?: boolean;
  posterId?: string;
  click?: { time: number; x: number; y: number; sequence: number };
  focus: Point;
  start?: number;
  end?: number;
  sourceDuration?: number;
  redactions?: Redaction[];
  duration: number;
  narrationId?: string;
  cta?: { label: string; url: string };
};
export type Project = {
  id: string;
  version: 1;
  captureVersion?: number;
  film?: FilmData;
  title: string;
  description: string;
  created: number;
  updated: number;
  accent: string;
  background: string;
  steps: Step[];
  status: "draft" | "recording" | "ready";
  variables: Record<string, string>;
};
export type Asset = { id: string; projectId: string; blob: Blob };
export const uid = () => crypto.randomUUID();
export function newStep(type: Step["type"] = "chapter"): Step {
  return {
    id: uid(),
    type,
    title: type === "chapter" ? "A new chapter" : "Untitled step",
    body: "",
    width: 1440,
    height: 900,
    hotspots: [],
    zoom: 1,
    focus: { x: 50, y: 50 },
    duration: 3,
  };
}
export function newProject(title = "Untitled demo"): Project {
  const now = Date.now();
  return {
    id: uid(),
    version: 1,
    title,
    description: "",
    created: now,
    updated: now,
    accent: "#b9ee70",
    background: "#e8ebe2",
    steps: [],
    status: "draft",
    variables: {},
  };
}
export function nextIndex(p: Project, index: number, target?: string): number {
  if (target === "end") return p.steps.length;
  if (target && target !== "next") {
    const i = p.steps.findIndex((s) => s.id === target);
    if (i >= 0) return i;
  }
  return Math.min(index + 1, p.steps.length);
}
export function interpolate(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) =>
    Object.hasOwn(variables, key) ? variables[key] : `{{${key}}}`,
  );
}
export function safeUrl(url: string) {
  try {
    const u = new URL(url);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
export function referencedAssets(p: Project) {
  return [
    ...new Set([
      ...(p.film?.micId ? [p.film.micId] : []),
      ...(p.film?.webcamId ? [p.film.webcamId] : []),
      ...(p.film?.audio || []).map((a) => a.assetId),
      ...p.steps
        .flatMap((s) => [s.assetId, s.narrationId, s.posterId])
        .filter((id): id is string => !!id),
    ]),
  ];
}
export function remapAssets(p: Project, map: Map<string, string>) {
  for (const s of p.steps) {
    if (s.assetId) s.assetId = map.get(s.assetId);
    if (s.narrationId) s.narrationId = map.get(s.narrationId);
    if (s.posterId) s.posterId = map.get(s.posterId);
  }
  if (p.film) {
    if (p.film.micId) p.film.micId = map.get(p.film.micId);
    if (p.film.webcamId) p.film.webcamId = map.get(p.film.webcamId);
    for (const layer of p.film.audio || []) {
      const id = map.get(layer.assetId);
      if (!id) throw Error("An audio asset is missing.");
      layer.assetId = id;
    }
  }
}
export function validateProject(p: unknown): asserts p is Project {
  if (!p || typeof p !== "object") throw Error("Invalid project file.");
  const q = p as Project;
  if (q.film !== undefined) validateFilm(q.film);
  if (
    q.version !== 1 ||
    typeof q.id !== "string" ||
    typeof q.title !== "string" ||
    typeof q.description !== "string" ||
    !Array.isArray(q.steps)
  )
    throw Error("Unsupported or invalid project.");
  if (
    !/^#[0-9a-f]{6}$/i.test(q.accent) ||
    !/^#[0-9a-f]{6}$/i.test(q.background)
  )
    throw Error("Invalid project colors.");
  if (
    !q.variables ||
    typeof q.variables !== "object" ||
    Object.values(q.variables).some((v) => typeof v !== "string")
  )
    throw Error("Invalid variables.");
  const ids = new Set<string>();
  for (const s of q.steps) {
    if (
      !s ||
      typeof s.id !== "string" ||
      ids.has(s.id) ||
      !["chapter", "image", "video"].includes(s.type) ||
      typeof s.title !== "string" ||
      typeof s.body !== "string" ||
      (s.assetId !== undefined && typeof s.assetId !== "string") ||
      (s.narrationId !== undefined && typeof s.narrationId !== "string") ||
      (s.cta !== undefined &&
        (!s.cta ||
          typeof s.cta.label !== "string" ||
          typeof s.cta.url !== "string")) ||
      !Array.isArray(s.hotspots) ||
      !Number.isFinite(s.width) ||
      s.width <= 0 ||
      !Number.isFinite(s.height) ||
      s.height <= 0 ||
      !Number.isFinite(s.duration) ||
      s.duration <= 0 ||
      !Number.isFinite(s.zoom) ||
      s.zoom < 1 ||
      s.zoom > 3 ||
      !s.focus ||
      ![s.focus.x, s.focus.y].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 100,
      )
    )
      throw Error("Invalid step data.");
    if (
      s.redactions !== undefined &&
      (!Array.isArray(s.redactions) ||
        s.redactions.some(
          (r) =>
            !r ||
            ![r.x, r.y, r.width, r.height].every(
              (v) => Number.isFinite(v) && v >= 0 && v <= 100,
            ),
        ))
    )
      throw Error("Invalid redaction.");
    if (
      s.crop &&
      ![s.crop.x, s.crop.y, s.crop.width, s.crop.height].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 100,
      )
    )
      throw Error("Invalid crop.");
    if (
      s.click &&
      (!Number.isFinite(s.click.time) ||
        s.click.time < 0 ||
        ![s.click.x, s.click.y].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 100,
        ))
    )
      throw Error("Invalid click timing.");
    ids.add(s.id);
    for (const h of s.hotspots)
      if (
        !h ||
        typeof h.id !== "string" ||
        typeof h.label !== "string" ||
        typeof h.target !== "string" ||
        ![h.x, h.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
      )
        throw Error("Invalid hotspot.");
    if (
      s.type === "video" &&
      (!Number.isFinite(s.start) ||
        !Number.isFinite(s.end) ||
        s.start! < 0 ||
        s.end! <= s.start!)
    )
      throw Error("Invalid video trim.");
  }
}
