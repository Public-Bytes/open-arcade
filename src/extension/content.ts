// No imports: Chrome injects this file as a classic script.
(() => {
  const w = window as typeof window & { __openArcade?: boolean };
  if (w.__openArcade) return;
  w.__openArcade = true;
  let active = true,
    lastActivity = 0,
    lastClick = 0,
    lastError = "";
  const send = (event: Record<string, unknown>) => {
    if (active)
      void chrome.runtime
        .sendMessage({
          target: "background",
          type: "event",
          event: {
            ...event,
            viewport: { width: innerWidth, height: innerHeight },
          },
        })
        .then((r) => {
          if (r?.error) lastError = r.error;
        })
        .catch((e) => {
          lastError = e.message;
        });
  };
  const label = (target: EventTarget | null) => {
    const e =
      target instanceof Element
        ? target.closest(
            'button,a,label,input,textarea,select,[role="button"],[aria-label]',
          ) || target
        : null;
    if (!e) return "Continue";
    const secret = e instanceof HTMLInputElement && e.type === "password";
    const name = secret
      ? "password field"
      : e.getAttribute("aria-label") ||
        e.getAttribute("placeholder") ||
        e.textContent?.trim().slice(0, 65) ||
        e.tagName.toLowerCase();
    return name.replace(/\s+/g, " ").slice(0, 80);
  };
  let lastTarget: EventTarget | null = null,
    cursor: "arrow" | "hand" | "text" = "arrow";
  let pendingPointer: Record<string, unknown> | undefined,
    pointerFrame = 0;
  const flushPointer = () => {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    if (pendingPointer) {
      send(pendingPointer);
      pendingPointer = undefined;
    }
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!active) return;
      if (e.target !== lastTarget) {
        lastTarget = e.target;
        const value =
          e.target instanceof Element
            ? getComputedStyle(e.target).cursor
            : "default";
        cursor =
          value === "pointer" ? "hand" : value === "text" ? "text" : "arrow";
      }
      pendingPointer = {
        kind: "pointer",
        time: performance.timeOrigin + e.timeStamp,
        x: (e.clientX / innerWidth) * 100,
        y: (e.clientY / innerHeight) * 100,
        cursor,
        visible: true,
        label: "",
      };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointer);
    },
    { capture: true, passive: true },
  );
  document.addEventListener("pointerleave", (e) => {
    flushPointer();
    send({
      kind: "pointer",
      time: performance.timeOrigin + e.timeStamp,
      visible: false,
      label: "",
    });
  });
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      flushPointer();
      lastClick = Date.now();
      send({
        kind: "click",
        time: performance.timeOrigin + e.timeStamp,
        x: (e.clientX / innerWidth) * 100,
        y: (e.clientY / innerHeight) * 100,
        label: `Click ${label(e.target)}`,
        cursor,
      });
    },
    true,
  );
  window.addEventListener("resize", () =>
    send({ kind: "viewport", time: Date.now(), label: "" }),
  );
  const activity = (e: Event) => {
    if (Date.now() - lastActivity < 250) return;
    lastActivity = Date.now();
    send({
      kind: "activity",
      time: performance.timeOrigin + e.timeStamp,
      label:
        e.type === "scroll"
          ? "Scroll to explore"
          : e.type === "drag"
            ? "Drag to arrange"
            : `Type into ${label(e.target)}`,
    });
  };
  window.addEventListener("scroll", activity, { capture: true, passive: true });
  window.addEventListener("input", activity, true);
  window.addEventListener("drag", activity, true);
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m.type === "recording-state") active = m.active;
    if (m.type === "capture-ready")
      reply({ active, lastClick, lastError, url: location.href });
  });
  // A reinjection after a previous recording reactivates the existing listeners.
  chrome.runtime
    .sendMessage({ target: "background", type: "state" })
    .then((s) => {
      active = !!s;
    })
    .catch(() => {});
})();
