import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { clock, command, elapsed, type Session } from "./protocol";
import "./popup.css";
// The floating recording controls. Closes itself when recording ends.
function Hud() {
  const [session, setSession] = useState<Session | null | undefined>(),
    [, tick] = useState(0),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    void command("state").then(setSession);
    const changed = (c: Record<string, chrome.storage.StorageChange>) => {
      if ("session" in c) setSession(c.session.newValue ?? null);
    };
    chrome.storage.session.onChanged.addListener(changed);
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => {
      chrome.storage.session.onChanged.removeListener(changed);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (session === null) window.close();
  }, [session]);
  if (!session) return null;
  const run = (type: string) => void command(type).catch(() => {});
  return (
    <main className={`hud ${session.paused ? "paused" : ""}`}>
      <button
        className="hud-time"
        title="Go to the recorded tab"
        onClick={() => run("focus")}
      >
        <span className="record-dot" />
        {clock(elapsed(session))}
        <small>{session.paused ? "Paused" : "Recording"}</small>
      </button>
      {confirm ? (
        <>
          <button className="hud-danger" onClick={() => run("discard")}>
            Discard
          </button>
          <button onClick={() => setConfirm(false)}>Keep</button>
        </>
      ) : (
        <>
          <button
            title={session.paused ? "Resume (Alt Shift R)" : "Pause (Alt Shift R)"}
            aria-label={session.paused ? "Resume" : "Pause"}
            onClick={() => run("pause")}
          >
            {session.paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
          </button>
          <button
            className="hud-finish"
            title="Finish and open the editor (Alt Shift S)"
            onClick={() => run("stop")}
          >
            <Square size={12} fill="currentColor" /> Finish
          </button>
          <button
            title="Discard this recording"
            aria-label="Discard recording"
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Hud />);
