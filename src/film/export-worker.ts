/// <reference lib="webworker" />
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  VideoSampleSink,
  AudioSampleSink,
  AudioSampleSource,
  AudioSample,
  Quality,
  type VideoSample,
  type InputVideoTrack,
} from "mediabunny";
import type { Project } from "../lib/model";
import { createMotion } from "./motion";
import { drawFilm, filmDimensions } from "./draw";
import { outputDuration, outputTime, segments, sourceTime } from "./time";
// @ts-expect-error gifenc ships no TypeScript declarations.
import { GIFEncoder, quantize, applyPalette } from "gifenc";
type Job = {
  project: Project;
  assets: Record<string, Blob>;
  width: number;
  fps: number;
  quality: number;
  format: "mp4" | "gif";
};
let cancelled = false;
self.onmessage = async (e: MessageEvent<Job | { cancel: true }>) => {
  if ("cancel" in e.data) {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    const result = await encode(e.data);
    if (!cancelled)
      self.postMessage({ type: "done", ...result }, [result.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
async function encode(job: Job) {
  const started = performance.now(),
    p = job.project,
    film = p.film!;
  if (!film) throw Error("Recording metadata is missing.");
  const kept = segments(film),
    duration = outputDuration(film),
    at = (output: number) => sourceTime(film, output, kept);
  if (duration <= 0) throw Error("Nothing is left to export. Restore part of the timeline.");
  const first = p.steps.find((s) => s.type !== "chapter") || p.steps[0],
    { width, height } = filmDimensions(
      first ? first.width / first.height : 16 / 9,
      film,
      job.width,
    ),
    canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext("2d", {
      willReadFrequently: job.format === "gif",
    })!,
    source = new OffscreenCanvas(first?.width || 1440, first?.height || 900),
    sourceCtx = source.getContext("2d")!,
    motion = createMotion(film);
  // Recordings are usually downscaled; the default filter makes text jagged.
  ctx.imageSmoothingQuality = "high";
  const inputs = new Map<string, Input>();
  const input = (id: string) => {
    let i = inputs.get(id);
    if (!i) {
      if (!job.assets[id]) throw Error("A media file is missing.");
      i = new Input({
        source: new BlobSource(job.assets[id]),
        formats: ALL_FORMATS,
      });
      inputs.set(id, i);
    }
    return i;
  };
  // GIF frame delays are whole hundredths of a second, so only rates that
  // divide 100 play at the right speed.
  const fps = job.format === "gif" ? ([10, 20, 25].includes(job.fps) ? job.fps : 20) : job.fps,
    frames = Math.ceil(duration * fps);
  let output: Output | undefined,
    video: CanvasSource | undefined,
    audio: AudioSampleSource | undefined;
  const target = new BufferTarget();
  const gif = job.format === "gif" ? GIFEncoder() : undefined;
  let palette: number[][] | undefined,
    globalPalette: number[][] | undefined;
  // gifenc's palette colours are averages of coarse colour bins, which tints
  // large flat areas (off-white UI turns mint). Move each colour to the true
  // mean of the pixels that use it, then map again.
  const refine = (rgba: Uint8ClampedArray, pal: number[][]) => {
    const sum = new Float64Array(pal.length * 4),
      index: Uint8Array = applyPalette(rgba, pal);
    for (let p = 0; p < index.length; p++) {
      const k = index[p] * 4,
        i = p * 4;
      sum[k] += rgba[i];
      sum[k + 1] += rgba[i + 1];
      sum[k + 2] += rgba[i + 2];
      sum[k + 3]++;
    }
    const next = pal.map((c, k) =>
      sum[k * 4 + 3]
        ? [0, 1, 2].map((j) => Math.round(sum[k * 4 + j] / sum[k * 4 + 3]))
        : c,
    );
    return { palette: next, index: applyPalette(rgba, next) as Uint8Array };
  };
  // Mean colour error of an indexed frame against the source, sampled sparsely.
  const drift = (rgba: Uint8ClampedArray, index: Uint8Array, pal: number[][]) => {
    let e = 0,
      n = 0;
    for (let p = 0; p < index.length; p += 61) {
      const i = p * 4,
        c = pal[index[p]];
      e += Math.abs(rgba[i] - c[0]) + Math.abs(rgba[i + 1] - c[1]) + Math.abs(rgba[i + 2] - c[2]);
      n++;
    }
    return e / n;
  };
  const check = () => {
    if (cancelled) throw Error("Export cancelled.");
  };
  const tracks: {
    id: string;
    start: number;
    sourceStart: number;
    end: number;
    volume: number;
  }[] = [];
  let clipTime = 0;
  for (const clip of p.steps) {
    const len = clip.type === "video" ? clip.end! - clip.start! : clip.duration;
    if (clip.type === "video" && clip.assetId && film.settings.systemVolume > 0)
      tracks.push({
        id: clip.assetId,
        start: clipTime,
        sourceStart: clip.start || 0,
        end: clipTime + len,
        volume: film.settings.systemVolume,
      });
    if (clip.narrationId)
      tracks.push({
        id: clip.narrationId,
        start: clipTime,
        sourceStart: 0,
        end: clipTime + len,
        volume: 1,
      });
    clipTime += len;
  }
  if (film.micId && film.settings.micVolume > 0)
    tracks.push({
      id: film.micId,
      start: 0,
      sourceStart: 0,
      end: film.duration,
      volume: film.settings.micVolume,
    });
  for (const layer of film.audio || [])
    tracks.push({
      id: layer.assetId,
      start: layer.start,
      sourceStart: layer.sourceStart,
      end: layer.end,
      volume: layer.volume,
    });
  const readers: AudioReader[] = [];
  if (!gif) {
    for (const track of tracks) {
      const t = await input(track.id).getPrimaryAudioTrack();
      if (t)
        readers.push(
          new AudioReader(
            new AudioSampleSink(t),
            track,
            film.trimStart,
            film.trimEnd,
          ),
        );
    }
    output = new Output({ format: new Mp4OutputFormat(), target });
    video = new CanvasSource(canvas, {
      codec: "avc",
      quality: new Quality({ bitrate: job.quality }),
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 2,
    });
    output.addVideoTrack(video, { frameRate: fps });
    if (readers.length) {
      audio = new AudioSampleSource({
        codec: "aac",
        quality: new Quality({ bitrate: 160000 }),
      });
      output.addAudioTrack(audio);
    }
    await output.start();
  }
  let cameraFrames:
      | AsyncGenerator<VideoSample | null, void, unknown>
      | undefined,
    cameraSample: VideoSample | undefined,
    cameraCanvas: OffscreenCanvas | undefined,
    cameraCtx: OffscreenCanvasRenderingContext2D | undefined;
  if (film.webcamId) {
    const track = await input(film.webcamId).getPrimaryVideoTrack();
    if (track) {
      cameraFrames = new VideoSampleSink(track).samplesAtTimestamps(
        (function* () {
          for (let i = 0; i < frames; i++)
            yield at(i / fps);
        })(),
      );
    }
  }
  const encodeVideo = async () => {
    let globalStart = 0,
      done = 0;
    for (const clip of p.steps) {
      check();
      const clipDuration =
          clip.type === "video" ? clip.end! - clip.start! : clip.duration,
        from = Math.max(globalStart, film.trimStart),
        to = Math.min(globalStart + clipDuration, film.trimEnd);
      if (to <= from) {
        globalStart += clipDuration;
        continue;
      }
      const beginFrame = Math.max(
          0,
          Math.ceil(outputTime(film, from, kept) * fps - 0.00001),
        ),
        endFrame = Math.min(
          frames,
          Math.ceil(outputTime(film, to, kept) * fps - 0.00001),
        );
      let iterator:
          | AsyncGenerator<VideoSample | null, void, unknown>
          | undefined,
        bitmap: ImageBitmap | undefined;
      if (clip.type === "video" && clip.assetId) {
        const track = await input(clip.assetId).getPrimaryVideoTrack();
        if (!track) throw Error("Video track is missing.");
        const times = (function* () {
          for (let n = beginFrame; n < endFrame; n++)
            yield (clip.start || 0) + (at(n / fps) - globalStart);
        })();
        iterator = new VideoSampleSink(track).samplesAtTimestamps(times);
      } else if (clip.assetId)
        bitmap = await createImageBitmap(job.assets[clip.assetId]);
      try {
        for (let n = beginFrame; n < endFrame; n++) {
          check();
          const t = at(n / fps);
          let sample: VideoSample | undefined;
          if (iterator) {
            const next = await iterator.next();
            sample = next.value || undefined;
            if (sample) {
              if (
                source.width !== sample.displayWidth ||
                source.height !== sample.displayHeight
              ) {
                source.width = sample.displayWidth;
                source.height = sample.displayHeight;
              }
              sample.draw(sourceCtx, 0, 0);
            }
          } else if (bitmap) {
            if (
              source.width !== bitmap.width ||
              source.height !== bitmap.height
            ) {
              source.width = bitmap.width;
              source.height = bitmap.height;
            }
            sourceCtx.drawImage(bitmap, 0, 0);
          } else {
            source.width = 1440;
            source.height = 900;
            sourceCtx.fillStyle = p.background;
            sourceCtx.fillRect(0, 0, 1440, 900);
            sourceCtx.fillStyle = "#20372a";
            sourceCtx.font = "48px Arial";
            sourceCtx.fillText(clip.title, 90, 350);
            sourceCtx.font = "24px Arial";
            sourceCtx.fillText(clip.body, 90, 410);
          }
          sample?.close();
          if (cameraFrames) {
            const next = await cameraFrames.next();
            cameraSample = next.value || undefined;
            if (cameraSample) {
              if (!cameraCanvas) {
                cameraCanvas = new OffscreenCanvas(
                  cameraSample.displayWidth,
                  cameraSample.displayHeight,
                );
                cameraCtx = cameraCanvas.getContext("2d")!;
              }
              cameraSample.draw(cameraCtx!, 0, 0);
              cameraSample.close();
            }
          }
          drawFilm(
            ctx,
            source,
            source.width,
            source.height,
            film,
            motion.at(t),
            t,
            {
              crop: clip.crop,
              redactions: clip.redactions,
              webcam: cameraCanvas,
              webcamWidth: cameraCanvas?.width,
              webcamHeight: cameraCanvas?.height,
            },
          );
          if (gif) {
            const rgba = ctx.getImageData(0, 0, width, height).data;
            // Each frame gets the best palette for its own colours, but keeps
            // the previous one when it is nearly as good, so still shots don't
            // flicker. A palette reused across a zoom greys out the colours it
            // never saw.
            const { palette: fresh, index: freshIndex } = refine(
              rgba,
              refine(rgba, quantize(rgba, 256)).palette,
            );
            let index = palette && applyPalette(rgba, palette);
            if (
              !palette ||
              !index ||
              drift(rgba, index, palette) > drift(rgba, freshIndex, fresh) * 1.15 + 0.5
            ) {
              palette = fresh;
              index = freshIndex;
              globalPalette ??= palette;
            }
            gif.writeFrame(index, width, height, {
              // Frames without a table use the first frame's.
              palette: palette === globalPalette && n > 0 ? undefined : palette,
              delay: 1000 / fps,
            });
          } else
            await video!.add(n / fps, Math.min(1 / fps, duration - n / fps));
          done++;
          if (done % 8 === 0 || n === frames - 1)
            self.postMessage({
              type: "progress",
              value: (n + 1) / frames,
              fps: done / ((performance.now() - started) / 1000),
            });
        }
      } finally {
        await iterator?.return();
        bitmap?.close();
      }
      globalStart += clipDuration;
    }
    video?.close();
  };
  const encodeAudio = async () => {
    if (!audio) return;
    const rate = 48000,
      block = 2048,
      total = Math.ceil(duration * rate);
    let written = 0;
    // Blocks never straddle a cut, so each one reads a single source range.
    for (const [index, s] of kept.entries()) {
      const last = index === kept.length - 1,
        end = last
          ? total
          : Math.round((s.out + (s.end - s.start) / film.speed) * rate);
      for (let at = written; at < end; at += block) {
        check();
        const count = Math.min(block, end - at),
          time = (n: number) => s.start + ((at + n) / rate - s.out) * film.speed;
        await Promise.all(readers.map((r) => r.prepare(time(0), time(count))));
        const data = new Float32Array(count * 2);
        for (let n = 0; n < count; n++) {
          const t = time(n);
          for (const r of readers) {
            data[n] += r.value(t, 0);
            data[count + n] += r.value(t, 1);
          }
        }
        for (let i = 0; i < data.length; i++)
          data[i] = Math.max(-1, Math.min(1, data[i]));
        const sample = new AudioSample({
          data,
          format: "f32-planar",
          sampleRate: rate,
          numberOfChannels: 2,
          timestamp: at / rate,
        });
        await audio.add(sample);
        sample.close();
      }
      written = Math.max(written, end);
    }
    audio.close();
  };
  try {
    await Promise.all([encodeVideo(), encodeAudio()]);
    await cameraFrames?.return();
    if (gif) {
      gif.finish();
      const bytes = gif.bytes() as Uint8Array;
      return {
        buffer: new Uint8Array(bytes).buffer,
        mime: "image/gif",
        extension: "gif",
        elapsed: (performance.now() - started) / 1000,
        duration,
        frames,
        width,
        height,
      };
    }
    await output!.finalize();
    return {
      buffer: target.buffer!,
      mime: "video/mp4",
      extension: "mp4",
      elapsed: (performance.now() - started) / 1000,
      duration,
      frames,
      width,
      height,
    };
  } catch (e) {
    await output?.cancel();
    throw e;
  } finally {
    await cameraFrames?.return();
    for (const r of readers) await r.close();
    for (const i of inputs.values()) i.dispose();
  }
}
type Block = { t: number; end: number; rate: number; channels: Float32Array[] };
class AudioReader {
  queue: Block[] = [];
  iterator: AsyncGenerator<AudioSample, void, unknown>;
  ended = false;
  constructor(
    sink: AudioSampleSink,
    public track: {
      start: number;
      sourceStart: number;
      end: number;
      volume: number;
    },
    from: number,
    to: number,
  ) {
    this.iterator = sink.samples(
      Math.max(0, from - track.start + track.sourceStart),
      Math.max(0, to - track.start + track.sourceStart),
    );
  }
  async prepare(from: number, to: number) {
    const start = from - this.track.start + this.track.sourceStart,
      end = to - this.track.start + this.track.sourceStart;
    const drop = () => {
      while (this.queue.length && this.queue[0].end < start - 0.01)
        this.queue.shift();
    };
    drop();
    if (to < this.track.start || from > this.track.end) return;
    while (
      !this.ended &&
      (!this.queue.length || this.queue.at(-1)!.end < end)
    ) {
      // Reading forward across a removed section must not buffer all of it.
      drop();
      const next = await this.iterator.next();
      if (!next.value) {
        this.ended = true;
        break;
      }
      const s = next.value,
        channels: Float32Array[] = [];
      for (let c = 0; c < Math.min(2, s.numberOfChannels); c++) {
        const data = new Float32Array(s.numberOfFrames);
        s.copyTo(data, { planeIndex: c, format: "f32-planar" });
        channels.push(data);
      }
      this.queue.push({
        t: s.timestamp,
        end: s.timestamp + s.duration,
        rate: s.sampleRate,
        channels,
      });
      s.close();
    }
  }
  value(global: number, channel: number) {
    if (global < this.track.start || global >= this.track.end) return 0;
    const t = global - this.track.start + this.track.sourceStart;
    const b = this.queue.find((b) => t >= b.t && t < b.end);
    if (!b) return 0;
    const a = b.channels[Math.min(channel, b.channels.length - 1)],
      index = (t - b.t) * b.rate,
      i = Math.floor(index),
      q = index - i;
    return (
      ((a[i] || 0) * (1 - q) + (a[Math.min(i + 1, a.length - 1)] || 0) * q) *
      this.track.volume
    );
  }
  async close() {
    await this.iterator.return();
    this.queue = [];
  }
}
