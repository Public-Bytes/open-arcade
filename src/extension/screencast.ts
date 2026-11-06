// Page screencast reads the compositor surface, before the OS cursor overlay.
// Only one frame is in flight; Chrome retains the newest frame under load.
type Frame = {
  data: string;
  sessionId: number;
  metadata?: { timestamp?: number };
};
let tab: number | undefined;
let inFlight = Promise.resolve();
let failed: (() => void) | undefined;
let lastFrameTime = -Infinity;
const send = (method: string, params?: Record<string, unknown>) =>
  chrome.debugger.sendCommand({ tabId: tab! }, method, params);
export async function attachSurface(tabId: number) {
  tab = tabId;
  lastFrameTime = -Infinity;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await send("Page.enable");
  } catch (error) {
    await detachSurface();
    if (
      error instanceof Error &&
      /another debugger|already attached/i.test(error.message)
    )
      throw Error("Close DevTools for this tab, then start recording again.");
    throw error;
  }
}
export async function surfaceSnapshot() {
  const initial = (await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 94,
    fromSurface: true,
    captureBeyondViewport: false,
  })) as { data: string };
  return initial.data;
}
export async function resumeSurface() {
  await send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: 1920,
    maxHeight: 1440,
    everyNthFrame: 1,
    maxFramesInFlight: 1,
    sendLastFrame: true,
  });
}
export async function pauseSurface() {
  if (tab !== undefined) await send("Page.stopScreencast").catch(() => {});
  await inFlight;
}
export async function detachSurface() {
  if (tab === undefined) return;
  const id = tab;
  tab = undefined;
  failed = undefined;
  await chrome.debugger
    .sendCommand({ tabId: id }, "Page.stopScreencast")
    .catch(() => {});
  await inFlight;
  await chrome.debugger.detach({ tabId: id }).catch(() => {});
}
export function surfaceLost(callback: () => void) {
  failed = callback;
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== tab || method !== "Page.screencastFrame") return;
  const frame = params as Frame,
    id = tab!;
  inFlight = inFlight
    .catch(() => {})
    .then(async () => {
      if (tab !== id) return;
      try {
        const timestamp = frame.metadata?.timestamp;
        if (timestamp !== undefined && timestamp < lastFrameTime) {
          await chrome.debugger.sendCommand(
            { tabId: id },
            "Page.screencastFrameAck",
            { sessionId: frame.sessionId },
          );
          return;
        }
        const reply = await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "frame",
          data: frame.data,
        });
        if (reply?.error) throw Error(reply.error);
        if (timestamp !== undefined) lastFrameTime = timestamp;
        await chrome.debugger.sendCommand(
          { tabId: id },
          "Page.screencastFrameAck",
          { sessionId: frame.sessionId },
        );
      } catch {
        if (tab === id) failed?.();
      }
    });
});
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === tab) {
    tab = undefined;
    failed?.();
  }
});
