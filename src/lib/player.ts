import type { Project } from "./model";
import { cameraFrame } from "./camera";
// All helpers are local: this exact player also runs in standalone HTML exports.
export function mountPlayer(
  root: HTMLElement,
  project: Project,
  media: Record<string, string>,
  options: { index?: number; autoplay?: boolean } = {},
  camera: typeof cameraFrame = cameraFrame,
) {
  let index = options.index ?? 0,
    history: number[] = [],
    playing = options.autoplay ?? true,
    disposed = false,
    raf = 0,
    time = 0,
    last = performance.now(),
    waiting = false;
  let cleanStep = () => {},
    fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const text = (s: string) =>
    s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k) =>
      Object.hasOwn(project.variables, k) ? project.variables[k] : `{{${k}}}`,
    );
  const el = (tag: string, cls: string, value?: string) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (value) e.textContent = value;
    return e;
  };
  const button = (label: string, action: () => void, cls = "oa-button") => {
    const b = el("button", cls, label) as HTMLButtonElement;
    b.type = "button";
    b.onclick = action;
    return b;
  };
  const url = (value: string) => {
    try {
      const u = new URL(value);
      return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  const go = (target?: string) => {
    history.push(index);
    const at =
      target && target !== "next" && target !== "end"
        ? project.steps.findIndex((s) => s.id === target)
        : -1;
    index =
      target === "end"
        ? project.steps.length
        : at >= 0
          ? at
          : Math.min(index + 1, project.steps.length);
    render();
  };
  function render() {
    if (disposed) return;
    cancelAnimationFrame(raf);
    clearTimeout(fadeTimer);
    cleanStep();
    const outgoing = root.querySelector<HTMLElement>(
      ".oa-stage:not(.oa-outgoing)",
    );
    root.replaceChildren();
    root.className = "oa-player";
    root.style.setProperty("--oa-accent", project.accent);
    root.style.background = project.background;
    root.style.setProperty("--oa-page-background", project.background);
    const stage = el("div", "oa-stage");
    root.append(stage);
    const s = project.steps[index];
    const ratio = s
      ? s.width / s.height
      : project.steps[0]
        ? project.steps[0].width / project.steps[0].height
        : 16 / 9;
    stage.style.aspectRatio = String(ratio);
    root.style.setProperty("--oa-ratio", String(ratio));
    if (!s) {
      playing = false;
      const end = el("div", "oa-chapter");
      end.append(
        el("span", "oa-eyebrow", "THAT’S A WRAP"),
        el("h1", "", text(project.title)),
        el("p", "", "Thanks for exploring."),
        button("↺ Explore again", () => {
          index = 0;
          history = [];
          playing = true;
          render();
        }),
      );
      stage.append(end);
      root.focus({ preventScroll: true });
      return;
    }
    if (outgoing) {
      outgoing.classList.add("oa-outgoing");
      outgoing.setAttribute("aria-hidden", "true");
      root.append(outgoing);
      fadeTimer = setTimeout(() => outgoing.remove(), 320);
    }
    time = 0;
    last = performance.now();
    waiting = false;
    let video: HTMLVideoElement | undefined,
      audio: HTMLAudioElement | undefined;
    const layer = el("div", "oa-camera");
    const markers: { button: HTMLButtonElement; x: number; y: number }[] = [];
    let cursor: HTMLElement | undefined;
    if (s.type === "chapter") {
      const chapter = el("div", "oa-chapter");
      chapter.append(
        el("span", "oa-eyebrow", `CHAPTER ${index + 1}`),
        el("h1", "", text(s.title)),
        el("p", "", text(s.body)),
        button("Let’s explore →", () => go()),
      );
      stage.append(chapter);
    } else {
      const viewport = el("div", "oa-viewport");
      viewport.append(layer);
      stage.append(viewport);
      const frame = el("div", "oa-source");
      let node: HTMLImageElement | HTMLVideoElement;
      if (s.type === "video") {
        video = document.createElement("video");
        video.src = media[s.assetId || ""] || "";
        video.playsInline = true;
        video.muted = true;
        video.preload = "auto";
        waiting = true;
        video.onloadedmetadata = () => {
          if (video) video.currentTime = s.start || 0;
        };
        video.onloadeddata = () => {
          waiting = false;
          if (playing)
            void video!.play().catch(() => {
              playing = false;
              updateControls();
            });
        };
        node = video;
      } else {
        const img = new Image();
        img.alt = text(s.title);
        waiting = true;
        img.onload = () => {
          waiting = false;
          last = performance.now();
        };
        node = img;
        img.src = media[s.assetId || ""] || "";
        if (img.complete && img.naturalWidth) waiting = false;
      }
      node.className = "oa-media";
      if (s.crop) {
        node.style.position = "absolute";
        node.style.width = `${10000 / s.crop.width}%`;
        node.style.height = `${10000 / s.crop.height}%`;
        node.style.left = `${(-s.crop.x / s.crop.width) * 100}%`;
        node.style.top = `${(-s.crop.y / s.crop.height) * 100}%`;
      }
      node.onerror = () => {
        waiting = false;
        playing = false;
        stage.append(
          el("div", "oa-media-error", "This media could not be loaded."),
        );
        updateControls();
      };
      frame.append(node);
      layer.append(frame);
      for (const r of s.redactions || []) {
        const mask = el("div", "oa-redaction");
        Object.assign(mask.style, {
          left: `${r.x}%`,
          top: `${r.y}%`,
          width: `${r.width}%`,
          height: `${r.height}%`,
        });
        layer.append(mask);
      }
      for (const h of s.hotspots) {
        const b = button("", () => go(h.target), "oa-hotspot");
        b.setAttribute("aria-label", text(h.label) || "Continue");
        b.title = text(h.label) || "Continue";
        stage.append(b);
        markers.push({ button: b, x: h.x, y: h.y });
      }
      if (s.hotspots.length && s.type !== "video") {
        cursor = el("div", "oa-cursor");
        cursor.setAttribute("aria-hidden", "true");
        stage.append(cursor);
      }
      if (
        s.body.trim() ||
        !/^(Click |Start here|Scroll to |Type into |Drag to )/.test(s.title)
      ) {
        const caption = el("div", "oa-caption");
        caption.append(el("strong", "", text(s.title)));
        if (s.body) caption.append(el("p", "", text(s.body)));
        stage.append(caption);
      }
    }
    if (s.cta?.label && url(s.cta.url)) {
      const a = el("a", "oa-cta", text(s.cta.label)) as HTMLAnchorElement;
      a.href = url(s.cta.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      stage.append(a);
    }
    if (s.narrationId && media[s.narrationId]) {
      audio = document.createElement("audio");
      audio.src = media[s.narrationId];
      audio.controls = true;
      audio.className = "oa-audio";
      stage.append(audio);
      if (playing) void audio.play().catch(() => {});
    }
    const controls = el("div", "oa-controls");
    const back = button("←", () => {
      index = history.length ? history.pop()! : Math.max(0, index - 1);
      render();
    });
    back.setAttribute("aria-label", "Previous step");
    const play = button(
      "",
      () => {
        playing = !playing;
        last = performance.now();
        if (video) {
          if (playing)
            void video.play().catch(() => {
              playing = false;
              updateControls();
            });
          else video.pause();
        }
        if (audio) {
          if (playing) void audio.play().catch(() => {});
          else audio.pause();
        }
        updateControls();
      },
      "oa-button oa-play",
    );
    const counter = el(
      "span",
      "oa-counter",
      `${index + 1} / ${project.steps.length}`,
    );
    const name = el(
      "span",
      "oa-step-name",
      text(s.title.replace(/^Click /, "")),
    );
    const dots = el("div", "oa-progress");
    let currentFill: HTMLElement | undefined;
    project.steps.forEach((step, i) => {
      const dot = button(
        "",
        () => {
          history.push(index);
          index = i;
          render();
        },
        `oa-dot ${i === index ? "active" : ""}`,
      );
      dot.setAttribute("aria-label", `Go to step ${i + 1}`);
      dot.title = text(step.title);
      const fill = el("span", "oa-dot-fill");
      if (i < index) fill.style.width = "100%";
      if (i === index) currentFill = fill;
      dot.append(fill);
      dots.append(dot);
    });
    const next = button(
      index === project.steps.length - 1 ? "Finish ↗" : "Next →",
      () => go(),
    );
    const full = button("⛶", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void root.requestFullscreen().catch(() => {});
    });
    full.setAttribute("aria-label", "Fullscreen");
    controls.append(back, play, counter, name, dots, next, full);
    root.append(controls);
    function updateControls() {
      play.textContent = playing ? "Ⅱ" : "▶";
      play.setAttribute("aria-label", playing ? "Pause demo" : "Play demo");
      play.title = playing ? "Pause demo" : "Play demo";
      root.classList.toggle("is-playing", playing);
    }
    updateControls();
    root.focus({ preventScroll: true });
    const duration =
      s.type === "video"
        ? Math.max(0.1, (s.end || s.duration) - (s.start || 0))
        : Math.max(0.4, s.duration);
    function tick(now: number) {
      if (disposed) return;
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing && !waiting) {
        if (video && video.readyState >= 2) {
          time = Math.max(0, video.currentTime - (s.start || 0));
          if (video.ended) time = duration;
        } else if (!video) time += delta;
      }
      const pose = camera(s, time, duration);
      layer.style.transform = `translate(${pose.tx}%,${pose.ty}%) scale(${pose.zoom})`;
      stage.dataset.cameraZoom = pose.zoom.toFixed(4);
      stage.dataset.time = time.toFixed(3);
      for (const m of markers) {
        m.button.style.opacity =
          playing && s.click
            ? Math.abs(time - s.click.time) < 0.35
              ? "1"
              : "0"
            : "1";
        m.button.style.left = `${pose.tx + pose.zoom * m.x}%`;
        m.button.style.top = `${pose.ty + pose.zoom * m.y}%`;
      }
      if (cursor && s.hotspots[0]) {
        const h = s.hotspots[0],
          previous = project.steps[index - 1]?.hotspots[0] || { x: 50, y: 65 };
        const t = Math.min(1, time / 0.65),
          e = t * t * (3 - 2 * t);
        cursor.style.left = `${pose.tx + pose.zoom * (previous.x + (h.x - previous.x) * e)}%`;
        cursor.style.top = `${pose.ty + pose.zoom * (previous.y + (h.y - previous.y) * e)}%`;
        cursor.style.opacity = playing ? "1" : "0";
      }
      if (currentFill)
        currentFill.style.width = `${Math.min(100, (time / duration) * 100)}%`;
      if (playing && !waiting && time >= duration) {
        go();
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    cleanStep = () => {
      if (video) {
        video.pause();
        video.onloadeddata = null;
        video.onloadedmetadata = null;
      }
      audio?.pause();
    };
    raf = requestAnimationFrame(tick);
  }
  const key = (e: KeyboardEvent) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(
        (e.target as HTMLElement)?.tagName,
      )
    )
      return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      index = history.length ? history.pop()! : Math.max(0, index - 1);
      render();
    }
    if (e.code === "Space" && e.target === root) {
      e.preventDefault();
      root.querySelector<HTMLButtonElement>(".oa-play")?.click();
    }
  };
  root.tabIndex = 0;
  root.addEventListener("keydown", key);
  render();
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(fadeTimer);
    cleanStep();
    root.removeEventListener("keydown", key);
    root.replaceChildren();
  };
}
