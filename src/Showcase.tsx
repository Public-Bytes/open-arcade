import { useEffect, useRef } from "react";
import { Play } from "lucide-react";

// The library hero: a looping, miniature version of what the editor does to a
// recording. A cursor clicks, the camera springs in on the action, follows it
// and eases back out, while a little timeline plays along underneath.
//
// Everything is driven from one requestAnimationFrame clock, so the scene is
// deterministic and only writes transforms. The pointer tilt is eased toward
// the pointer every frame and applied to an inner layer, so the element the
// pointer is over never moves under it.

const LOOP = 8; // seconds
const DESIGN_W = 560;

type Point = { t: number; x: number; y: number };
// Cursor waypoints in % of the app screen.
const path: Point[] = [
  { t: 0, x: 52, y: 80 },
  { t: 1.1, x: 58, y: 66 },
  { t: 2.0, x: 86.5, y: 12.8 }, // New project
  { t: 3.5, x: 86, y: 13.5 },
  { t: 4.4, x: 61.5, y: 46 }, // second card
  { t: 5.6, x: 61, y: 47 },
  { t: 6.8, x: 34, y: 72 },
  { t: 8, x: 52, y: 80 },
];
const clicks = [2.1, 4.5];
// Camera: [start, end, scale, focus x, focus y]
const zooms: [number, number, number, number, number][] = [
  [2.15, 5.7, 1.7, 76, 30],
];

const smooth = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// A critically damped spring's step response, which is what the editor's
// camera settles with.
const settle = (v: number) => (v <= 0 ? 0 : 1 - (1 + 7 * v) * Math.exp(-7 * v));

function cursorAt(t: number) {
  let i = 0;
  while (i < path.length - 2 && path[i + 1].t <= t) i++;
  const a = path[i],
    b = path[i + 1],
    v = smooth(clamp((t - a.t) / (b.t - a.t || 1))),
    // A slight arc reads as a hand, not a robot.
    arc =
      Math.sin(v * Math.PI) *
      Math.min(6, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
  return {
    x: a.x + (b.x - a.x) * v - arc * 0.4,
    y: a.y + (b.y - a.y) * v - arc,
  };
}

function cameraAt(t: number) {
  for (const [start, end, scale, fx, fy] of zooms) {
    const into = settle((t - start) / 1.0),
      out = settle((t - end) / 1.1),
      z = into * (1 - out);
    if (z > 0) {
      const s = 1 + (scale - 1) * z;
      return { s, fx, fy };
    }
  }
  return { s: 1, fx: 50, fy: 50 };
}

export function Showcase({ onOpen }: { onOpen: () => void }) {
  const root = useRef<HTMLDivElement>(null),
    tiltRef = useRef<HTMLDivElement>(null),
    cameraRef = useRef<HTMLDivElement>(null),
    cursorRef = useRef<HTMLDivElement>(null),
    rippleRef = useRef<HTMLDivElement>(null),
    playheadRef = useRef<HTMLDivElement>(null),
    chipRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLDivElement>(null),
    cardRef = useRef<HTMLDivElement>(null),
    stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current!;
    // Captured once: React clears refs before this effect's cleanup runs.
    const [tilt, camera, cursor, ripple, playhead, chip, button, card, stage] =
      [
        tiltRef.current!,
        cameraRef.current!,
        cursorRef.current!,
        rippleRef.current!,
        playheadRef.current!,
        chipRef.current!,
        buttonRef.current!,
        cardRef.current!,
        stageRef.current!,
      ];
    // The scene is laid out once at a fixed design size and scaled to fit,
    // so the choreography lands on the same targets at every width.
    const fit = new ResizeObserver(() =>
      stage.style.setProperty("--k", String(el.clientWidth / DESIGN_W)),
    );
    fit.observe(el);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = { x: 0, y: 0, glare: 0 },
      now = { x: 0, y: 0, glare: 0, gx: 50, gy: 30 };
    let pointer: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      };
    };
    const leave = () => (pointer = null);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    let frame = 0,
      last = performance.now(),
      clock = 1.0;
    const draw = (ms: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      if (!visible) return;
      // Tilt toward the pointer, or back to a gentle resting pose.
      if (pointer) {
        target.x = (pointer.x - 0.5) * 14;
        target.y = (0.5 - pointer.y) * 10;
        target.glare = 1;
      } else {
        target.x = -6;
        target.y = 3;
        target.glare = 0;
      }
      const k = 1 - Math.exp(-dt * 9);
      now.x += (target.x - now.x) * k;
      now.y += (target.y - now.y) * k;
      now.glare += (target.glare - now.glare) * k;
      if (pointer) {
        now.gx += (pointer.x * 100 - now.gx) * k;
        now.gy += (pointer.y * 100 - now.gy) * k;
      }
      tilt.style.transform = `rotateY(${now.x.toFixed(2)}deg) rotateX(${now.y.toFixed(2)}deg)`;
      tilt.style.setProperty("--gx", `${now.gx.toFixed(1)}%`);
      tilt.style.setProperty("--gy", `${now.gy.toFixed(1)}%`);
      tilt.style.setProperty("--glare", now.glare.toFixed(3));

      if (!reduced) clock = (clock + dt) % LOOP;
      const t = reduced ? 3 : clock;
      // Camera
      const c = cameraAt(t),
        p = cursorAt(t);
      // Follow the cursor a little while zoomed, like the real camera.
      const fx = c.fx + (p.x - c.fx) * 0.35 * (c.s - 1),
        fy = c.fy + (p.y - c.fy) * 0.35 * (c.s - 1);
      const tx = clamp(50 - fx * c.s, 100 - 100 * c.s, 0),
        ty = clamp(50 - fy * c.s, 100 - 100 * c.s, 0);
      camera.style.transform = `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${c.s.toFixed(4)})`;
      // Cursor, kept the same size on screen while the camera scales.
      const press = clicks.some((k) => t >= k - 0.06 && t < k + 0.12);
      cursor.style.transform = `translate(${p.x}%, ${p.y}%)`;
      cursor.firstElementChild!.setAttribute(
        "style",
        `transform: scale(${((press ? 0.82 : 1) / c.s).toFixed(4)})`,
      );
      // Click ripple
      const since = clicks
        .map((k) => t - k)
        .filter((d) => d >= 0 && d < 0.7)[0];
      if (since !== undefined) {
        const v = since / 0.7,
          at = cursorAt(clicks.find((k) => t - k === since)!);
        ripple.style.cssText = `opacity:${(1 - v) * 0.9};left:${at.x}%;top:${at.y}%;transform:translate(-50%,-50%) scale(${(0.3 + smooth(v) * 1.4) / c.s})`;
      } else ripple.style.opacity = "0";
      // UI reacting to the clicks
      button.classList.toggle("on", t >= 2.1 && t < 2.35);
      card.classList.toggle("on", t >= 4.5 && t < 7.4);
      // Timeline
      playhead.style.left = `${(t / LOOP) * 100}%`;
      const zoomed = c.s > 1.02;
      chip.classList.toggle("on", zoomed);
      chip.textContent = `${c.s.toFixed(1)}× zoom`;
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      fit.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div
      ref={root}
      className="st-showcase"
      role="button"
      tabIndex={0}
      aria-label="Open example video"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div ref={stageRef} className="sc-stage">
        <div ref={tiltRef} className="sc-tilt">
          <div className="sc-wallpaper" />
          <div className="sc-window">
            <div className="sc-chrome">
              <i />
              <i />
              <i />
              <span>meadow.app</span>
            </div>
            <div className="sc-viewport">
              <div ref={cameraRef} className="sc-camera">
                <div className="sc-app">
                  <aside>
                    <b>
                      <em>m</em> meadow
                    </b>
                    <span className="on">Overview</span>
                    <span>Projects</span>
                    <span>Your team</span>
                    <span>Activity</span>
                  </aside>
                  <main>
                    <header>
                      <div>
                        <small>Workspace / Projects</small>
                        <h4>Your next great idea</h4>
                      </div>
                      <div ref={buttonRef} className="sc-new">
                        + New project
                      </div>
                    </header>
                    <div className="sc-cards">
                      <div className="sc-card">
                        <i
                          style={{
                            background:
                              "linear-gradient(140deg,#d9f0c9,#a8d8a0)",
                          }}
                        />
                        <b>Brand refresh</b>
                        <small>In progress</small>
                      </div>
                      <div ref={cardRef} className="sc-card">
                        <i
                          style={{
                            background:
                              "linear-gradient(140deg,#e6dcff,#b9a4ff)",
                          }}
                        />
                        <b>A calmer inbox</b>
                        <small>Planning</small>
                      </div>
                      <div className="sc-card">
                        <i
                          style={{
                            background:
                              "linear-gradient(140deg,#ffe2cc,#ffb98f)",
                          }}
                        />
                        <b>Website</b>
                        <small>In review</small>
                      </div>
                    </div>
                    <div className="sc-rows">
                      <i />
                      <i />
                    </div>
                  </main>
                </div>
                <div ref={rippleRef} className="sc-ripple" />
                <div ref={cursorRef} className="sc-cursor">
                  <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden>
                    <path
                      d="M6 3.5v19.2c0 .9 1.1 1.3 1.7.6l4.6-5.2h7.2c.9 0 1.3-1 .7-1.7L7.7 2.9C7 2.3 6 2.7 6 3.5Z"
                      fill="#fff"
                      stroke="#1d1d1f"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <div ref={chipRef} className="sc-chip">
                1.0× zoom
              </div>
            </div>
          </div>
          <div className="sc-bar">
            <span className="sc-play">
              <Play size={11} fill="currentColor" />
            </span>
            <div className="sc-track">
              <i
                className="sc-zoom"
                style={{
                  left: `${(2.15 / LOOP) * 100}%`,
                  width: `${((5.7 - 2.15) / LOOP) * 100}%`,
                }}
              />
              {clicks.map((k) => (
                <i
                  key={k}
                  className="sc-tick"
                  style={{ left: `${(k / LOOP) * 100}%` }}
                />
              ))}
              <div ref={playheadRef} className="sc-playhead" />
            </div>
            <span className="sc-cta">
              Try the editor <span aria-hidden>→</span>
            </span>
          </div>
          <div className="sc-glare" />
        </div>
      </div>
    </div>
  );
}
