import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
async function example(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open example video" }).click();
  await expect(page.getByLabel("Recording title")).toHaveValue(
    "A calmer place to work",
  );
  await expect(page.getByLabel("Video preview")).toHaveAttribute(
    "data-cursor-size",
    "70",
  );
}
async function saved(page: Page) {
  await expect(
    page.getByText("Saved on device", { exact: true }),
  ).toBeVisible();
}

test("immediate navigation saves edits and interrupted cursor checkpoints recover in the studio", async ({
  page,
}) => {
  await example(page);
  await page.getByLabel("Recording title").fill("A saved recording");
  await page
    .getByRole("button", { name: "Back to recordings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open A saved recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording title")).toHaveValue(
    "A saved recording",
  );
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("open-arcade", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const id = location.hash.split("/")[1];
    const p = await new Promise<any>((resolve) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get(id);
      request.onsuccess = () => resolve(request.result);
    });
    p.status = "recording";
    p.film.pointer = [];
    const tx = db.transaction(["projects", "chunks"], "readwrite");
    tx.objectStore("projects").put(p);
    tx.objectStore("chunks").put({
      id: id + ":events:0",
      projectId: id,
      order: 0,
      channel: "events",
      blob: new Blob(
        [
          JSON.stringify({
            pointer: [
              { t: 0, x: 10, y: 10 },
              { t: 8, x: 80, y: 80 },
            ],
            clicks: [],
          }),
        ],
        { type: "application/json" },
      ),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Recover saved media", exact: true })
    .click();
  await expect(page.locator(".st-recover")).toHaveCount(0);
  const pointerCount = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("open-arcade", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const id = location.hash.split("/")[1];
      const p = await new Promise<any>((resolve) => {
        const request = db.transaction("projects").objectStore("projects").get(id);
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return p.film.pointer.length;
    });
  await expect.poll(pointerCount).toBe(2);
  await page.reload();
  await expect(page.getByLabel("Recording title")).toBeVisible();
  await expect.poll(pointerCount).toBe(2);
});
function tone() {
  const samples = 44100 * 8,
    b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 44100) * 9000),
      44 + i * 2,
    );
  return b;
}

test("continuous preview, smooth camera, playful cursor, trims, undo and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await example(page);
  await expect(page.getByLabel("Video timeline")).toBeVisible();
  await expect(page.locator(".zoom-block")).toHaveCount(1);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect(page.getByLabel("Video preview")).toHaveCSS("cursor", "none");
  await expect
    .poll(async () =>
      Number(await page.locator("canvas").getAttribute("data-time")),
    )
    .toBeGreaterThan(3.7);
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await expect(page.getByLabel("Video preview")).toHaveCSS("cursor", "pointer");
  expect(
    Number(await page.locator("canvas").getAttribute("data-zoom")),
  ).toBeGreaterThan(1.7);
  const held = Number(await page.locator("canvas").getAttribute("data-time"));
  await page.waitForTimeout(160);
  expect(
    Number(await page.locator("canvas").getAttribute("data-time")),
  ).toBeCloseTo(held, 1);
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByLabel("Cursor size", { exact: true }).fill("100");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-cursor-size",
    "100",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-cursor-size",
    "70",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-cursor-size",
    "100",
  );
  await page.getByLabel("Trim in").fill("1");
  await page.getByLabel("Trim out").fill("7");
  await page.getByLabel("Video speed").selectOption("2");
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Trim in")).toHaveValue("1");
  await expect(page.getByLabel("Trim out")).toHaveValue("7");
  await expect(page.getByLabel("Video speed")).toHaveValue("2");
  await page.getByLabel("Video speed").selectOption("4");
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator("canvas").getAttribute("data-time")),
    )
    .toBeGreaterThan(4);
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await page.screenshot({ path: "artifacts/studio/editor.png" });
  expect(errors).toEqual([]);
});

test("playback does not chase its clock with seeks or clear the last frame during decoder stalls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = {
      seeks: 0,
      frames: 0,
      blankFrames: 0,
      hasSeenVideo: false,
      hasVideo: false,
      stall: false,
    };
    (window as any).playbackProbe = probe;
    const current = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "currentTime",
    )!;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      ...current,
      set(value) {
        if (this instanceof HTMLVideoElement) probe.seeks++;
        current.set!.call(this, value);
      },
    });
    const ready = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "readyState",
    )!;
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      ...ready,
      get() {
        return this instanceof HTMLVideoElement && probe.stall
          ? 1
          : ready.get!.call(this);
      },
    });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas.classList.contains("film-preview")) {
        if (args[0] instanceof OffscreenCanvas) {
          if (probe.hasSeenVideo && !probe.hasVideo) probe.blankFrames++;
          probe.frames++;
          probe.hasVideo = false;
        }
        if (args[0] instanceof HTMLVideoElement) {
          probe.hasVideo = true;
          probe.hasSeenVideo = true;
        }
      }
      return (draw as any).apply(this, args);
    };
  });
  await example(page);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator("canvas").getAttribute("data-time")),
    )
    .toBeGreaterThan(1);
  // Decoder unavailability must preserve the composed frame, never draw white.
  const held = await page.evaluate(() => {
    (window as any).playbackProbe.stall = true;
    return document.querySelector("canvas")!.dataset.time;
  });
  await page.waitForTimeout(180);
  expect(await page.locator("canvas").getAttribute("data-time")).toBe(held);
  await page.evaluate(() => {
    (window as any).playbackProbe.stall = false;
  });
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByLabel("Cursor size", { exact: true }).fill("100");
  await page.getByLabel("Cursor size", { exact: true }).fill("80");
  // Simulate GC/UI stalls that used to make the independent clock fall behind.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const until = performance.now() + 200;
      while (performance.now() < until) {
        /* deliberate load */
      }
    });
  }
  await expect
    .poll(async () =>
      Number(await page.locator("canvas").getAttribute("data-time")),
    )
    .toBeGreaterThan(5);
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  const probe = await page.evaluate(() => (window as any).playbackProbe);
  expect(probe.seeks).toBeLessThanOrEqual(1);
  expect(probe.blankFrames).toBe(0);
  expect(probe.frames).toBeGreaterThan(80);
});

test("frame-based MP4 export includes mixed audio, trimmed timing, webcam and covers; editable backup reopens", async ({
  page,
}) => {
  await example(page);
  await page.getByRole("checkbox", { name: /Zoom on clicks/ }).uncheck();
  await page.getByLabel("Trim in").fill("2");
  await page.getByLabel("Trim out").fill("4");
  await page.getByLabel("Video speed").selectOption("2");
  await page.locator('input[type=file][accept="audio/*"]').setInputFiles({
    name: "Voice.wav",
    mimeType: "audio/wav",
    buffer: tone(),
  });
  await page
    .locator('input[type=file][accept="video/*"]')
    .setInputFiles(resolve("public/example.mp4"));
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page
    .getByRole("button", { name: "Add privacy cover", exact: true })
    .click();
  await saved(page);
  const archiveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const archive = await archiveEvent;
  const archivePath = resolve("artifacts/studio/editable.arcade.zip");
  await archive.saveAs(archivePath);
  const files = unzipSync(new Uint8Array(await readFile(archivePath)));
  const project = JSON.parse(strFromU8(files["project.json"]));
  expect(project.film.audio).toHaveLength(1);
  expect(project.film.webcamId).toBeTruthy();
  expect(project.film.annotations[0].type).toBe("cover");
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("1280");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  const dl = await event;
  await dl.saveAs("artifacts/studio/with-audio.mp4");
  await expect(page.locator(".st-export-result")).toContainText("Ready in");
  const bytes = [...(await readFile((await dl.path())!))];
  const decoded = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
      url = URL.createObjectURL(blob),
      v = document.createElement("video");
    v.muted = true;
    v.src = url;
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = 0.2;
    await new Promise((r) => (v.onseeked = r));
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, 0, 0);
    const coverPixel = [
      ...ctx.getImageData(canvas.width * 0.42, canvas.height * 0.4, 1, 1).data,
    ];
    const audio = new AudioContext();
    try {
      const a = await audio.decodeAudioData(new Uint8Array(bytes).buffer);
      let peak = 0;
      for (const value of a.getChannelData(0))
        peak = Math.max(peak, Math.abs(value));
      return {
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
        peak,
        coverPixel,
      };
    } finally {
      URL.revokeObjectURL(url);
      await audio.close();
    }
  }, bytes);
  expect(decoded.duration).toBeCloseTo(1, 1);
  expect(decoded.width).toBe(1280);
  expect(decoded.peak).toBeGreaterThan(0.05);
  for (let i = 0; i < 3; i++)
    expect(Math.abs(decoded.coverPixel[i] - [23, 37, 28][i])).toBeLessThan(12);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator('input[type=file][accept*=".zip"]')
    .setInputFiles(archivePath);
  await expect(page.getByLabel("Recording title")).toHaveValue(
    "A calmer place to work (imported)",
  );
  await expect(page.locator(".webcam-track")).toBeVisible();
  await expect(page.locator(".audio-track")).toBeVisible();
  const restoredEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const restored = await restoredEvent;
  const restoredFiles = unzipSync(
    new Uint8Array(await readFile((await restored.path())!)),
  );
  const q = JSON.parse(strFromU8(restoredFiles["project.json"]));
  expect(q.film.webcamId).not.toBe(project.film.webcamId);
  expect(q.film.audio[0].assetId).not.toBe(project.film.audio[0].assetId);
  expect(restoredFiles["assets/" + q.film.webcamId]).toBeTruthy();
});

test("full 60 fps video renders without real-time waiting and remains playable", async ({
  page,
}) => {
  await example(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "16:9", exact: true }).click();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const event = page.waitForEvent("download");
  const started = Date.now();
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  const dl = await event;
  const exportWall = (Date.now() - started) / 1000;
  await dl.saveAs("artifacts/studio/demo.mp4");
  await expect(page.locator(".st-export-result")).toBeVisible();
  const result = await page.locator(".st-export-result").innerText();
  const bytes = [...(await readFile((await dl.path())!))];
  const meta = await page.evaluate(async (bytes) => {
    const v = document.createElement("video");
    v.muted = true;
    v.src = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
    );
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = 3.4;
    await new Promise((r) => (v.onseeked = r));
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const pixel = [...c.getContext("2d")!.getImageData(0, 0, 1, 1).data];
    await v.play();
    await new Promise((r) => setTimeout(r, 200));
    v.pause();
    return {
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      time: v.currentTime,
      pixel,
    };
  }, bytes);
  expect(meta.duration).toBeCloseTo(8, 1);
  expect(meta.width).toBe(1920);
  expect(meta.height).toBe(1080);
  expect(meta.time).toBeGreaterThan(3.5);
  expect(meta.pixel.slice(0, 3).reduce((a, b) => a + b, 0)).toBeGreaterThan(
    100,
  );
  await writeFile(
    "artifacts/studio/benchmark.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        wallSeconds: exportWall,
        result,
        ...meta,
      },
      null,
      2,
    ),
  );
});

test("export cancellation leaves the editor responsive and a small GIF completes", async ({
  page,
}) => {
  const readbackWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("willReadFrequently"))
      readbackWarnings.push(message.text());
  });
  await example(page);
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("3840");
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export MP4", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".st-toast")).toContainText("Export cancelled");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Trim out").fill("1");
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByRole("button", { name: /^GIF/ }).click();
  await page.getByLabel("Export resolution").selectOption("480");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIF", exact: true }).click();
  const gif = await event;
  const b = await readFile((await gif.path())!);
  expect(b.subarray(0, 6).toString()).toMatch(/^GIF8/);
  await gif.saveAs("artifacts/studio/demo.gif");
  expect(readbackWarnings).toEqual([]);
});

test("library fits a narrow screen and recording setup gives tab instructions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Make a little screen time/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "New recording", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/studio/mobile.png",
    fullPage: true,
  });
});

test("a cut section is removed from playback and export; slider drags undo in one step", async ({
  page,
}) => {
  await example(page);
  // One undo step for a burst of slider changes.
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  for (const size of ["80", "90", "100", "110"])
    await page.getByLabel("Cursor size", { exact: true }).fill(size);
  await expect(page.locator("canvas")).toHaveAttribute("data-cursor-size", "110");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-cursor-size", "70");
  // Cut 2.0–3.5 s with the keyboard and confirm the final length.
  await page.locator(".time-ruler").click({ position: { x: 1, y: 5 } });
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("x");
  await expect(page.locator(".cut-block")).toHaveCount(1);
  await expect(page.locator(".st-clock")).toContainText("/ 0:06.50");
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  const times: number[] = [];
  for (let i = 0; i < 40; i++) {
    times.push(Number(await page.locator("canvas").getAttribute("data-time")));
    await page.waitForTimeout(60);
  }
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  expect(times.some((t) => t > 3.5)).toBe(true);
  expect(times.filter((t) => t > 2.05 && t < 3.45)).toEqual([]);
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("1280");
  await page.getByLabel("Export frame rate").selectOption("30");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  const bytes = [...(await readFile((await (await event).path())!))];
  const duration = await page.evaluate(async (bytes) => {
    const v = document.createElement("video");
    v.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
    await new Promise((r) => (v.onloadedmetadata = r));
    return v.duration;
  }, bytes);
  expect(duration).toBeCloseTo(6.5, 1);
  // Delete restores the cut.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".cut-block").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".st-clock")).toContainText("/ 0:08.00");
});
