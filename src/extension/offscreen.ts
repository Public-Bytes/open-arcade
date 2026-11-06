import {
  getProject,
  saveProject,
  putAsset,
  putChunk,
  clearChunks,
  chunksFor,
} from "../lib/db";
import { newStep, uid, type Project } from "../lib/model";
import { blankFilm } from "../film/types";
import type { CaptureEvent } from "./protocol";
import { captureRect } from "../lib/capture-geometry";
const now = () => performance.timeOrigin + performance.now();
const canvas = document.querySelector("canvas")!;
const context = canvas.getContext("2d", { alpha: false })!;
let canvasTrack: CanvasCaptureMediaStreamTrack;
let tabAudio: MediaStream | undefined;
function refreshFrame() {
  if (!canvasTrack) return;
  canvasTrack.requestFrame();
  // A manual canvas track captures on a draw. Requesting a frame alone on a
  // static canvas leaves the final/idle frame uncommitted.
  context.drawImage(canvas, 0, 0);
}
async function paint(data: string) {
  if (stopping || paused) return;
  const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
    type: "image/jpeg",
  });
  const bitmap = await createImageBitmap(blob);
  try {
    const rect = captureRect(bitmap.width, bitmap.height, viewport);
    canvasTrack?.requestFrame();
    context.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } finally {
    bitmap.close();
  }
}
let p: Project | undefined,
  main: MediaStream,
  mic: MediaStream | undefined,
  webcam: MediaStream | undefined,
  recorder: MediaRecorder,
  micRecorder: MediaRecorder | undefined,
  cameraRecorder: MediaRecorder | undefined,
  audioOutput: AudioContext | undefined;
let started = 0,
  pauseAt = 0,
  pausedMs = 0,
  paused = false,
  stopping = false,
  order = 0,
  metadataOrder = 0,
  checkpoint: ReturnType<typeof setInterval> | undefined,
  viewport = { width: 16, height: 9 },
  writes = Promise.resolve(),
  metadata: { pointer: unknown[]; clicks: unknown[] } = {
    pointer: [],
    clicks: [],
  };
const enqueue = (fn: () => Promise<void>) => {
  writes = writes.catch(() => {}).then(fn);
  return writes;
};
const elapsed = () => ((paused ? pauseAt : now()) - started - pausedMs) / 1000;
async function persist() {
  if (!p?.film) return;
  const duration = Math.max(0.05, elapsed());
  p.film.duration = p.film.trimEnd = duration;
  const clip = p.steps[0];
  clip.end = clip.duration = clip.sourceDuration = duration;
  p.updated = Date.now();
  await saveProject({ ...p, film: { ...p.film, pointer: [] } });
}
async function flushMetadata() {
  if (!p || (!metadata.pointer.length && !metadata.clicks.length)) return;
  const data = metadata;
  metadata = { pointer: [], clicks: [] };
  await putChunk(
    p.id,
    metadataOrder++,
    new Blob([JSON.stringify(data)], { type: "application/json" }),
    "events",
  );
}
async function event(e: CaptureEvent) {
  if (!p?.film || paused) return;
  if (e.viewport) viewport = e.viewport;
  if (e.kind === "viewport") return;
  const t = Math.max(0, (e.time - started - pausedMs) / 1000);
  if (e.kind === "pointer" || e.kind === "click") {
    const point = {
      t,
      x: e.x ?? p.film.pointer.at(-1)?.x ?? 50,
      y: e.y ?? p.film.pointer.at(-1)?.y ?? 50,
      kind: e.cursor || ("arrow" as const),
      visible: e.visible !== false,
    };
    p.film.pointer.push(point);
    metadata.pointer.push(point);
  }
  if (e.kind === "click") {
    const click = { id: uid(), t, x: e.x ?? 50, y: e.y ?? 50, label: e.label };
    p.film.clicks.push(click);
    metadata.clicks.push(click);
    await persist();
  }
}
const mime = (audio: boolean) =>
  [
    "video/mp4;codecs=avc1.42002a" + (audio ? ",mp4a.40.2" : ""),
    "video/mp4",
    "video/webm;codecs=vp8" + (audio ? ",opus" : ""),
    "video/webm",
  ].find((s) => MediaRecorder.isTypeSupported(s));
function attach(rec: MediaRecorder, channel: "main" | "mic" | "camera") {
  let n = 0;
  rec.ondataavailable = (e) => {
    if (e.data.size) {
      const index = n++;
      void enqueue(async () => {
        await putChunk(p!.id, index, e.data, channel);
        if (channel === "main") {
          await flushMetadata();
          if (!stopping) await persist();
        }
      });
    }
  };
}
async function start(m: {
  projectId: string;
  streamId: string;
  viewport?: { width: number; height: number; pixelRatio?: number };
  initialFrame: string;
  systemAudio?: boolean;
  microphone?: boolean;
  camera?: boolean;
}) {
  p = await getProject(m.projectId);
  if (!p) throw Error("Recording is missing.");
  if (m.viewport) viewport = m.viewport;
  const scale = Math.min(
    m.viewport?.pixelRatio || 1,
    1920 / viewport.width,
    1440 / viewport.height,
  );
  canvas.width = Math.round((viewport.width * scale) / 2) * 2;
  canvas.height = Math.round((viewport.height * scale) / 2) * 2;
  await paint(m.initialFrame);
  const stream = canvas.captureStream(0);
  canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  if (m.systemAudio) {
    tabAudio = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: m.streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    });
  }
  main = new MediaStream([
    ...stream.getVideoTracks(),
    ...(tabAudio?.getAudioTracks() || []),
  ]);
  const step = newStep("video");
  step.recorded = true;
  step.title = "Recording";
  step.assetId = `${p.id}-video`;
  step.width = canvas.width;
  step.height = canvas.height;
  step.start = 0;
  step.end = step.duration = 0.05;
  p.steps = [step];
  p.film = blankFilm();
  p.film.cursorRecorded = true;
  p.film.cursorEmbedded = false;
  p.film.hasSystemAudio = main.getAudioTracks().length > 0;
  p.captureVersion = 4;
  const track = main.getVideoTracks()[0];
  track.contentHint = "detail";
  if (main.getAudioTracks().length) {
    audioOutput = new AudioContext();
    const source = audioOutput.createMediaStreamSource(main);
    source.connect(audioOutput.destination);
    void audioOutput.resume();
  }
  if (m.microphone) {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    micRecorder = new MediaRecorder(mic, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    p.film.micId = `${p.id}-mic`;
    attach(micRecorder, "mic");
  }
  if (m.camera) {
    webcam = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    cameraRecorder = new MediaRecorder(webcam, {
      mimeType: mime(false),
      videoBitsPerSecond: 1500000,
    });
    p.film.webcamId = `${p.id}-camera`;
    attach(cameraRecorder, "camera");
  }
  recorder = new MediaRecorder(main, {
    mimeType: mime(main.getAudioTracks().length > 0),
    videoBitsPerSecond: 6000000,
  });
  attach(recorder, "main");
  started = now();
  recorder.start(1000);
  refreshFrame();
  micRecorder?.start(1000);
  cameraRecorder?.start(1000);
  checkpoint = setInterval(() => {
    if (stopping) return;
    if (!paused) refreshFrame();
    // Native tab streams may stop delivering frames on a static page. Flush
    // independently of video-frame arrivals so recovery still has the path.
    for (const r of [recorder, micRecorder, cameraRecorder])
      if (r?.state === "recording") r.requestData();
    void enqueue(async () => {
      await flushMetadata();
      await persist();
    });
  }, 1000);
  await persist();
  track.onended = () => {
    if (!stopping)
      void chrome.runtime.sendMessage({ target: "background", type: "ended" });
  };
}
async function finish(rec: MediaRecorder | undefined) {
  if (rec && rec.state !== "inactive")
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
}
async function stop() {
  if (!p?.film || stopping) return;
  stopping = true;
  clearInterval(checkpoint);
  await writes;
  const duration = Math.max(0.05, elapsed());
  refreshFrame();
  await new Promise((r) => setTimeout(r, 35));
  await Promise.all([
    finish(recorder),
    finish(micRecorder),
    finish(cameraRecorder),
  ]);
  await writes;
  await enqueue(flushMetadata);
  for (const [channel, rec, id] of [
    ["main", recorder, `${p.id}-video`],
    ["mic", micRecorder, `${p.id}-mic`],
    ["camera", cameraRecorder, `${p.id}-camera`],
  ] as const) {
    if (!rec) continue;
    const chunks = await chunksFor(p.id, channel);
    if (chunks.length)
      await putAsset({
        id,
        projectId: p.id,
        blob: new Blob(
          chunks.map((c) => c.blob),
          { type: rec.mimeType },
        ),
      });
  }
  p.film.duration = p.film.trimEnd = duration;
  p.steps[0].duration = p.steps[0].end = p.steps[0].sourceDuration = duration;
  p.status = "draft";
  p.updated = Date.now();
  const clip = p.steps[0];
  clip.posterId = `${p.id}-poster`;
  const poster = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(Error("Could not save recording thumbnail.")),
      "image/jpeg",
      0.8,
    ),
  );
  await putAsset({ id: clip.posterId, projectId: p.id, blob: poster });
  await saveProject(p);
  await clearChunks(p.id);
  for (const stream of [main, tabAudio, mic, webcam])
    stream?.getTracks().forEach((t) => t.stop());
  await audioOutput?.close();
}
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.target !== "offscreen") return;
  const run = async () => {
    if (m.type === "start") return start(m);
    if (m.type === "frame") return paint(m.data);
    if (m.type === "stop") return stop();
    if (m.type === "event" && !stopping) return enqueue(() => event(m.event));
    if (m.type === "pause") {
      await writes;
      if (m.paused) {
        pauseAt = now();
        paused = true;
        for (const r of [recorder, micRecorder, cameraRecorder])
          if (r?.state === "recording") r.pause();
        await persist();
      } else {
        pausedMs += now() - pauseAt;
        paused = false;
        for (const r of [recorder, micRecorder, cameraRecorder])
          if (r?.state === "paused") r.resume();
      }
    }
  };
  run()
    .then(() => reply({ ok: true }))
    .catch((e) => reply({ error: e.message }));
  return true;
});
