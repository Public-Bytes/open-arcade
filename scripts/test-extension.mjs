import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
const executable =
  process.env.CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);
if (!executable)
  throw Error(
    "Set CHROME_PATH to a current Chrome/Chromium executable supporting Extensions.triggerAction.",
  );
const fixture = await readFile(
  new URL("../tests/fixtures/recorder.html", import.meta.url),
);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(fixture);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const fixtureURL = `http://127.0.0.1:${server.address().port}/fixture.html`;
const browser = await puppeteer.launch({
  executablePath: executable,
  headless: true,
  defaultViewport: null,
  pipe: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    "--enable-unsafe-extension-debugging",
    "--window-size=1280,900",
    "--autoplay-policy=no-user-gesture-required",
    "--auto-accept-this-tab-capture",
  ],
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const client = await browser.target().createCDPSession();
  const { id } = await client.send("Extensions.loadUnpacked", {
    path: resolve("dist"),
  });
  const worker = await (
    await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().includes(id),
    )
  ).worker();
  const target = await browser.newPage();
  await target.goto(process.env.TEST_URL || fixtureURL);
  const viewport = await target.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  async function popup() {
    await target.bringToFront();
    const { targetInfos } = await client.send("Target.getTargets", {
      filter: [{ type: "tab" }],
    });
    const info = targetInfos.find((t) => t.url === target.url());
    assert(info);
    const pending = browser.waitForTarget(
      (t) => t.url() === `chrome-extension://${id}/popup.html`,
      { timeout: 10000 },
    );
    await client.send("Extensions.triggerAction", {
      id,
      targetId: info.targetId,
    });
    const p = await (await pending).asPage();
    await p.waitForSelector(".popup .text-button");
    return p;
  }
  const state = () =>
    worker.evaluate(() => chrome.storage.session.get("session"));
  const readProject = (projectId) =>
    worker.evaluate(async (projectId) => {
      const db = await new Promise((r, j) => {
        const q = indexedDB.open("open-arcade", 1);
        q.onsuccess = () => r(q.result);
        q.onerror = () => j(q.error);
      });
      return await new Promise((r, j) => {
        const q = db
          .transaction("projects")
          .objectStore("projects")
          .get(projectId);
        q.onsuccess = () => r(q.result);
        q.onerror = () => j(q.error);
      });
    }, projectId);
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await delay(100);
    }
    console.error(
      "Recording state:",
      await state(),
      "popup",
      !p.isClosed()
        ? await p.evaluate(() => document.body.innerText)
        : "closed",
      "targets",
      browser.targets().map((t) => t.url()),
    );
    for (const page of await browser.pages())
      if (page.url().includes(id))
        console.error(
          page.url(),
          await page
            .evaluate(() => document.body.innerText)
            .catch(() => "closed"),
        );
    throw Error("Timed out waiting for recording state.");
  };
  let p = await popup();
  await p.click(".dark-button");
  await wait(async () => !!(await state()).session);
  await wait(async () => p.isClosed());
  const first = (await state()).session.projectId;
  Object.assign(
    viewport,
    await target.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  );
  console.log("PASS: recording starts from the real extension action");
  await delay(350);
  await target.click("#change");
  await target.type("input", "New product", { delay: 80 });
  await target.evaluate(() => window.scrollTo(0, 700));
  await delay(1300);
  p = await popup();
  await p.click(".full-secondary");
  await wait(async () => (await state()).session?.paused === true);
  await p.close();
  const before = (await readProject(first)).film.clicks.length;
  await target.evaluate(() => window.scrollTo(0, 0));
  await target.click("#change");
  await delay(500);
  assert.equal((await readProject(first)).film.clicks.length, before);
  console.log("PASS: paused interactions do not add cursor or click events");
  p = await popup();
  await p.click(".full-secondary");
  await wait(async () => (await state()).session?.paused === false);
  await p.close();
  await target.evaluate(() => window.scrollTo(0, 0));
  await target.click("a");
  await target
    .waitForNavigation({ waitUntil: "load", timeout: 1000 })
    .catch(() => {});
  await delay(500);
  await target.click("#change");
  await delay(500);
  const snapshot = await readProject(first);
  assert.equal(snapshot.film.clicks.length, 3);
  assert.equal(snapshot.steps.length, 1);
  assert.equal(snapshot.steps[0].type, "video");
  assert.equal(snapshot.film.clicks[0].label, "Click Open project");
  assert(
    Math.abs(
      snapshot.steps[0].width / snapshot.steps[0].height -
        viewport.width / viewport.height,
    ) < 0.02,
  );
  console.log(
    "PASS: continuous video and three accurately timed clicks survive navigation and resume",
  );
  const editorPromise = browser.waitForTarget((t) =>
    t.url().includes(`index.html#project/${first}`),
  );
  p = await popup();
  await p.click(".dark-button");
  const editor = await (await editorPromise).asPage();
  await editor.waitForSelector(".film-preview");
  await editor.setViewport({ width: 1440, height: 1000 });
  const done = await readProject(first);
  assert.equal(done.status, "draft");
  assert.equal(done.captureVersion, 4);
  assert.equal(done.film.cursorEmbedded, false);
  assert(done.steps.every((s) => s.posterId));
  assert(done.film.pointer.length > 5);
  assert(done.film.clicks.length === 3);
  assert(done.film.pointer.every((v, i, a) => i === 0 || v.t >= a[i - 1].t));
  const captureCheck = await editor.evaluate(async (project) => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("open-arcade", 1);
      q.onsuccess = () => r(q.result);
    });
    const asset = await new Promise((r) => {
      const q = db
        .transaction("assets")
        .objectStore("assets")
        .get(project.steps[0].assetId);
      q.onsuccess = () => r(q.result);
    });
    const v = document.createElement("video");
    v.muted = true;
    const url = URL.createObjectURL(asset.blob);
    v.src = url;
    await new Promise((r) => (v.onloadeddata = r));
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const sample = async (time) => {
      v.currentTime = Math.max(0.001, time);
      await new Promise((r) => (v.onseeked = r));
      ctx.drawImage(v, 0, 0);
      return [
        ...ctx.getImageData(
          (c.width * (project.steps[0].crop?.x || 0)) / 100 + 10,
          (c.height * (project.steps[0].crop?.y || 0)) / 100 + 10,
          1,
          1,
        ).data,
      ];
    };
    const first = project.steps[0],
      click = project.film.clicks[0].t,
      before = await sample(click - 0.12),
      after = await sample(click + 0.2);
    const lastClick = project.film.clicks.at(-1).t;
    const lastBefore = await sample(lastClick - 0.12),
      lastAfter = await sample(lastClick + 0.2);
    const duration = v.duration;
    URL.revokeObjectURL(url);
    return { before, after, click, lastClick, lastBefore, lastAfter, duration };
  }, done);
  assert(captureCheck.before[1] > captureCheck.before[0]);
  assert(captureCheck.after[0] > captureCheck.after[1] * 2);
  assert(captureCheck.lastBefore[1] > captureCheck.lastBefore[0]);
  assert(captureCheck.lastAfter[0] > captureCheck.lastAfter[1] * 2);
  assert(Math.abs(captureCheck.duration - done.film.duration) < 0.3);
  console.log(
    "PASS: first and post-resume clicks match actual video transitions, with no letterboxing or pause-time drift",
  );
  await mkdir("artifacts", { recursive: true });
  await editor.screenshot({ path: "artifacts/recorded-editor.png" });
  console.log(
    "PASS: finish opens the video studio with a continuous recording and separate cursor track",
  );
  const errors = [];
  editor.on("pageerror", (e) => errors.push(e.message));
  await editor.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Export video")
      .click(),
  );
  await editor.waitForSelector(".st-export-submit");
  const downloads = resolve("artifacts/extension-downloads");
  await mkdir(downloads, { recursive: true });
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  let filename, downloadId;
  client.on("Browser.downloadWillBegin", (e) => {
    filename = e.suggestedFilename;
    downloadId = e.guid;
  });
  const complete = new Promise((r) =>
    client.on("Browser.downloadProgress", (e) => {
      if (e.state === "completed") r();
    }),
  );
  await editor.click(".st-export-submit");
  let deadline;
  try {
    await Promise.race([
      complete,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(Error("MP4 export did not complete.")),
          45000,
        );
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
  assert(filename.endsWith(".mp4"));
  const exported = await readFile(resolve(downloads, downloadId));
  await writeFile(resolve(downloads, "recorded-tab.mp4"), exported);
  assert(exported.length > 10000);
  assert(exported.subarray(4, 8).toString() === "ftyp");
  const result = await editor.$eval(".st-export-result", (e) => e.textContent);
  console.log("PASS: actual recorded tab renders to a local MP4: " + result);
  assert.deepEqual(errors, []);
  p = await popup();
  await p.click(".dark-button");
  await wait(async () => !!(await state()).session);
  const second = (await state()).session.projectId;
  assert.notEqual(second, first);
  await delay(300);
  await target.click("#change");
  await delay(1400);
  await worker.evaluate(() => chrome.offscreen.closeDocument());
  p = await popup();
  await wait(async () => !(await state()).session);
  await p.close();
  const recovered = await readProject(second);
  assert.equal(recovered.status, "draft");
  assert(recovered.steps.length === 1);
  assert(recovered.film.pointer.length > 0);
  assert.equal((await state()).session, undefined);
  console.log("PASS: repeated recording works and interrupted media recovers");
  // Synthetic device streams keep this test away from the machine's real mic/camera.
  const syntheticDevices = () => {
    const native = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.video?.mandatory?.chromeMediaSource === "tab")
        return native(constraints);
      const tracks = [];
      if (constraints.audio) {
        const ctx = new AudioContext(),
          destination = ctx.createMediaStreamDestination(),
          oscillator = ctx.createOscillator();
        oscillator.frequency.value = 440;
        oscillator.connect(destination);
        oscillator.start();
        tracks.push(...destination.stream.getAudioTracks());
      }
      if (constraints.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        let n = 0;
        const timer = setInterval(() => {
          ctx.fillStyle = "#317b80";
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = "#f5c894";
          ctx.beginPath();
          ctx.arc(320 + Math.sin(n++ / 20) * 40, 240, 120, 0, Math.PI * 2);
          ctx.fill();
        }, 33);
        const stream = canvas.captureStream(30);
        tracks.push(...stream.getVideoTracks());
        const stop = tracks.at(-1).stop.bind(tracks.at(-1));
        tracks.at(-1).stop = () => {
          clearInterval(timer);
          stop();
        };
      }
      return new MediaStream(tracks);
    };
  };
  await worker.evaluate(() => {
    const create = chrome.offscreen.createDocument.bind(chrome.offscreen);
    chrome.offscreen.createDocument = async (options) => {
      await create(options);
      await new Promise((r) => setTimeout(r, 1200));
    };
  });
  const offscreenPatch = browser
    .waitForTarget((t) => t.url() === `chrome-extension://${id}/offscreen.html`)
    .then(async (target) => {
      const page = await target.asPage();
      await page.evaluate(syntheticDevices);
    });
  p = await popup();
  await p.evaluate(() => {
    for (const label of document.querySelectorAll("label"))
      if (/^(Microphone|Webcam)/.test(label.textContent))
        label.querySelector("input").click();
  });
  const setupPromise = browser
    .waitForTarget(
      (t) => t.url().startsWith(`chrome-extension://${id}/permissions.html`),
      { timeout: 5000 },
    )
    .catch(() => null);
  await p.click(".dark-button");
  const setupTarget = await setupPromise;
  if (setupTarget) {
    const setup = await setupTarget.asPage();
    await setup.waitForSelector("#allow");
    await setup.evaluate(syntheticDevices);
    await setup.click("#allow");
  }
  await wait(async () => !!(await state()).session);
  await offscreenPatch;
  const third = (await state()).session.projectId;
  await target.mouse.move(50, 50);
  await target.mouse.move(400, 300, { steps: 20 });
  await target.click("#change");
  await delay(1800);
  const thirdEditorPromise = browser.waitForTarget((t) =>
    t.url().includes(`index.html#project/${third}`),
  );
  p = await popup();
  await p.click(".dark-button");
  const thirdEditor = await (await thirdEditorPromise).asPage();
  await thirdEditor.waitForSelector(".film-preview");
  const deviceProject = await readProject(third);
  assert(deviceProject.film.micId && deviceProject.film.webcamId);
  const sizes = await thirdEditor.evaluate(
    async (ids) => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("open-arcade", 1);
        q.onsuccess = () => r(q.result);
      });
      return Promise.all(
        ids.map(
          (id) =>
            new Promise((r) => {
              const q = db.transaction("assets").objectStore("assets").get(id);
              q.onsuccess = () => r(q.result?.blob.size || 0);
            }),
        ),
      );
    },
    [deviceProject.film.micId, deviceProject.film.webcamId],
  );
  assert(sizes.every((size) => size > 1000));
  await thirdEditor.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Export video")
      .click(),
  );
  await thirdEditor.waitForSelector(".st-export-submit");
  await thirdEditor.click(".st-export-submit");
  await thirdEditor.waitForSelector(".st-export-result", { timeout: 45000 });
  console.log(
    "PASS: permission setup, microphone + webcam recording, and combined MP4 render with synthetic device streams",
  );
  await writeFile(
    "artifacts/extension-verification.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: await browser.version(),
        firstProject: {
          steps: done.steps.length,
          images: done.steps.filter((s) => s.type === "image").length,
          videos: done.steps.filter((s) => s.type === "video").length,
          clickTimes: done.film.clicks,
          cursorPoints: done.film.pointer.length,
          render: result,
          viewport: {
            width: done.steps[0].width,
            height: done.steps[0].height,
          },
          transitionPixels: captureCheck,
        },
        recoveredSteps: recovered.steps.length,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
