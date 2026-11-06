import { backgrounds, defaultSettings, type FilmData } from "./types";
export function validateFilm(value: unknown): asserts value is FilmData {
  const f = value as FilmData;
  const fail = () => {
    throw Error("Invalid video timeline.");
  };
  const number = (v: unknown, min: number, max: number): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (
    !f ||
    typeof f !== "object" ||
    !number(f.duration, 0.01, 28800) ||
    !number(f.trimStart, 0, f.duration) ||
    !number(f.trimEnd, f.trimStart + 0.001, f.duration) ||
    !number(f.speed, 0.25, 4)
  )
    fail();
  if (
    !Array.isArray(f.pointer) ||
    f.pointer.length > 2_000_000 ||
    !Array.isArray(f.clicks) ||
    !Array.isArray(f.zooms) ||
    !Array.isArray(f.annotations)
  )
    fail();
  const point = (p: { x: number; y: number }) =>
    p && number(p.x, 0, 100) && number(p.y, 0, 100);
  let previous = -1;
  for (const p of f.pointer) {
    if (
      !point(p) ||
      !number(p.t, previous, f.duration + 1) ||
      (p.kind && !["arrow", "hand", "text"].includes(p.kind))
    )
      fail();
    previous = p.t;
  }
  previous = -1;
  for (const c of f.clicks) {
    if (
      !point(c) ||
      !number(c.t, previous, f.duration + 1) ||
      typeof c.id !== "string" ||
      typeof c.label !== "string"
    )
      fail();
    previous = c.t;
  }
  for (const z of f.zooms)
    if (
      !point(z) ||
      typeof z.id !== "string" ||
      !number(z.start, 0, f.duration) ||
      !number(z.end, z.start + 0.001, f.duration) ||
      !number(z.scale, 1, 3)
    )
      fail();
  if (
    f.cuts !== undefined &&
    (!Array.isArray(f.cuts) ||
      f.cuts.some(
        (c) =>
          !c ||
          typeof c.id !== "string" ||
          !number(c.start, 0, f.duration) ||
          !number(c.end, c.start + 0.001, f.duration),
      ))
  )
    fail();
  if (
    f.dismissed !== undefined &&
    (!Array.isArray(f.dismissed) ||
      f.dismissed.some((d) => typeof d !== "string"))
  )
    fail();
  for (const a of f.annotations)
    if (
      !point(a) ||
      (a.size !== undefined && !number(a.size, 8, 160)) ||
      (a.theme !== undefined &&
        !["light", "dark", "accent"].includes(a.theme)) ||
      typeof a.id !== "string" ||
      typeof a.text !== "string" ||
      (a.width !== undefined && !number(a.width, 1, 100)) ||
      (a.height !== undefined && !number(a.height, 1, 100)) ||
      !["text", "cover"].includes(a.type) ||
      !number(a.start, 0, f.duration) ||
      !number(a.end, a.start + 0.001, f.duration)
    )
      fail();
  if (!f.settings || typeof f.settings !== "object") fail();
  const s = f.settings;
  for (const key of ["autoZoom", "cursorTilt", "clickEffect"] as const)
    if (typeof s[key] !== "boolean") fail();
  const limits = {
    zoom: [1, 3],
    cameraSmoothness: [0, 1],
    cursorSize: [12, 160],
    cursorSmoothing: [0, 1],
    padding: [0, 240],
    radius: [0, 100],
    shadow: [0, 100],
    systemVolume: [0, 1],
    micVolume: [0, 1],
    webcamSize: [5, 60],
    webcamX: [0, 100],
    webcamY: [0, 100],
  } as const;
  for (const [key, [min, max]] of Object.entries(limits))
    if (!number(s[key as keyof typeof limits], min, max)) fail();
  if (
    !["arrow", "dot", "native"].includes(s.cursorStyle) ||
    !["native", "16:9", "1:1", "9:16"].includes(s.aspect) ||
    !["circle", "rounded"].includes(s.webcamShape) ||
    !/^#[a-f\d]{6}$/i.test(s.cursorColor) ||
    !(
      Object.hasOwn(backgrounds, s.background) ||
      /^#[a-f\d]{6}$/i.test(s.background)
    )
  )
    fail();
  for (const id of [f.micId, f.webcamId])
    if (id !== undefined && typeof id !== "string") fail();
  if (
    f.audio !== undefined &&
    (!Array.isArray(f.audio) ||
      f.audio.some(
        (a) =>
          !a ||
          typeof a.assetId !== "string" ||
          !number(a.start, 0, f.duration) ||
          !number(a.end, a.start + 0.001, f.duration) ||
          !number(a.sourceStart, 0, 28800) ||
          !number(a.volume, 0, 1),
      ))
  )
    fail();
}
