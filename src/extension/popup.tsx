import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Play,
  Square,
  Pause,
  FolderOpen,
  Loader2,
  Mic,
  Camera,
  Volume2,
  Globe,
  Trash2,
} from "lucide-react";
import {
  clock,
  command,
  defaultOptions,
  elapsed,
  type RecordOptions,
  type Session,
} from "./protocol";
import "./popup.css";
const toggles: {
  key: keyof RecordOptions;
  label: string;
  hint: string;
  icon: typeof Mic;
}[] = [
  { key: "systemAudio", label: "Tab audio", hint: "Sound playing in this tab", icon: Volume2 },
  { key: "microphone", label: "Microphone", hint: "Narrate as you go", icon: Mic },
  { key: "camera", label: "Webcam", hint: "A bubble you can place later", icon: Camera },
  {
    key: "crossSite",
    label: "Follow links to other sites",
    hint: "Keep tracking clicks if this tab leaves the site",
    icon: Globe,
  },
];
function Popup() {
  const [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [options, setOptions] = useState<RecordOptions>(defaultOptions),
    [tab, setTab] = useState<chrome.tabs.Tab>(),
    [, tick] = useState(0);
  useEffect(() => {
    void Promise.all([
      command("state"),
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.local.get("options"),
    ])
      .then(([s, t, stored]) => {
        setSession(s);
        setTab(t[0]);
        setOptions({ ...defaultOptions, ...stored.options });
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const recordable = !!tab?.url && /^https?:/.test(tab.url);
  function choose(key: keyof RecordOptions, value: boolean) {
    const next = { ...options, [key]: value };
    setOptions(next);
    void chrome.storage.local.set({ options: next });
  }
  async function action(type: string) {
    setBusy(true);
    setError("");
    try {
      if (type === "start") {
        if (!tab?.id || !recordable)
          throw Error(
            "Open a website tab first. Chrome system pages can't be recorded.",
          );
        if (options.crossSite) {
          const granted = await chrome.permissions.request({
            origins: ["http://*/*", "https://*/*"],
          });
          if (!granted)
            throw Error(
              "Following links needs access to those websites. Turn the option off to record just this site.",
            );
        }
        const start = { ...options, tabId: tab.id };
        const needsPermission = (
          await Promise.all(
            (["microphone", "camera"] as const)
              .filter((d) => (d === "camera" ? options.camera : options.microphone))
              .map((name) =>
                navigator.permissions
                  .query({ name: name as PermissionName })
                  .then((r) => r.state !== "granted"),
              ),
          )
        ).some(Boolean);
        if (needsPermission) {
          await chrome.tabs.create({
            url:
              chrome.runtime.getURL("permissions.html") +
              "#" +
              encodeURIComponent(JSON.stringify(start)),
          });
          window.close();
          return;
        }
        await command("start", start);
        window.close();
      } else if (type === "pause") setSession(await command("pause"));
      else {
        await command(type);
        if (type === "stop" || type === "open" || type === "discard")
          window.close();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="popup">
      <div className="logo">
        <span className="brand-mark">
          <Play size={15} fill="currentColor" />
        </span>
        Open Arcade
      </div>
      {session ? (
        <>
          <div className={`popup-live ${session.paused ? "paused" : ""}`}>
            <span className="record-dot" />
            <strong>{clock(elapsed(session))}</strong>
            <span>{session.paused ? "Paused" : "Recording this tab"}</span>
          </div>
          <div className="two-col">
            <button
              className="full-secondary"
              disabled={busy}
              onClick={() => action("pause")}
            >
              {session.paused ? <Play size={14} /> : <Pause size={14} />}{" "}
              {session.paused ? "Resume" : "Pause"}
            </button>
            <button
              className="dark-button"
              disabled={busy}
              onClick={() => action("stop")}
            >
              <Square size={12} fill="currentColor" /> Finish
            </button>
          </div>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => action("discard")}
          >
            <Trash2 size={14} /> Discard recording
          </button>
        </>
      ) : (
        <>
          <p className="popup-target" title={tab?.url}>
            {recordable
              ? <>Record <strong>{tab?.title || "this tab"}</strong></>
              : "Open a website tab to record it."}
          </p>
          <div className="popup-options">
            {toggles.map(({ key, label, hint, icon: Icon }) => (
              <label key={key}>
                <Icon size={16} />
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => choose(key, e.target.checked)}
                />
                <i />
              </label>
            ))}
          </div>
          <button
            className="dark-button"
            disabled={busy || !recordable}
            onClick={() => action("start")}
          >
            {busy ? <Loader2 size={16} /> : <span className="record-dot" />}
            Start recording
          </button>
        </>
      )}
      {error && (
        <p className="popup-error" role="alert">
          {error}
        </p>
      )}
      <div className="popup-shortcut">
        <span>
          <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>R</kbd> start · pause
        </span>
        <span>
          <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>S</kbd> finish
        </span>
      </div>
      <button className="text-button" onClick={() => action("open")}>
        <FolderOpen size={14} /> Open your recordings
      </button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
