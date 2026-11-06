import { test, expect } from "vitest";
import { blankFilm } from "../src/film/types";
import { createMotion, autoZooms } from "../src/film/motion";
import {
  newProject,
  newStep,
  referencedAssets,
  validateProject,
} from "../src/lib/model";
import {
  putAsset,
  getAsset,
  duplicateProject,
  deleteProject,
  putChunk,
  recoverProject,
} from "../src/lib/db";
import { filmArchive } from "../src/film/archive";
import { importProject } from "../src/lib/export";
import { ensureFilm } from "../src/film/project";

test("cursor filtering has no following delay and lands exactly on click timestamps", () => {
  const f = blankFilm(3);
  f.pointer = Array.from({ length: 181 }, (_, i) => ({
    t: i / 60,
    x: 10 + (i / 180) * 80,
    y: 30,
  }));
  const motion = createMotion(f);
  for (let t = 0.2; t < 2.8; t += 0.037)
    expect(motion.at(t).cx * 100).toBeCloseTo(10 + (t / 3) * 80, 3);
  f.clicks = [{ id: "click", t: 1.013, x: 55, y: 42, label: "Click" }];
  const anchored = createMotion(f).at(1.013);
  expect(anchored.cx).toBeCloseTo(0.55, 8);
  expect(anchored.cy).toBeCloseTo(0.42, 8);
});
test("older recordings use their embedded cursor once; clean captures keep the separate cursor", () => {
  const p = newProject();
  p.captureVersion = 3;
  p.film = blankFilm(3);
  const legacy = ensureFilm(p);
  expect(legacy.film!.cursorEmbedded).toBe(true);
  expect(p.film.cursorEmbedded).toBeUndefined();
  p.captureVersion = 4;
  p.film.cursorEmbedded = false;
  expect(ensureFilm(p).film!.cursorEmbedded).toBe(false);
});
test("event-only telemetry holds still over idle periods instead of drifting toward the next movement", () => {
  const f = blankFilm(5);
  f.cursorRecorded = true;
  f.pointer = [
    { t: 0, x: 10, y: 10 },
    { t: 4, x: 90, y: 90 },
    { t: 5, x: 90, y: 90 },
  ];
  const path = createMotion(f);
  expect(path.at(2).cx).toBeCloseTo(0.1, 8);
  expect(path.at(3.9).cy).toBeCloseTo(0.1, 8);
  expect(path.at(4.5).cx).toBeCloseTo(0.9, 8);
});

test("nearby clicks share one camera move, with continuous motion and no exposed frame edges", () => {
  const f = blankFilm(12);
  f.clicks = [
    { id: "a", t: 2, x: 8, y: 20, label: "A" },
    { id: "b", t: 3.5, x: 90, y: 40, label: "B" },
    { id: "c", t: 5, x: 60, y: 90, label: "C" },
  ];
  const motion = createMotion(f);
  expect(autoZooms(f)).toHaveLength(1);
  for (let t = 2; t < 6; t += 1 / 60)
    expect(motion.at(t).z).toBeGreaterThan(1.65);
  let previous = motion.at(0),
    maxZoomChange = 0,
    maxPanChange = 0;
  for (let t = 1 / 60; t < 12; t += 1 / 60) {
    const pose = motion.at(t);
    maxZoomChange = Math.max(maxZoomChange, Math.abs(pose.z - previous.z));
    maxPanChange = Math.max(
      maxPanChange,
      Math.abs(pose.x - previous.x),
      Math.abs(pose.y - previous.y),
    );
    expect(pose.x).toBeLessThanOrEqual(0.00001);
    expect(pose.y).toBeLessThanOrEqual(0.00001);
    expect(pose.x + pose.z).toBeGreaterThanOrEqual(0.99999);
    expect(pose.y + pose.z).toBeGreaterThanOrEqual(0.99999);
    previous = pose;
  }
  expect(maxZoomChange).toBeLessThan(0.05);
  expect(maxPanChange).toBeLessThan(0.08);
  expect(motion.at(10).z).toBeCloseTo(1, 4);
});
test("an early first click eases in from the full view instead of starting at full zoom", () => {
  const f = blankFilm(4);
  f.clicks = [{ id: "first", t: 0.25, x: 80, y: 20, label: "Click" }];
  const motion = createMotion(f);
  expect(motion.at(0).z).toBe(1);
  expect(motion.at(0.1).z).toBeLessThan(1.3);
  expect(motion.at(1).z).toBeGreaterThan(1.7);
  for (let t = 1 / 60; t < 1; t += 1 / 60)
    expect(Math.abs(motion.at(t).z - motion.at(t - 1 / 60).z)).toBeLessThan(
      0.05,
    );
});
test("manual regions override automatic camera moves and cursor at coordinate zero stays there", () => {
  const f = blankFilm(8);
  f.pointer = [
    { t: 0, x: 0, y: 0 },
    { t: 8, x: 0, y: 0 },
  ];
  f.clicks = [
    { id: "a", t: 2, x: 10, y: 10, label: "" },
    { id: "b", t: 4, x: 80, y: 70, label: "" },
  ];
  f.zooms = [
    {
      id: "manual",
      start: 2.5,
      end: 5,
      scale: 2.5,
      x: 50,
      y: 50,
      automatic: false,
    },
  ];
  const m = createMotion(f);
  expect(m.at(3.8).z).toBeGreaterThan(2.4);
  expect(m.at(0).cx).toBe(0);
  const stationary = blankFilm(3);
  stationary.pointer = [
    { t: 0, x: 0, y: 0 },
    { t: 3, x: 0, y: 0 },
  ];
  expect(createMotion(stationary).at(2).cy).toBe(0);
});
test("editable movie round trip and duplication retain independent microphone, webcam, and audio assets", async () => {
  const p = newProject("A movie");
  const s = newStep("video");
  s.start = 0;
  s.end = s.duration = 5;
  s.assetId = p.id + "video";
  p.steps = [s];
  p.film = blankFilm(5);
  p.film.micId = p.id + "mic";
  p.film.webcamId = p.id + "cam";
  p.film.audio = [
    { assetId: p.id + "music", start: 0, end: 5, sourceStart: 0, volume: 0.5 },
  ];
  for (const id of referencedAssets(p))
    await putAsset({
      id,
      projectId: p.id,
      blob: new Blob([id], {
        type:
          id.endsWith("mic") || id.endsWith("music")
            ? "audio/webm"
            : "video/mp4",
      }),
    });
  const zip = await filmArchive(p);
  const q = await importProject(new File([zip], "movie.zip"));
  const copy = await duplicateProject(q);
  expect(referencedAssets(q)).toHaveLength(4);
  expect(referencedAssets(copy)).toHaveLength(4);
  expect(
    referencedAssets(q).every((id) => !referencedAssets(p).includes(id)),
  ).toBe(true);
  await deleteProject(p.id);
  await deleteProject(q.id);
  for (const id of referencedAssets(copy))
    expect((await getAsset(id))?.blob.size).toBeGreaterThan(0);
});
test("recovery restores cursor metadata and auxiliary media from separate chunk channels", async () => {
  const p = newProject();
  p.film = blankFilm(3);
  p.film.micId = p.id + "-mic";
  p.film.webcamId = p.id + "-camera";
  p.status = "recording";
  await putChunk(p.id, 0, new Blob(["video"], { type: "video/mp4" }));
  await putChunk(p.id, 0, new Blob(["mic"], { type: "audio/webm" }), "mic");
  await putChunk(p.id, 0, new Blob(["cam"], { type: "video/mp4" }), "camera");
  await putChunk(
    p.id,
    0,
    new Blob([
      JSON.stringify({ pointer: [{ t: 1, x: 20, y: 30 }], clicks: [] }),
    ]),
    "events",
  );
  const q = await recoverProject(p);
  expect(q.film?.pointer).toEqual([{ t: 1, x: 20, y: 30 }]);
  expect(await (await getAsset(q.film!.micId!))?.blob.text()).toBe("mic");
  expect(await (await getAsset(q.film!.webcamId!))?.blob.text()).toBe("cam");
});
test("malformed or unordered timeline data is rejected before it reaches the renderer", () => {
  const p = newProject();
  p.film = blankFilm(5);
  expect(() => validateProject(p)).not.toThrow();
  p.film.speed = 0;
  expect(() => validateProject(p)).toThrow("Invalid video timeline");
  p.film.speed = 1;
  p.film.pointer = [
    { t: 3, x: 30, y: 20 },
    { t: 1, x: 10, y: 20 },
  ];
  expect(() => validateProject(p)).toThrow();
});
test("cut sections are skipped in output time and the mapping round-trips", async () => {
  const { segments, outputDuration, sourceTime, outputTime, playable } =
    await import("../src/film/time");
  const f = blankFilm(10);
  f.trimStart = 1;
  f.trimEnd = 9;
  f.speed = 2;
  f.cuts = [
    { id: "a", start: 3, end: 4 },
    { id: "b", start: 0, end: 1.5 },
  ];
  expect(segments(f)).toEqual([
    { start: 1.5, end: 3, out: 0 },
    { start: 4, end: 9, out: 0.75 },
  ]);
  expect(outputDuration(f)).toBeCloseTo(3.25, 8);
  expect(sourceTime(f, 0)).toBeCloseTo(1.5, 8);
  expect(sourceTime(f, 0.75)).toBeCloseTo(4, 8);
  expect(sourceTime(f, 3.25)).toBeCloseTo(9, 8);
  for (const t of [1.6, 2.9, 4.2, 8.5])
    expect(sourceTime(f, outputTime(f, t))).toBeCloseTo(t, 8);
  expect(outputTime(f, 3.5)).toBeCloseTo(0.75, 8);
  expect(playable(f, 3.5)).toBe(4);
  expect(playable(f, 0.2)).toBe(1.5);
  f.cuts = [{ id: "all", start: 0, end: 10 }];
  expect(outputDuration(f)).toBe(0);
});
test("a deleted automatic zoom stays deleted without disabling the others", () => {
  const f = blankFilm(10);
  f.clicks = [
    { id: "one", t: 1, x: 20, y: 20, label: "A" },
    { id: "two", t: 7, x: 80, y: 80, label: "B" },
  ];
  expect(autoZooms(f).map((z) => z.id)).toEqual(["auto-one", "auto-two"]);
  f.dismissed = ["auto-one"];
  expect(autoZooms(f).map((z) => z.id)).toEqual(["auto-two"]);
});
test("a zoom never pans: it scales straight into the box and ignores the cursor", () => {
  const f = blankFilm(6);
  f.cursorRecorded = true;
  // The cursor sweeps across the frame while zoomed; the camera must not care.
  f.pointer = Array.from({ length: 361 }, (_, i) => ({
    t: i / 60,
    x: 10 + (i / 360) * 80,
    y: 20 + (i / 360) * 60,
  }));
  for (const follow of [undefined, true, false]) {
    f.zooms = [
      { id: "z", start: 1, end: 4, scale: 1.8, x: 70, y: 30, automatic: false, follow },
    ];
    const motion = createMotion(f);
    // One fixed point stays put on screen for the whole move in and out.
    const fixed = (p: { x: number; z: number }) => p.x / (1 - p.z);
    const fixedY = (p: { y: number; z: number }) => p.y / (1 - p.z);
    const first = motion.at(1.5);
    for (let t = 1.1; t < 5.9; t += 1 / 30) {
      const pose = motion.at(t);
      if (pose.z < 1.01) continue;
      expect(fixed(pose)).toBeCloseTo(fixed(first), 6);
      expect(fixedY(pose)).toBeCloseTo(fixedY(first), 6);
    }
    // And at full zoom the box's centre is the centre of the frame.
    const held = motion.at(3.9);
    expect((0.5 - held.x) / held.z).toBeCloseTo(0.7, 3);
    expect((0.5 - held.y) / held.z).toBeCloseTo(0.3, 3);
  }
});
test("a zoom pushed to the frame edge shows exactly the box the editor draws", () => {
  const f = blankFilm(6);
  f.zooms = [
    // Dragging the box against the edges stores the clamped focus.
    { id: "z", start: 0.5, end: 6, scale: 1.95, x: 50 / 1.95, y: 100 - 50 / 1.95, automatic: false, follow: false },
  ];
  const pose = createMotion(f).at(5);
  // The editor's box for this zoom: hugging the left and bottom edges.
  expect(pose.z).toBeCloseTo(1.95, 3);
  expect(-pose.x / pose.z).toBeCloseTo(0, 3); // left edge of the view
  expect((1 - pose.y) / pose.z).toBeCloseTo(1, 3); // bottom edge of the view
  // Just inside the edge, the view is exactly where the box says too.
  f.zooms[0] = { ...f.zooms[0], x: 30, y: 50 };
  const inside = createMotion(f).at(5);
  expect(-inside.x / inside.z).toBeCloseTo(0.3 - 0.5 / 1.95, 3);
});
