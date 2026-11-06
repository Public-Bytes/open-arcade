import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Film,
  MousePointer2,
  Focus,
  Mic,
  Camera,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Project } from "../lib/model";
import type { FilmData, ZoomRegion } from "./types";
import { autoZooms } from "./motion";
import { cursorPath } from "./cursor";
import { uid } from "../lib/model";
const fmt = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const fine = (t: number, step: number) =>
  step < 1
    ? `${fmt(t)}.${String(Math.round((t % 1) * 10) % 10)}`
    : fmt(t);
const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
type Kind = "zoom" | "cut" | "note";
type Drag =
  | { type: "seek" }
  | { type: "trim-start" }
  | { type: "trim-end" }
  | { type: "create"; anchor: number; id?: string; x: number; y: number }
  | {
      type: "left" | "right" | "move";
      kind: Kind;
      id: string;
      start: number;
      end: number;
      from: number;
      region?: ZoomRegion;
    };
// One thumbnail strip per video clip, decoded off the media elements so
// sampling never seeks the preview's video.
function useFilmstrip(project: Project, media: Record<string, string>) {
  const [frames, setFrames] = useState<{ left: number; width: number; src: string }[]>([]);
  const key =
    project.steps.map((s) => `${s.assetId}:${s.start}:${s.end}:${s.duration}`).join("|") +
    "|" +
    Object.keys(media).join(",");
  useEffect(() => {
    let live = true;
    const total = project.film?.duration || 1;
    void (async () => {
      const out: typeof frames = [];
      let at = 0;
      for (const clip of project.steps) {
        const len = clip.type === "video" ? clip.end! - clip.start! : clip.duration,
          url = media[clip.assetId || ""];
        if (url && clip.type === "image")
          out.push({ left: at / total, width: len / total, src: url });
        if (url && clip.type === "video") {
          try {
            const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import("mediabunny");
            const input = new Input({
              source: new BlobSource(await (await fetch(url)).blob()),
              formats: ALL_FORMATS,
            });
            const track = await input.getPrimaryVideoTrack();
            if (track) {
              const count = Math.max(2, Math.min(24, Math.ceil((len / total) * 24))),
                sink = new CanvasSink(track, { height: 72, fit: "contain" }),
                canvas = document.createElement("canvas"),
                times = Array.from(
                  { length: count },
                  (_, i) => (clip.start || 0) + ((i + 0.5) / count) * len,
                );
              let i = 0;
              for await (const frame of sink.canvasesAtTimestamps(times)) {
                if (!live) break;
                if (frame) {
                  canvas.width = frame.canvas.width;
                  canvas.height = frame.canvas.height;
                  canvas.getContext("2d")!.drawImage(frame.canvas, 0, 0);
                  out.push({
                    left: (at + (i / count) * len) / total,
                    width: len / count / total,
                    src: canvas.toDataURL("image/jpeg", 0.7),
                  });
                }
                i++;
              }
            }
            input.dispose();
          } catch {
            // A missing thumbnail is cosmetic; the lane still works.
          }
        }
        at += len;
      }
      if (live) setFrames(out);
    })();
    return () => {
      live = false;
    };
  }, [key]);
  return frames;
}
export function Timeline({
  project,
  media,
  time,
  playing,
  onSeek,
  onChange,
  onSelect,
  selected,
  tools,
}: {
  project: Project;
  media: Record<string, string>;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
  onChange: (p: Project, history?: boolean) => void;
  onSelect: (id: string | null, tab?: string) => void;
  selected: string | null;
  tools?: ReactNode;
}) {
  const f = project.film!,
    scroller = useRef<HTMLDivElement>(null),
    track = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    [scale, setScale] = useState(1),
    [width, setWidth] = useState(800),
    anchor = useRef<{ t: number; x: number } | null>(null),
    regions = autoZooms(f),
    frames = useFilmstrip(project, media),
    duration = Math.max(0.1, f.duration),
    pxPerSecond = (width * scale) / duration,
    step = steps.find((s) => s * pxPerSecond >= 72) ?? 600;
  useEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Zoom around the pointer (or playhead) so the spot you're looking at stays put.
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.t / duration) * el.scrollWidth - a.x;
    anchor.current = null;
  }, [scale, duration]);
  const zoomTo = (next: number, clientX?: number) => {
    const el = scroller.current!,
      r = el.getBoundingClientRect(),
      x = clientX === undefined ? ((time / duration) * el.scrollWidth - el.scrollLeft) : clientX - r.left;
    anchor.current = { t: ((el.scrollLeft + x) / el.scrollWidth) * duration, x };
    setScale(Math.max(1, Math.min(40, next)));
  };
  useEffect(() => {
    const el = scroller.current!;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(scale * Math.exp(-e.deltaY * 0.01), e.clientX);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  // Keep the playhead on screen during playback when zoomed in.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || scale <= 1) return;
    const x = (time / duration) * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40)
      el.scrollLeft = x - 40;
  }, [time, playing, scale, duration]);
  const value = (e: { clientX: number }) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(f.duration, ((e.clientX - r.left) / r.width) * f.duration));
  };
  // Edges snap to the playhead, trim points and other blocks within ~8px.
  const snap = (t: number, ignore?: string) => {
    const reach = 8 / pxPerSecond,
      targets = [
        time,
        f.trimStart,
        f.trimEnd,
        ...regions.filter((r) => r.id !== ignore).flatMap((r) => [r.start, r.end]),
        ...(f.cuts || []).filter((c) => c.id !== ignore).flatMap((c) => [c.start, c.end]),
        ...f.annotations.filter((a) => a.id !== ignore).flatMap((a) => [a.start, a.end]),
      ];
    let best = t,
      distance = reach;
    for (const v of targets)
      if (Math.abs(v - t) < distance) {
        best = v;
        distance = Math.abs(v - t);
      }
    return best;
  };
  const film = (next: Partial<FilmData>) =>
    onChange({ ...project, film: { ...f, ...next } }, false);
  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (d.type !== "seek" && d.type !== "create") onChange(project, true);
    drag.current = d;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (d.type === "seek") onSeek(value(e));
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = value(e);
    if (d.type === "seek") return onSeek(raw);
    const t = snap(raw, "id" in d ? d.id : undefined);
    if (d.type === "trim-start")
      return film({ trimStart: Math.min(f.trimEnd - 0.1, t) });
    if (d.type === "trim-end")
      return film({ trimEnd: Math.max(f.trimStart + 0.1, t) });
    if (d.type === "create") {
      if (!d.id && Math.abs(raw - d.anchor) * pxPerSecond < 6) return;
      if (!d.id) {
        onChange(project, true);
        d.id = uid();
        onSelect(d.id, "camera");
      }
      const start = Math.max(0, Math.min(d.anchor, t)),
        end = Math.min(f.duration, Math.max(d.anchor, t, start + 0.25));
      return film({
        zooms: [
          ...f.zooms.filter((z) => z.id !== d.id),
          {
            id: d.id!,
            start,
            end,
            scale: f.settings.zoom,
            x: d.x,
            y: d.y,
            automatic: false,
          },
        ],
      });
    }
    let start = d.start,
      end = d.end;
    const min = d.kind === "zoom" ? 0.25 : 0.1;
    if (d.type === "left") start = Math.max(0, Math.min(end - min, t));
    if (d.type === "right") end = Math.min(f.duration, Math.max(start + min, t));
    if (d.type === "move") {
      let delta = raw - d.from;
      const moved = snap(d.start + delta, d.id);
      delta = moved !== d.start + delta ? moved - d.start : snap(d.end + delta, d.id) - d.end;
      delta = Math.max(-d.start, Math.min(f.duration - d.end, delta));
      start += delta;
      end += delta;
    }
    if (d.kind === "zoom" && d.region) {
      const next = {
        ...d.region,
        start,
        end,
        automatic: false,
      };
      film({
        zooms: [...f.zooms.filter((z) => z.id !== d.id), next],
        dismissed: d.region.automatic
          ? [...new Set([...(f.dismissed || []), d.id])]
          : f.dismissed,
      });
    } else if (d.kind === "cut")
      film({ cuts: (f.cuts || []).map((c) => (c.id === d.id ? { ...c, start, end } : c)) });
    else
      film({ annotations: f.annotations.map((a) => (a.id === d.id ? { ...a, start, end } : a)) });
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A click on an empty camera lane is a seek, not a zero-length zoom.
    if (d?.type === "create" && !d.id) {
      onSeek(d.anchor);
      onSelect(null);
    }
    void e;
  };
  const style = (start: number, end: number) => ({
    left: `${(start / duration) * 100}%`,
    width: `${Math.max(0, ((end - start) / duration) * 100)}%`,
  });
  const block = (kind: Kind, id: string, start: number, end: number, region?: ZoomRegion) => ({
    onPointerDown: (e: React.PointerEvent) => {
      onSelect(id, kind === "zoom" ? "camera" : kind === "note" ? "annotations" : undefined);
      begin(e, { type: "move", kind, id, start, end, from: value(e), region });
    },
    left: (e: React.PointerEvent) => begin(e, { type: "left", kind, id, start, end, from: value(e), region }),
    right: (e: React.PointerEvent) => begin(e, { type: "right", kind, id, start, end, from: value(e), region }),
  });
  const hasAudio = f.hasSystemAudio || f.micId || f.audio?.length;
  return (
    <section className="timeline" aria-label="Video timeline">
      <div className="timeline-top">
        <strong>Timeline</strong>
        {tools}
        <div className="tl-zoom">
          <button aria-label="Zoom timeline out" title="Zoom out (⌘ scroll)" onClick={() => zoomTo(scale / 1.5)} disabled={scale <= 1}>
            <ZoomOut size={15} />
          </button>
          <input
            type="range"
            aria-label="Timeline zoom"
            min={0}
            max={Math.log(40)}
            step={0.01}
            value={Math.log(scale)}
            style={{ "--p": `${(Math.log(scale) / Math.log(40)) * 100}%` } as React.CSSProperties}
            onChange={(e) => zoomTo(Math.exp(+e.target.value))}
          />
          <button aria-label="Zoom timeline in" title="Zoom in (⌘ scroll)" onClick={() => zoomTo(scale * 1.5)} disabled={scale >= 40}>
            <ZoomIn size={15} />
          </button>
        </div>
      </div>
      <div className="timeline-layout">
        <div className="lane-labels">
          <div />
          <div className="film-label">
            <Film size={15} /> Video
          </div>
          <div className="zoom-label">
            <Focus size={15} /> Zoom
          </div>
          <div className="click-label">
            <MousePointer2 size={15} /> Clicks
          </div>
          <div className="text-label">
            <Type size={15} /> Text
          </div>
          {hasAudio ? (
            <div className="audio-label">
              <Mic size={15} /> Audio
            </div>
          ) : null}
          {f.webcamId && (
            <div className="webcam-label">
              <Camera size={15} /> Webcam
            </div>
          )}
        </div>
        <div className="timeline-scroll" ref={scroller}>
          <div
            className="timeline-tracks"
            ref={track}
            style={{ width: `${scale * 100}%` }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => (drag.current = null)}
          >
            <div className="time-ruler" onPointerDown={(e) => begin(e, { type: "seek" })}>
              {Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => (
                <span key={i} style={{ left: `${((i * step) / duration) * 100}%` }}>
                  {fine(i * step, step)}
                </span>
              ))}
            </div>
            <div className="lane film-lane" onPointerDown={(e) => { onSelect(null); begin(e, { type: "seek" }); }}>
              <div className="filmstrip">
                {frames.map((fr, i) => (
                  <img key={i} src={fr.src} alt="" style={{ left: `${fr.left * 100}%`, width: `${fr.width * 100}%` }} />
                ))}
              </div>
              <div className="trim-shade" style={style(0, f.trimStart)} />
              <div className="trim-shade" style={style(f.trimEnd, f.duration)} />
              <div className="film-strip" style={style(f.trimStart, f.trimEnd)}>
                <i
                  className="trim-handle left"
                  aria-label="Trim start"
                  title="Drag to trim the start"
                  onPointerDown={(e) => begin(e, { type: "trim-start" })}
                />
                <i
                  className="trim-handle right"
                  aria-label="Trim end"
                  title="Drag to trim the end"
                  onPointerDown={(e) => begin(e, { type: "trim-end" })}
                />
              </div>
              {(f.cuts || []).map((c) => {
                const b = block("cut", c.id, c.start, c.end);
                return (
                  <div
                    key={c.id}
                    className={`cut-block ${selected === c.id ? "selected" : ""}`}
                    style={style(c.start, c.end)}
                    title="Removed section · drag edges to adjust, Delete to restore"
                    onPointerDown={b.onPointerDown}
                  >
                    <i onPointerDown={b.left} />
                    <span>Cut</span>
                    <i onPointerDown={b.right} />
                  </div>
                );
              })}
            </div>
            <div
              className="lane zoom-lane"
              title="Drag across this lane to add a zoom"
              onPointerDown={(e) => {
                const t = value(e),
                  p = cursorPath(f)(t);
                begin(e, {
                  type: "create",
                  anchor: t,
                  x: Math.max(0, Math.min(100, p.x)),
                  y: Math.max(0, Math.min(100, p.y)),
                });
              }}
            >
              {regions.map((r) => {
                const b = block("zoom", r.id, r.start, r.end, r);
                return (
                  <div
                    key={r.id}
                    className={`zoom-block ${r.automatic ? "auto" : ""} ${selected === r.id ? "selected" : ""}`}
                    style={style(r.start, r.end)}
                    onPointerDown={b.onPointerDown}
                  >
                    <i onPointerDown={b.left} />
                    <span>
                      {r.scale.toFixed(1)}× {r.automatic ? "Auto" : "Zoom"}
                    </span>
                    <i onPointerDown={b.right} />
                  </div>
                );
              })}
              {!regions.length && (
                <span className="lane-hint">Drag here to add a zoom</span>
              )}
            </div>
            <div className="lane cursor-lane" onPointerDown={(e) => begin(e, { type: "seek" })}>
              {f.clicks.map((c) => (
                <button
                  aria-label={`Click at ${c.t.toFixed(2)} seconds`}
                  title={c.label}
                  key={c.id}
                  className="click-tick"
                  style={{ left: `${(c.t / duration) * 100}%` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSeek(c.t);
                  }}
                />
              ))}
              {!f.clicks.length && (
                <span className="lane-hint">
                  {f.cursorRecorded ? "No clicks recorded" : "Clicks appear here when you record a tab"}
                </span>
              )}
            </div>
            <div className="lane annotation-lane" onPointerDown={(e) => { onSelect(null); begin(e, { type: "seek" }); }}>
              {f.annotations.map((a) => {
                const b = block("note", a.id, a.start, a.end);
                return (
                  <div
                    key={a.id}
                    className={`annotation-track ${a.type} ${selected === a.id ? "selected" : ""}`}
                    style={style(a.start, a.end)}
                    onPointerDown={b.onPointerDown}
                  >
                    <i onPointerDown={b.left} />
                    <span>{a.type === "cover" ? "Privacy cover" : a.text || "Text"}</span>
                    <i onPointerDown={b.right} />
                  </div>
                );
              })}
              {!f.annotations.length && <span className="lane-hint">Press T to add text</span>}
            </div>
            {hasAudio ? (
              <div className="lane audio-lane" onPointerDown={(e) => begin(e, { type: "seek" })}>
                {f.hasSystemAudio || f.micId ? (
                  <div className="audio-track" style={style(0, f.duration)} onPointerDown={(e) => { e.stopPropagation(); onSelect("audio", "audio"); }}>
                    {[f.hasSystemAudio && "Tab audio", f.micId && "Microphone"].filter(Boolean).join(" + ")}
                  </div>
                ) : null}
                {f.audio?.map((a, i) => (
                  <div
                    key={a.assetId}
                    className="audio-track layer"
                    style={style(a.start, a.end)}
                    onPointerDown={(e) => { e.stopPropagation(); onSelect("audio", "audio"); }}
                  >
                    Audio {i + 1}
                  </div>
                ))}
              </div>
            ) : null}
            {f.webcamId && (
              <div className="lane webcam-lane" onPointerDown={(e) => begin(e, { type: "seek" })}>
                <div className="webcam-track" style={style(0, f.duration)} onPointerDown={(e) => { e.stopPropagation(); onSelect("webcam", "webcam"); }}>
                  Webcam overlay
                </div>
              </div>
            )}
            <div
              className="playhead"
              style={{ left: `${(time / duration) * 100}%` }}
              onPointerDown={(e) => begin(e, { type: "seek" })}
            >
              <span />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
