import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Project } from "../lib/model";
import { createMotion } from "./motion";
import { drawFilm, filmDimensions } from "./draw";
import { clipAt } from "./project";
import { playable } from "./time";
export type StageSize = { width: number; height: number; aspect: number };
export function FilmPreview({
  project,
  media,
  time,
  seekId,
  playing,
  onTime,
  onEnded,
  onToggle,
  framing = false,
  overlay,
}: {
  project: Project;
  media: Record<string, string>;
  time: number;
  seekId: number;
  playing: boolean;
  onTime: (t: number) => void;
  onEnded: () => void;
  onToggle: () => void;
  // Show the whole frame (no camera move) while something is being placed.
  framing?: boolean;
  overlay?: (stage: StageSize) => ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    fit = useRef<HTMLDivElement>(null),
    [box, setBox] = useState({ width: 0, height: 0 }),
    state = useRef({ time, seekId, playing, framing }),
    videos = useRef(new Map<string, HTMLVideoElement>()),
    images = useRef(new Map<string, HTMLImageElement>()),
    sounds = useRef(new Map<string, HTMLAudioElement>()),
    position = useRef(time),
    appliedSeek = useRef(seekId),
    activeMedia = useRef<
      { id: string; video: HTMLVideoElement | undefined } | undefined
    >(undefined),
    callbacks = useRef({ onTime, onEnded });
  state.current = { time, seekId, playing, framing };
  callbacks.current = { onTime, onEnded };
  const f = project.film!,
    settings = f.settings,
    first = project.steps.find((s) => s.type !== "chapter") || project.steps[0],
    aspect = first ? first.width / first.height : 16 / 9,
    dimensions = filmDimensions(aspect, f, 1280);
  useEffect(() => {
    const el = fit.current!;
    const observer = new ResizeObserver(() =>
      setBox({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(
      box.width / dimensions.width,
      box.height / dimensions.height,
    ),
    stage = {
      width: Math.max(0, Math.floor(dimensions.width * scale)),
      height: Math.max(0, Math.floor(dimensions.height * scale)),
    };
  const motion = useMemo(
    () => createMotion(f),
    [
      f.pointer,
      f.clicks,
      f.zooms,
      f.duration,
      settings.zoom,
      settings.autoZoom,
      settings.cameraSmoothness,
      settings.cursorSmoothing,
      settings.cursorTilt,
    ],
  );
  useEffect(() => {
    const vm = videos.current,
      am = sounds.current,
      im = images.current;
    for (const [id, url] of Object.entries(media)) {
      const clip = project.steps.find((s) => s.assetId === id);
      if (clip?.type === "image") {
        const image = new Image();
        image.src = url;
        im.set(id, image);
      } else if (clip?.type === "video" || id === f.webcamId) {
        const video = document.createElement("video");
        video.playsInline = true;
        video.preload = "auto";
        video.muted = true;
        video.preservesPitch = false;
        video.src = url;
        vm.set(id, video);
      } else if (
        id === f.micId ||
        f.audio?.some((a) => a.assetId === id) ||
        project.steps.some((s) => s.narrationId === id)
      ) {
        const audio = new Audio(url);
        audio.preload = "auto";
        audio.preservesPitch = false;
        am.set(id, audio);
      }
    }
    return () => {
      for (const item of [...vm.values(), ...am.values()]) {
        item.pause();
        item.removeAttribute("src");
        item.load();
      }
      vm.clear();
      am.clear();
      im.clear();
    };
  }, [media]);
  useEffect(() => {
    const c = canvas.current!,
      ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (c.width !== dimensions.width) c.width = dimensions.width;
    if (c.height !== dimensions.height) c.height = dimensions.height;
    let raf = 0,
      last = performance.now(),
      lastUI = 0,
      t = Math.max(f.trimStart, Math.min(f.trimEnd, position.current)),
      version = appliedSeek.current,
      active = "",
      explicitSeek = false,
      lastFrame = "",
      wasPlaying = false,
      ended = false;
    // Transport feedback never becomes a seek. Only an explicit seekId or clip
    // change writes currentTime; the video is the playback clock thereafter.
    const syncSound = (
      v: HTMLMediaElement | undefined,
      target: number,
      play: boolean,
      volume: number,
    ) => {
      if (!v) return;
      const end = Number.isFinite(v.duration)
        ? Math.max(0, v.duration - 0.001)
        : Infinity;
      const targetTime = Math.max(0, Math.min(target, end));
      play = play && target < end;
      v.volume = Math.max(0, Math.min(1, volume));
      v.muted = volume === 0;
      if (v.playbackRate !== f.speed) v.playbackRate = f.speed;
      if (
        !v.seeking &&
        Math.abs(v.currentTime - targetTime) > (play ? 0.2 : 0.002)
      )
        v.currentTime = targetTime;
      if (play && v.paused && !v.ended) void v.play().catch(() => {});
      if (!play && !v.paused) v.pause();
    };
    const frame = (now: number) => {
      const current = state.current,
        dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (version !== current.seekId) {
        version = current.seekId;
        appliedSeek.current = version;
        t = current.time;
        active = "";
        explicitSeek = true;
        ended = false;
      }
      t = Math.max(f.trimStart, Math.min(f.trimEnd, t));
      let at = clipAt(project, t);
      if (at) {
        let v = videos.current.get(at.clip.assetId || "");
        if (active !== at.clip.id) {
          for (const other of videos.current.values())
            if (other !== v && other !== videos.current.get(f.webcamId || ""))
              other.pause();
          active = at.clip.id;
          if (
            v &&
            (explicitSeek ||
              activeMedia.current?.id !== at.clip.id ||
              activeMedia.current?.video !== v)
          ) {
            const target = (at.clip.start || 0) + at.offset;
            if (Math.abs(v.currentTime - target) > 0.001)
              v.currentTime = target;
          }
          activeMedia.current = { id: at.clip.id, video: v };
          explicitSeek = false;
          lastFrame = "";
        }
        if (v) {
          v.volume = settings.systemVolume;
          v.muted = settings.systemVolume === 0;
          if (v.playbackRate !== f.speed) v.playbackRate = f.speed;
          if (current.playing && t < f.trimEnd && !v.ended) {
            if (v.paused) void v.play().catch(() => {});
          } else if (!v.paused) v.pause();
          if (!v.seeking && v.readyState >= 2) {
            if (current.playing || wasPlaying)
              t = at.start + Math.max(0, v.currentTime - (at.clip.start || 0));
            // Jump over removed sections as playback reaches them.
            const resume = current.playing ? playable(f, t) : t;
            if (resume > t + 0.001) {
              t = resume;
              active = "";
              explicitSeek = true;
            }
            if (
              current.playing &&
              (v.ended || v.currentTime >= (at.clip.end || Infinity) - 0.001)
            )
              t = at.start + at.duration;
          }
        } else if (current.playing) t = playable(f, t + dt * f.speed);
        t = Math.max(f.trimStart, Math.min(f.trimEnd, t));
        // At a cut, prepare the next clip on the next animation frame.
        const next = clipAt(project, t);
        const drawable =
          next?.clip.id === at.clip.id &&
          (!v || (v.readyState >= 2 && !v.seeking));
        const webcam = videos.current.get(f.webcamId || "");
        syncSound(webcam, t, current.playing && t < f.trimEnd, 0);
        syncSound(
          sounds.current.get(f.micId || ""),
          t,
          current.playing && t < f.trimEnd,
          settings.micVolume,
        );
        for (const layer of f.audio || [])
          syncSound(
            sounds.current.get(layer.assetId),
            t - layer.start + layer.sourceStart,
            current.playing &&
              t >= layer.start &&
              t < layer.end &&
              t < f.trimEnd,
            layer.volume,
          );
        if (at.clip.narrationId)
          syncSound(
            sounds.current.get(at.clip.narrationId),
            at.offset,
            current.playing && t < f.trimEnd,
            1,
          );
        const img = images.current.get(at.clip.assetId || ""),
          source = v || img;
        const key = [
          t,
          v?.currentTime,
          img?.complete,
          webcam?.currentTime,
          current.framing,
        ].join(":");
        if (drawable && key !== lastFrame && (!img || img.complete)) {
          drawFilm(
            ctx,
            source,
            v?.videoWidth || img?.naturalWidth || at.clip.width,
            v?.videoHeight || img?.naturalHeight || at.clip.height,
            f,
            current.framing
              ? { ...motion.at(t), z: 1, x: 0, y: 0 }
              : motion.at(t),
            t,
            {
              crop: at.clip.crop,
              redactions: at.clip.redactions,
              webcam:
                webcam && webcam.readyState >= 2 && !webcam.seeking
                  ? webcam
                  : undefined,
              webcamWidth: webcam?.videoWidth,
              webcamHeight: webcam?.videoHeight,
            },
          );
          const pose = motion.at(t);
          c.dataset.zoom = pose.z.toFixed(4);
          c.dataset.cursorSize = String(settings.cursorSize);
          c.dataset.time = t.toFixed(3);
          lastFrame = key;
        }
      }
      position.current = t;
      if (
        (current.playing && now - lastUI >= 60) ||
        (wasPlaying && !current.playing)
      ) {
        callbacks.current.onTime(t);
        lastUI = now;
      }
      if (current.playing && t >= f.trimEnd && !ended) {
        ended = true;
        callbacks.current.onTime(t);
        callbacks.current.onEnded();
      }
      wasPlaying = current.playing;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [project.steps, f, motion, media, dimensions.width, dimensions.height]);
  return (
    <div className="film-fit" ref={fit}>
      <div className="film-stage" style={stage}>
        <canvas
          ref={canvas}
          className="film-preview"
          style={{ cursor: playing ? "none" : "pointer" }}
          aria-label="Video preview"
          onClick={onToggle}
        />
        {overlay && stage.width > 0 && overlay({ ...stage, aspect })}
      </div>
    </div>
  );
}
