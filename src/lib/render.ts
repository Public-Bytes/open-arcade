import { getAsset } from "./db";
import type { Project, Step } from "./model";
import { interpolate } from "./model";
import { cameraFrame } from "./camera";
import { normalizeCapture } from "./capture-media";
// @ts-expect-error gifenc provides a small browser encoder without declarations.
import { GIFEncoder, quantize, applyPalette } from "gifenc";
function lines(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (ctx.measureText(line + " " + word).width > max && line) {
      out.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) out.push(line);
  return out;
}
export async function renderSequence(
  p: Project,
  format: "video" | "gif",
  progress: (value: number) => void,
  signal?: AbortSignal,
) {
  p = await normalizeCapture(p, async (id) => (await getAsset(id))?.blob);
  const first = p.steps.find((s) => s.type !== "chapter") || p.steps[0],
    ratio = first ? first.width / first.height : 16 / 9;
  const width = format === "gif" ? 800 : 1440,
    height = Math.round(width / ratio / 2) * 2,
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", {
    willReadFrequently: format === "gif",
  })!;
  const urls: string[] = [];
  const sources = new Map<string, HTMLImageElement | HTMLVideoElement>();
  let outputAudio: AudioContext | undefined,
    audioDestination: MediaStreamAudioDestinationNode | undefined;
  const narration = new Map<string, AudioBuffer>();
  const check = () => {
    if (signal?.aborted) throw Error("Export cancelled.");
  };
  const seek = async (v: HTMLVideoElement, t: number) => {
    if (Math.abs(v.currentTime - t) < 0.02 && v.readyState >= 2) return;
    await new Promise<void>((r, j) => {
      const timeout = setTimeout(() => {
        cleanup();
        j(Error("Video frame could not be decoded."));
      }, 10000);
      const cleanup = () => {
        clearTimeout(timeout);
        v.removeEventListener("seeked", ok);
        v.removeEventListener("error", bad);
      };
      const ok = () => {
        cleanup();
        r();
      };
      const bad = () => {
        cleanup();
        j(Error("Video could not be decoded."));
      };
      v.addEventListener("seeked", ok);
      v.addEventListener("error", bad);
      v.currentTime = t;
    });
  };
  const draw = (
    s: Step,
    source: HTMLImageElement | HTMLVideoElement | undefined,
    time: number,
    duration: number,
  ) => {
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, width, height);
    const scale = width / 800;
    if (source) {
      const nw =
          source instanceof HTMLVideoElement
            ? source.videoWidth
            : source.naturalWidth,
        nh =
          source instanceof HTMLVideoElement
            ? source.videoHeight
            : source.naturalHeight;
      const crop = s.crop || { x: 0, y: 0, width: 100, height: 100 },
        sx = (nw * crop.x) / 100,
        sy = (nh * crop.y) / 100,
        sw = (nw * crop.width) / 100,
        sh = (nh * crop.height) / 100;
      const fit = Math.max(width / sw, height / sh),
        w = sw * fit,
        h = sh * fit,
        x = (width - w) / 2,
        y = (height - h) / 2,
        pose = cameraFrame(s, time, duration);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      ctx.translate(x + (w * pose.tx) / 100, y + (h * pose.ty) / 100);
      ctx.scale(pose.zoom, pose.zoom);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
      ctx.fillStyle = "#18251f";
      for (const r of s.redactions || [])
        ctx.fillRect(
          (w * r.x) / 100,
          (h * r.y) / 100,
          (w * r.width) / 100,
          (h * r.height) / 100,
        );
      ctx.restore();
      const hot = s.hotspots[0];
      if (hot && (!s.click || Math.abs(time - s.click.time) < 0.35)) {
        const hx = x + (w * (pose.tx + hot.x * pose.zoom)) / 100,
          hy = y + (h * (pose.ty + hot.y * pose.zoom)) / 100;
        ctx.beginPath();
        ctx.arc(hx, hy, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle = p.accent;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        if (s.type !== "video") {
          ctx.save();
          ctx.translate(hx + 3 * scale, hy + 3 * scale);
          ctx.scale(scale, scale);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, 23);
          ctx.lineTo(6, 17);
          ctx.lineTo(11, 29);
          ctx.lineTo(16, 26);
          ctx.lineTo(11, 15);
          ctx.lineTo(22, 15);
          ctx.closePath();
          ctx.fillStyle = "#203a2a";
          ctx.fill();
          ctx.strokeStyle = "white";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    if (
      source &&
      !s.body.trim() &&
      /^(Click |Start here|Scroll to |Type into |Drag to )/.test(s.title)
    )
      return;
    if (source) {
      ctx.fillStyle = "#fffffff0";
      ctx.fillRect(
        20 * scale,
        height - 112 * scale,
        width - 40 * scale,
        92 * scale,
      );
    }
    ctx.fillStyle = "#1d3328";
    ctx.font = `${source ? "bold" : "500"} ${source ? 20 * scale : 40 * scale}px Arial`;
    const top = source ? height - 78 * scale : height * 0.35;
    lines(ctx, interpolate(s.title, p.variables), width - 80 * scale)
      .slice(0, 2)
      .forEach((l, i) => ctx.fillText(l, 40 * scale, top + i * 28 * scale));
    ctx.font = `${14 * scale}px Arial`;
    lines(ctx, interpolate(s.body, p.variables), width - 80 * scale)
      .slice(0, 2)
      .forEach((l, i) =>
        ctx.fillText(
          l,
          40 * scale,
          top + (source ? 25 : 85) * scale + i * 20 * scale,
        ),
      );
  };
  try {
    for (const s of p.steps) {
      check();
      if (!s.assetId || sources.has(s.assetId)) continue;
      const a = await getAsset(s.assetId);
      if (!a) throw Error("A step is missing its media.");
      const url = URL.createObjectURL(a.blob);
      urls.push(url);
      if (s.type === "video") {
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.src = url;
        await new Promise<void>((r, j) => {
          v.onloadeddata = () => r();
          v.onerror = () => j(Error("Video cannot be loaded."));
        });
        sources.set(s.assetId, v);
      } else {
        const img = new Image();
        img.src = url;
        await img.decode();
        sources.set(s.assetId, img);
      }
    }
    const fps = format === "gif" ? 8 : 60,
      total = p.steps.reduce(
        (n, s) =>
          n +
          Math.ceil(
            (s.type === "video" ? s.end! - s.start! : s.duration) * fps,
          ),
        0,
      );
    if (!total) throw Error("Add at least one step.");
    let done = 0;
    const gif = format === "gif" ? GIFEncoder() : undefined;
    const chunks: Blob[] = [];
    let previous: HTMLCanvasElement | undefined;
    let recorder: MediaRecorder | undefined;
    let stopPromise: Promise<void> | undefined;
    let stream: MediaStream | undefined;
    if (format === "video" && p.steps.some((s) => s.narrationId)) {
      outputAudio = new AudioContext();
      await outputAudio.resume();
      audioDestination = outputAudio.createMediaStreamDestination();
      for (const s of p.steps) {
        if (!s.narrationId || narration.has(s.narrationId)) continue;
        const asset = await getAsset(s.narrationId);
        if (!asset) throw Error("Narration audio is missing.");
        narration.set(
          s.narrationId,
          await outputAudio.decodeAudioData(await asset.blob.arrayBuffer()),
        );
      }
    }
    const mime = (
      audioDestination
        ? [
            "video/mp4;codecs=avc1.42001f,mp4a.40.2",
            "video/webm;codecs=vp9,opus",
            "video/webm",
          ]
        : [
            "video/mp4;codecs=avc1.42001f",
            "video/webm;codecs=vp9",
            "video/webm",
          ]
    ).find((t) => MediaRecorder.isTypeSupported(t));
    if (format === "video") {
      if (!mime) throw Error("Your browser cannot encode video.");
      draw(
        p.steps[0],
        sources.get(p.steps[0].assetId || ""),
        0,
        p.steps[0].duration,
      );
      stream = canvas.captureStream(fps);
      if (audioDestination)
        for (const track of audioDestination.stream.getAudioTracks())
          stream.addTrack(track);
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      stopPromise = new Promise((r) => {
        recorder!.onstop = () => r();
      });
      recorder.start();
    }
    try {
      for (const s of p.steps) {
        const source = sources.get(s.assetId || "");
        if (source instanceof HTMLVideoElement && format === "video") {
          await seek(source, s.start || 0);
          await source.play();
        }
        const sceneStart = performance.now(),
          duration = s.type === "video" ? s.end! - s.start! : s.duration;
        let voice: AudioBufferSourceNode | undefined;
        const buffer = narration.get(s.narrationId || "");
        if (buffer && outputAudio && audioDestination) {
          voice = outputAudio.createBufferSource();
          voice.buffer = buffer;
          voice.connect(audioDestination);
          voice.start(
            0,
            0,
            Math.min(
              buffer.duration,
              s.type === "video" ? s.end! - s.start! : s.duration,
            ),
          );
        }
        const count = Math.ceil(
          (s.type === "video" ? s.end! - s.start! : s.duration) * fps,
        );
        for (let i = 0; i < count; i++) {
          check();
          if (source instanceof HTMLVideoElement) {
            if (format === "gif") await seek(source, (s.start || 0) + i / fps);
            else if (source.currentTime >= (s.end || Infinity)) {
              source.pause();
              await seek(
                source,
                Math.max(s.start || 0, (s.end || 0) - 1 / fps),
              );
            }
          }
          draw(s, source, i / fps, duration);
          if (previous && i / fps < 0.28) {
            const q = Math.min(1, i / fps / 0.28);
            ctx.save();
            ctx.globalAlpha = 1 - q * q * (3 - 2 * q);
            ctx.drawImage(previous, 0, 0);
            ctx.restore();
          }
          if (gif) {
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const palette = quantize(rgba, 256);
            gif.writeFrame(applyPalette(rgba, palette), width, height, {
              palette,
              delay: 1000 / fps,
            });
            if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
          } else
            await new Promise((r) =>
              setTimeout(
                r,
                Math.max(
                  0,
                  sceneStart + ((i + 1) / fps) * 1000 - performance.now(),
                ),
              ),
            );
          progress(++done / total);
        }
        if (source instanceof HTMLVideoElement) source.pause();
        previous = document.createElement("canvas");
        previous.width = width;
        previous.height = height;
        previous.getContext("2d")!.drawImage(canvas, 0, 0);
        voice?.stop();
      }
    } finally {
      if (recorder) {
        recorder.stop();
        await stopPromise;
        stream?.getTracks().forEach((t) => t.stop());
      }
    }
    if (gif) {
      gif.finish();
      return {
        blob: new Blob([gif.bytes()], { type: "image/gif" }),
        extension: "gif",
      };
    }
    return {
      blob: new Blob(chunks, { type: mime }),
      extension: mime!.startsWith("video/mp4") ? "mp4" : "webm",
    };
  } finally {
    for (const src of sources.values())
      if (src instanceof HTMLVideoElement) {
        src.pause();
        src.removeAttribute("src");
        src.load();
      }
    await outputAudio?.close();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
