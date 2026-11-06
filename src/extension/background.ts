import {
  getProject,
  saveProject,
  recoverProject,
  deleteProject,
} from "../lib/db";
import { newProject } from "../lib/model";
import {
  defaultOptions,
  type RecordOptions,
  type Session,
} from "./protocol";
import {
  attachSurface,
  surfaceSnapshot,
  resumeSurface,
  pauseSurface,
  detachSurface,
  surfaceLost,
} from "./screencast";
const current = async (): Promise<Session | undefined> =>
  (await chrome.storage.session.get("session")).session;
const off = async (type: string, data: Record<string, unknown> = {}) => {
  const r = await chrome.runtime.sendMessage({
    target: "offscreen",
    type,
    ...data,
  });
  if (r?.error) throw Error(r.error);
  return r;
};
async function inject(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "recording-state",
    active: true,
  });
  const ready = await chrome.tabs.sendMessage(tabId, { type: "capture-ready" });
  if (!ready?.active) throw Error("The page recorder is not ready.");
}
async function badge(s?: Session) {
  await chrome.action.setBadgeText({ text: s ? (s.paused ? "Ⅱ" : "REC") : "" });
  await chrome.action.setBadgeBackgroundColor({
    color: s?.paused ? "#6a7469" : "#d6483c",
  });
}
// Messages in the recorded page itself, since the popup is usually closed by
// the time something goes wrong.
async function notify(tabId: number, message: string) {
  await chrome.scripting
    .executeScript({
      target: { tabId },
      args: [message],
      func: (text: string) => {
        const el = document.createElement("div");
        el.textContent = "Open Arcade · " + text;
        el.style.cssText =
          "all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:min(560px,90vw);padding:12px 18px;border-radius:12px;background:#1b221c;color:#f1f6ec;font:500 14px/1.45 -apple-system,Inter,Segoe UI,sans-serif;box-shadow:0 12px 40px #0006";
        document.documentElement.append(el);
        setTimeout(() => el.remove(), 7000);
      },
    })
    .catch(() => {});
}
// 3-2-1 in the page before any frame is captured. A click starts right away.
async function countdown(tabId: number) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // Styles go through CSSOM and the Web Animations API, which page
      // content security policies don't block, inside a closed shadow root
      // so the site's CSS can't reach in.
      const host = document.createElement("div");
      host.style.cssText =
        "all:initial;position:fixed;inset:0;z-index:2147483647;cursor:pointer";
      const root = host.attachShadow({ mode: "closed" });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        :host { all: initial; }
        .scrim { position: fixed; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 22px;
          background: rgba(0, 0, 0, 0.22);
          backdrop-filter: blur(6px) saturate(120%);
          -webkit-backdrop-filter: blur(6px) saturate(120%);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Inter, "Segoe UI", sans-serif;
          -webkit-font-smoothing: antialiased; }
        .dial { position: relative; width: 188px; height: 188px; border-radius: 50%;
          display: grid; place-items: center;
          background: rgba(30, 30, 32, 0.55);
          backdrop-filter: blur(40px) saturate(180%);
          -webkit-backdrop-filter: blur(40px) saturate(180%);
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25),
            inset 0 0 0 0.5px rgba(255, 255, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.18); }
        svg { position: absolute; inset: 0; transform: rotate(-90deg); }
        circle { fill: none; stroke-width: 5; }
        .track { stroke: rgba(255, 255, 255, 0.14); }
        .ring { stroke: #fff; stroke-linecap: round; }
        .num { color: #fff; font-size: 92px; font-weight: 600; line-height: 1;
          letter-spacing: -0.04em; font-variant-numeric: tabular-nums;
          text-shadow: 0 2px 12px rgba(0, 0, 0, 0.25); }
        .pill { display: flex; align-items: center; gap: 9px; padding: 10px 16px 10px 14px;
          border-radius: 999px; color: #fff; font-size: 14px; font-weight: 500;
          letter-spacing: -0.01em;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, "Segoe UI", sans-serif;
          background: rgba(30, 30, 32, 0.6);
          backdrop-filter: blur(30px) saturate(180%);
          -webkit-backdrop-filter: blur(30px) saturate(180%);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), inset 0 0 0 0.5px rgba(255, 255, 255, 0.2); }
        .pill span { color: rgba(235, 235, 245, 0.6); }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff453a;
          box-shadow: 0 0 0 4px rgba(255, 69, 58, 0.28); }
      `);
      root.adoptedStyleSheets = [sheet];
      const r = 86,
        length = 2 * Math.PI * r;
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      const dial = document.createElement("div");
      dial.className = "dial";
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg"),
        track = document.createElementNS(ns, "circle"),
        ring = document.createElementNS(ns, "circle");
      svg.setAttribute("viewBox", "0 0 188 188");
      for (const [c, name] of [
        [track, "track"],
        [ring, "ring"],
      ] as const) {
        c.setAttribute("cx", "94");
        c.setAttribute("cy", "94");
        c.setAttribute("r", String(r));
        c.setAttribute("class", name);
      }
      ring.setAttribute("stroke-dasharray", String(length));
      svg.append(track, ring);
      const num = document.createElement("div");
      num.className = "num";
      dial.append(svg, num);
      const pill = document.createElement("div");
      pill.className = "pill";
      const dot = document.createElement("i"),
        label = document.createElement("b"),
        hint = document.createElement("span");
      dot.className = "dot";
      label.textContent = "Recording starts in a moment";
      label.style.fontWeight = "500";
      hint.textContent = "· Click to start now";
      pill.append(dot, label, hint);
      scrim.append(dial, pill);
      root.append(scrim);
      document.documentElement.append(host);
      const spring = "cubic-bezier(0.34, 1.56, 0.64, 1)",
        out = "cubic-bezier(0.16, 1, 0.3, 1)";
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      dial.animate(
        [{ transform: "scale(0.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 520, easing: spring },
      );
      pill.animate(
        [{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 520, delay: 80, easing: out, fill: "backwards" },
      );
      dot.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], {
        duration: 1200,
        iterations: Infinity,
      });
      await new Promise<void>((done) => {
        let n = 3;
        const tick = () => {
          if (n === 0) return done();
          num.textContent = String(n--);
          num.animate(
            [
              { transform: "scale(1.35)", opacity: 0, filter: "blur(8px)" },
              { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
            ],
            { duration: 460, easing: spring },
          );
          ring.animate(
            [{ strokeDashoffset: 0 }, { strokeDashoffset: length }],
            { duration: 850, easing: "linear", fill: "forwards" },
          );
          setTimeout(tick, 850);
        };
        host.onclick = () => done();
        tick();
      });
      await scrim.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 150,
        easing: "ease-in",
        fill: "forwards",
      }).finished;
      host.remove();
      // Let the page present a frame without the countdown before capture.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        width: innerWidth,
        height: innerHeight,
        pixelRatio: devicePixelRatio,
      };
    },
  });
  return result!;
}
// A small control window. It is its own window, so it never appears in the
// recorded tab.
async function openHud(tab: chrome.tabs.Tab) {
  try {
    const win = await chrome.windows.get(tab.windowId),
      width = 300,
      height = 92;
    const hud = await chrome.windows.create({
      url: chrome.runtime.getURL("hud.html"),
      type: "popup",
      width,
      height,
      left: Math.max(0, (win.left ?? 0) + 24),
      top: Math.max(0, (win.top ?? 0) + (win.height ?? 800) - height - 24),
      focused: false,
    });
    await chrome.windows.update(tab.windowId, { focused: true });
    return hud?.id;
  } catch {
    return undefined;
  }
}
let finishing: Promise<void> | undefined;
function stop(open = true): Promise<void> {
  return (finishing ??= finishCapture(open).finally(() => {
    finishing = undefined;
  }));
}
async function finishCapture(open = true) {
  const s = await current();
  if (!s) return;
  await pauseSurface();
  try {
    await off("stop");
  } catch {
    const p = await getProject(s.projectId);
    if (p) await recoverProject(p);
  }
  await chrome.storage.session.remove("session");
  await detachSurface();
  await badge();
  if (s.hudWindow) await chrome.windows.remove(s.hudWindow).catch(() => {});
  await chrome.tabs
    .sendMessage(s.tabId, { type: "recording-state", active: false })
    .catch(() => {});
  if (await chrome.offscreen.hasDocument())
    await chrome.offscreen.closeDocument();
  if (open)
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`index.html#project/${s.projectId}`),
    });
}
let starting = false;
type Start = RecordOptions & { tabId: number };
// Everything that can fail fast happens here, so the popup can report it.
async function prepare(m: Start) {
  if (starting || (await current()))
    throw Error("A recording is already running.");
  const tab = await chrome.tabs.get(m.tabId);
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url))
    throw Error(
      "Open a regular website tab to record. Chrome system pages and the Web Store can't be recorded.",
    );
  starting = true;
  const p = newProject(tab.title || "New recording");
  p.status = "recording";
  p.captureVersion = 4;
  try {
    await saveProject(p);
    if (await chrome.offscreen.hasDocument())
      await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Record the tab selected by the user and save media locally.",
    });
    const streamId = m.systemAudio
      ? await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
      : undefined;
    await attachSurface(tab.id);
    return { tab: tab as chrome.tabs.Tab & { id: number; url: string }, p, streamId };
  } catch (e) {
    await abort(p.id);
    throw e;
  }
}
async function abort(projectId: string) {
  await detachSurface();
  if (await chrome.offscreen.hasDocument()) {
    await off("stop").catch(() => {});
    await chrome.offscreen.closeDocument();
  }
  await chrome.storage.session.remove("session");
  await deleteProject(projectId);
  starting = false;
}
async function launch(
  m: Start,
  { tab, p, streamId }: Awaited<ReturnType<typeof prepare>>,
) {
  try {
    const viewport = await countdown(tab.id);
    const initialFrame = await surfaceSnapshot();
    await off("start", {
      streamId,
      projectId: p.id,
      viewport,
      initialFrame,
      systemAudio: m.systemAudio,
      microphone: m.microphone,
      camera: m.camera,
    });
    const s: Session = {
      projectId: p.id,
      tabId: tab.id,
      paused: false,
      started: Date.now(),
      pausedMs: 0,
      origin: new URL(tab.url).origin,
      crossSite: m.crossSite,
    };
    await chrome.storage.session.set({ session: s });
    surfaceLost(() => {
      void stop();
    });
    await resumeSurface();
    await inject(tab.id);
    await badge(s);
    s.hudWindow = await openHud(tab);
    if ((await current())?.projectId === s.projectId)
      await chrome.storage.session.set({ session: s });
    return s;
  } catch (e) {
    await abort(p.id);
    await notify(tab.id, `Recording couldn't start: ${(e as Error).message}`);
    throw e;
  } finally {
    starting = false;
  }
}
async function start(m: Start) {
  const ready = await prepare(m);
  return launch(m, ready);
}
async function needsDevicePermission(o: RecordOptions) {
  for (const [on, name] of [
    [o.microphone, "microphone"],
    [o.camera, "camera"],
  ] as const) {
    if (!on) continue;
    const state = await navigator.permissions
      .query({ name: name as PermissionName })
      .then((r) => r.state)
      .catch(() => "prompt");
    if (state !== "granted") return true;
  }
  return false;
}
async function togglePause() {
  const s = await current();
  if (!s) return;
  if (!s.paused) await pauseSurface();
  await off("pause", { paused: !s.paused });
  s.paused = !s.paused;
  if (s.paused) s.pausedAt = Date.now();
  else {
    s.pausedMs += Date.now() - (s.pausedAt ?? Date.now());
    s.pausedAt = undefined;
  }
  await chrome.storage.session.set({ session: s });
  await badge(s);
  if (!s.paused) await resumeSurface();
  return s;
}
async function handle(
  m: Record<string, any>,
  sender: chrome.runtime.MessageSender,
) {
  if (m.type === "state") {
    const s = await current();
    if (s && !(await chrome.offscreen.hasDocument())) {
      await stop(false);
      return null;
    }
    return s ?? null;
  }
  if (m.type === "start") {
    const options = { ...defaultOptions, ...m } as Start;
    // Reply once the capture is armed; the countdown runs after the popup closes.
    const ready = await prepare(options);
    void launch(options, ready).catch(() => {});
    return { ok: true };
  }
  if (m.type === "event") {
    const s = await current();
    if (!s || s.paused || sender.tab?.id !== s.tabId) return;
    if (!s.crossSite && sender.url && new URL(sender.url).origin !== s.origin)
      return;
    return off("event", { event: m.event });
  }
  if (m.type === "pause") return togglePause();
  if (m.type === "stop" || m.type === "ended") {
    await stop();
    return true;
  }
  if (m.type === "discard") {
    const s = await current();
    await stop(false);
    if (s) await deleteProject(s.projectId);
    return true;
  }
  if (m.type === "focus") {
    const s = await current();
    if (s) {
      const tab = await chrome.tabs.update(s.tabId, { active: true });
      if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  }
  if (m.type === "open") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    return true;
  }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.target !== "background") return;
  handle(m, sender)
    .then((result) => reply(result))
    .catch((e) => reply({ error: e.message || String(e) }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete")
    void current().then(async (s) => {
      if (s?.tabId === tabId) {
        const tab = await chrome.tabs.get(tabId);
        if (!s.crossSite && tab.url && new URL(tab.url).origin !== s.origin) {
          await chrome.action.setBadgeText({ text: "!" });
          return;
        }
        await inject(tabId)
          .then(() => badge(s))
          .catch(() => chrome.action.setBadgeText({ text: "!" }));
      }
    });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void current().then((s) => {
    if (s?.tabId === tabId) void stop();
  });
});
chrome.commands.onCommand.addListener((name, commandTab) => {
  if (name === "stop-recording") void stop();
  if (name !== "toggle-recording") return;
  void (async () => {
    if (await current()) return void (await togglePause());
    const tab =
      commandTab ??
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return;
    const saved = (await chrome.storage.local.get("options")).options,
      options: Start = { ...defaultOptions, ...saved, tabId: tab.id };
    // Website access can only be granted from a click in the popup.
    if (
      options.crossSite &&
      !(await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }))
    )
      options.crossSite = false;
    if (await needsDevicePermission(options)) {
      await chrome.tabs.create({
        url:
          chrome.runtime.getURL("permissions.html") +
          "#" +
          encodeURIComponent(JSON.stringify(options)),
      });
      return;
    }
    await start(options).catch((e) => notify(tab.id!, e.message));
  })();
});
