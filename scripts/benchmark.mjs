import puppeteer from "puppeteer-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";
const seconds = 32;
const p = {
  id: "benchmark",
  version: 1,
  captureVersion: 3,
  title: "Render benchmark",
  description: "",
  created: 1,
  updated: 1,
  accent: "#b9ee70",
  background: "#e8ebe2",
  status: "draft",
  variables: {},
  steps: Array.from({ length: 4 }, (_, i) => ({
    id: "clip" + i,
    type: "video",
    title: "Recording",
    body: "",
    width: 1280,
    height: 800,
    assetId: "source",
    duration: 8,
    start: 0,
    end: 8,
    hotspots: [],
    zoom: 1,
    focus: { x: 50, y: 50 },
  })),
  film: {
    duration: seconds,
    trimStart: 0,
    trimEnd: seconds,
    speed: 1,
    pointer: [],
    clicks: [],
    zooms: [],
    annotations: [],
    settings: {
      zoom: 1.75,
      autoZoom: true,
      cameraSmoothness: 0.65,
      cursorSize: 70,
      cursorStyle: "arrow",
      cursorColor: "#ffffff",
      cursorSmoothing: 0.7,
      clickEffect: true,
      cursorTilt: true,
      padding: 42,
      radius: 18,
      shadow: 32,
      background: "aurora",
      aspect: "16:9",
      systemVolume: 1,
      micVolume: 1,
      webcamSize: 20,
      webcamX: 85,
      webcamY: 80,
      webcamShape: "circle",
    },
  },
};
for (let i = 0; i < 4; i++) {
  const points = [
    { t: 0, x: 45, y: 60 },
    { t: 1.8, x: 10, y: 23 },
    { t: 3.4, x: 82, y: 18 },
    { t: 5.2, x: 55, y: 52 },
    { t: 8, x: 60, y: 60 },
  ];
  for (let n = 0; n <= 240; n++) {
    const t = n / 30;
    let j = 0;
    while (j < 3 && points[j + 1].t < t) j++;
    const a = points[j],
      b = points[j + 1],
      q = (t - a.t) / (b.t - a.t),
      e = q * q * (3 - 2 * q);
    p.film.pointer.push({
      t: t + i * 8,
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
    });
  }
  for (let j = 1; j < 4; j++)
    p.film.clicks.push({
      ...points[j],
      t: points[j].t + i * 8,
      id: i + "-" + j,
      label: "Click",
    });
}
await mkdir("artifacts/studio", { recursive: true });
const zipPath = resolve("artifacts/studio/benchmark-input.zip");
await writeFile(
  zipPath,
  zipSync(
    {
      "project.json": strToU8(JSON.stringify(p)),
      "media.json": strToU8(JSON.stringify({ source: "video/mp4" })),
      "assets/source": await readFile("public/example.mp4"),
    },
    { level: 0 },
  ),
);
const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(process.env.STUDIO_URL || "http://127.0.0.1:4173");
  const input = await page.$('input[accept*=".zip"]');
  await input.uploadFile(zipPath);
  await page.waitForSelector(".film-preview");
  const cdp = await b.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: resolve("artifacts/studio"),
    eventsEnabled: true,
  });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Export video")
      .click(),
  );
  await page.waitForSelector(".st-export-submit");
  await page.evaluate(() => {
    window.frameGaps = [];
    window.checkFrames = true;
    let last = performance.now();
    const tick = (now) => {
      window.frameGaps.push(now - last);
      last = now;
      if (window.checkFrames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const start = Date.now();
  await page.click(".st-export-submit");
  await page.waitForSelector(".st-export-result", { timeout: 120000 });
  const wall = (Date.now() - start) / 1000;
  const result = await page.evaluate(() => {
    window.checkFrames = false;
    const gaps = window.frameGaps.sort((a, b) => a - b);
    return {
      text: document.querySelector(".st-export-result").textContent,
      uiFrameP95Ms: gaps[Math.floor(gaps.length * 0.95)],
      uiFrames: gaps.length,
    };
  });
  const record = {
    date: new Date().toISOString(),
    browser: await b.version(),
    duration: seconds,
    width: 1920,
    height: 1080,
    fps: 60,
    frames: seconds * 60,
    wallSeconds: wall,
    ...result,
  };
  console.log(JSON.stringify(record, null, 2));
  await writeFile(
    "artifacts/studio/benchmark-32s.json",
    JSON.stringify(record, null, 2),
  );
  await page.screenshot({ path: "artifacts/studio/benchmark-result.png" });
} finally {
  await b.close();
}
