import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  Plus,
  Upload,
  Download,
  X,
  Undo2,
  Redo2,
  Monitor,
  MousePointer2,
  Focus,
  Palette,
  Mic,
  Camera,
  Type,
  Scissors,
  Trash2,
  FolderOpen,
  Search,
  MoreHorizontal,
  Film,
  Settings2,
  Check,
  ChevronRight,
  Loader2,
  Volume2,
  Video,
  Keyboard,
  Copy,
  RotateCcw,
  Pencil,
  CircleDot,
  Gauge,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  listProjects,
  getProject,
  saveProject,
  getAsset,
  putAsset,
  deleteProject,
  duplicateProject,
  recoverProject,
} from "./lib/db";
import {
  newProject,
  newStep,
  uid,
  referencedAssets,
  type Project,
} from "./lib/model";
import { addMedia } from "./lib/media";
import { download, filename, importProject } from "./lib/export";
import { ensureFilm } from "./film/project";
import { defaultSettings, backgrounds, type FilmSettings } from "./film/types";
import { autoZooms } from "./film/motion";
import { FilmPreview } from "./film/Preview";
import { Overlay } from "./film/Overlay";
import { outputDuration, outputTime } from "./film/time";
import type { FilmAnnotation, ZoomRegion } from "./film/types";
import { Timeline } from "./film/Timeline";
import { exportFilm, type RenderProgress } from "./film/export";
import { filmArchive } from "./film/archive";
import { Showcase } from "./Showcase";
import "./studio.css";
const extension = !!globalThis.chrome?.runtime?.id;
function Icon({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="st-icon"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,textarea",
          ),
        ].filter((n) => n.getClientRects().length);
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (old instanceof HTMLElement) old.focus();
    };
  }, []);
  return (
    <div
      className="st-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="st-dialog"
      >
        <header>
          <h2>{title}</h2>
          <Icon label="Close" onClick={onClose}>
            <X size={19} />
          </Icon>
        </header>
        {children}
      </section>
    </div>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="st-range">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {suffix}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        style={{ "--p": `${((value - min) / (max - min || 1)) * 100}%` } as React.CSSProperties}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
function Switch({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="st-switch">
      <div>
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i />
    </label>
  );
}
function useMedia(p: Project | null) {
  const [media, set] = useState<Record<string, string>>({});
  const key = p ? referencedAssets(p).join("|") : "";
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const map: Record<string, string> = {};
      for (const id of key.split("|").filter(Boolean)) {
        const a = await getAsset(id);
        if (a) {
          const url = URL.createObjectURL(a.blob);
          urls.push(url);
          map[id] = url;
        }
      }
      if (live) set(map);
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return media;
}
function Thumb({ project }: { project: Project }) {
  const [src, set] = useState("");
  const first =
    project.steps.find((s) => s.posterId) ||
    project.steps.find((s) => s.type === "image" || s.type === "video");
  const id = first?.posterId || first?.assetId,
    video = !first?.posterId && first?.type === "video";
  useEffect(() => {
    let live = true,
      url = "";
    if (id)
      void getAsset(id).then((a) => {
        if (a) {
          url = URL.createObjectURL(a.blob);
          if (live) set(url);
        }
      });
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [id]);
  return (
    <div className="st-thumb">
      {src && video ? (
        <video src={`${src}#t=0.6`} muted preload="metadata" />
      ) : src ? (
        <img src={src} alt="" />
      ) : (
        <div>
          <Monitor size={38} />
        </div>
      )}
      <span className="st-thumb-play">
        <Play size={20} fill="currentColor" />
      </span>
    </div>
  );
}
// Fields that take typed text keep the keyboard; every other control lets
// the editor's shortcuts through.
const typing = (el: HTMLElement) =>
  el.isContentEditable ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement &&
    !["range", "checkbox", "radio", "color", "button", "submit", "file"].includes(
      el.type,
    ));
function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="st-kbd">{children}</kbd>;
}
const shortcuts: [string, string][] = [
  ["Space", "Play / pause"],
  ["← →", "Step one frame (Shift: one second)"],
  ["Home / End", "Jump to start / end"],
  ["I / O", "Set trim in / out at the playhead"],
  ["X", "Cut out a section at the playhead"],
  ["Z", "Add a zoom at the playhead"],
  ["T", "Add text at the playhead"],
  ["Delete", "Remove the selected zoom, cut or text"],
  ["Esc", "Deselect"],
  ["⌘ Z / ⇧ ⌘ Z", "Undo / redo"],
  ["⌘ scroll", "Zoom the timeline"],
  ["?", "Show shortcuts"],
];
const clock = (time: number, precise = false) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}${precise ? "." + String(Math.floor((time % 1) * 100)).padStart(2, "0") : ""}`;
let saves = Promise.resolve();
const pendingSaves = new Map<
  string,
  {
    project: Project;
    timer: ReturnType<typeof setTimeout>;
    done: () => void;
    fail: (e: Error) => void;
  }
>();
function flushSaves() {
  for (const [id, item] of pendingSaves) {
    clearTimeout(item.timer);
    pendingSaves.delete(id);
    saves = saves.catch(() => {}).then(() => saveProject(item.project));
    void saves.then(item.done).catch(item.fail);
  }
  return saves;
}
export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]),
    [p, setP] = useState<Project | null>(null),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState<string | null>(null),
    [tab, setTab] = useState("camera"),
    [selected, setSelected] = useState<string | null>(null),
    [time, setTime] = useState(0),
    [seekId, setSeekId] = useState(0),
    [playing, setPlaying] = useState(false),
    [notice, setNotice] = useState(""),
    [saved, setSaved] = useState(true),
    [rendering, setRendering] = useState(false),
    [progress, setProgress] = useState<RenderProgress | null>(null),
    [result, setResult] = useState<{
      elapsed: number;
      duration: number;
    } | null>(null),
    [output, setOutput] = useState({
      width: 1920,
      fps: 60,
      quality: 8000000,
      format: "mp4" as "mp4" | "gif",
    }),
    [menu, setMenu] = useState<string | null>(null),
    [renaming, setRenaming] = useState<string | null>(null),
    [dropping, setDropping] = useState(false);
  const current = useRef(p);
  current.current = p;
  const version = useRef(0),
    undo = useRef<Project[]>([]),
    redo = useRef<Project[]>([]),
    lastEdit = useRef({ key: "", at: 0 }),
    importRef = useRef<HTMLInputElement>(null),
    videoRef = useRef<HTMLInputElement>(null),
    audioRef = useRef<HTMLInputElement>(null),
    webcamRef = useRef<HTMLInputElement>(null),
    cancel = useRef<AbortController | null>(null);
  const media = useMedia(p),
    film = p?.film,
    settings = film?.settings,
    regions = useMemo(() => (film ? autoZooms(film) : []), [film]),
    region = regions.find((r) => r.id === selected),
    annotation = film?.annotations.find((a) => a.id === selected),
    cut = film?.cuts?.find((c) => c.id === selected),
    finalLength = film ? outputDuration(film) : 0;
  const toast = useCallback((s: string) => setNotice(s), []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 5500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".st-menu-wrap")) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const refresh = useCallback(
    async () => setProjects(await listProjects()),
    [],
  );
  const open = useCallback(async (id: string) => {
    const stored = await getProject(id);
    if (!stored) {
      location.hash = "";
      return;
    }
    const project = ensureFilm(stored);
    setP(project);
    seek(project.film!.trimStart);
    setPlaying(false);
    setSelected(null);
    undo.current = [];
    redo.current = [];
    if (project !== stored) await saveProject(project);
  }, []);
  useEffect(() => {
    void refresh().then(() => setLoading(false));
    const route = () => {
      void flushSaves()
        .then(() => {
          const id = location.hash.match(/^#project\/(.+)$/)?.[1];
          if (id) void open(id).catch((e) => toast(e.message));
          else {
            setP(null);
            setPlaying(false);
            void refresh();
          }
        })
        .catch((e) => toast(e.message));
    };
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("pagehide", flushSaves);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("pagehide", flushSaves);
      void flushSaves();
    };
  }, [open, refresh, toast]);
  // `history` is true for a discrete edit, false for none (a drag already
  // recorded its starting point), or a key: repeated edits with the same key
  // in quick succession (a slider drag, typing) become a single undo step.
  function update(next: Project, history: boolean | string = true) {
    const prev = current.current;
    if (prev?.status === "recording") {
      toast("Finish or recover the recording before editing.");
      return;
    }
    if (prev && history) {
      const key = typeof history === "string" ? history : "",
        now = Date.now(),
        merge =
          key && key === lastEdit.current.key && now - lastEdit.current.at < 900;
      lastEdit.current = { key, at: now };
      if (!merge) {
        undo.current.push(prev);
        undo.current = undo.current.slice(-100);
      }
      redo.current = [];
    }
    const q = { ...next, updated: Date.now() };
    current.current = q;
    setP(q);
    setSaved(false);
    const v = ++version.current;
    const old = pendingSaves.get(q.id);
    if (old) clearTimeout(old.timer);
    pendingSaves.set(q.id, {
      project: q,
      timer: setTimeout(() => void flushSaves(), 350),
      done: () => {
        if (v === version.current) setSaved(true);
      },
      fail: (e) => toast(`Saving failed: ${e.message}`),
    });
  }
  function changeSetting<K extends keyof FilmSettings>(
    key: K,
    value: FilmSettings[K],
  ) {
    const q = current.current;
    if (q?.film)
      update(
        {
          ...q,
          film: { ...q.film, settings: { ...q.film.settings, [key]: value } },
        },
        `setting:${key}`,
      );
  }
  function changeFilm(
    value: Partial<NonNullable<Project["film"]>>,
    history: boolean | string = true,
  ) {
    const q = current.current;
    if (q?.film) update({ ...q, film: { ...q.film, ...value } }, history);
  }
  function history(direction: "undo" | "redo") {
    const q = (direction === "undo" ? undo : redo).current.pop();
    if (q && p) {
      (direction === "undo" ? redo : undo).current.push(p);
      lastEdit.current = { key: "", at: 0 };
      update(q, false);
    }
  }
  const seek = useCallback((t: number | ((previous: number) => number)) => {
    setTime(t);
    setSeekId((id) => id + 1);
  }, []);
  const publishTime = useCallback((t: number) => setTime(t), []);
  function togglePlay() {
    if (!film) return;
    if (!playing && time >= film.trimEnd - 0.01) seek(film.trimStart);
    if (!playing) setSelected((s) => (s === "webcam" ? null : s));
    setPlaying((v) => !v);
  }
  // Editing an automatic zoom turns it into a regular one with the same id and
  // tells the generator to leave that click alone. It keeps following the
  // cursor unless the edit itself says otherwise.
  function patchZoom(
    r: ZoomRegion,
    patch: Partial<ZoomRegion>,
    key: boolean | string = false,
  ) {
    const f = current.current?.film;
    if (!f) return;
    changeFilm(
      {
        zooms: [
          ...f.zooms.filter((z) => z.id !== r.id),
          {
            ...r,
            ...patch,
            automatic: false,
          },
        ],
        dismissed: r.automatic
          ? [...new Set([...(f.dismissed || []), r.id])]
          : f.dismissed,
      },
      key,
    );
  }
  function patchNote(
    id: string,
    patch: Partial<FilmAnnotation>,
    key: boolean | string = false,
  ) {
    const f = current.current?.film;
    if (f)
      changeFilm(
        {
          annotations: f.annotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        },
        key,
      );
  }
  function removeSelected() {
    if (!film || !selected) return false;
    if (region) {
      changeFilm({
        zooms: film.zooms.filter((z) => z.id !== region.id),
        dismissed: region.automatic
          ? [...new Set([...(film.dismissed || []), region.id])]
          : film.dismissed,
      });
    } else if (cut) {
      changeFilm({ cuts: film.cuts!.filter((c) => c.id !== cut.id) });
      toast("Section restored.");
    } else if (annotation) {
      changeFilm({
        annotations: film.annotations.filter((a) => a.id !== annotation.id),
      });
    } else return false;
    setSelected(null);
    return true;
  }
  function addZoom() {
    if (!film) return;
    const existing = regions.find((r) => r.start <= time && r.end >= time);
    if (existing) {
      select(existing.id, "camera");
      return;
    }
    const id = uid();
    changeFilm({
      zooms: [
        ...film.zooms,
        {
          id,
          start: Math.max(0, time - 0.3),
          end: Math.min(film.duration, time + 2.5),
          scale: settings!.zoom,
          x: 50,
          y: 50,
          automatic: false,
        },
      ],
    });
    select(id, "camera");
  }
  function addText(type: FilmAnnotation["type"] = "text") {
    if (!film) return;
    const id = uid(),
      start = Math.max(0, time - 0.25);
    changeFilm({
      annotations: [
        ...film.annotations,
        type === "text"
          ? {
              id,
              type,
              text: "Your message here",
              start,
              end: Math.min(film.duration, time + 3),
              x: 6,
              y: 80,
              size: 32,
              theme: "light",
            }
          : {
              id,
              type,
              text: "",
              start,
              end: Math.min(film.duration, time + 3),
              x: 35,
              y: 35,
              width: 24,
              height: 14,
            },
      ],
    });
    select(id, "annotations");
  }
  function addCut() {
    if (!film) return;
    const inside = film.cuts?.find((c) => c.start <= time && c.end >= time);
    if (inside) {
      select(inside.id);
      return;
    }
    const id = uid(),
      start = Math.max(film.trimStart, Math.min(time, film.trimEnd - 0.2)),
      end = Math.min(film.trimEnd, start + 1.5);
    changeFilm({ cuts: [...(film.cuts || []), { id, start, end }] });
    select(id);
    toast("Section cut. Drag its edges on the timeline to choose what to remove.");
  }
  function markIn() {
    if (!film) return;
    changeFilm({ trimStart: Math.max(0, Math.min(film.trimEnd - 0.1, time)) });
  }
  function markOut() {
    if (!film) return;
    changeFilm({
      trimEnd: Math.min(film.duration, Math.max(film.trimStart + 0.1, time)),
    });
  }
  // Pressing anywhere that isn't part of editing the selection lets go of it:
  // its handles on the preview, its block on the timeline, the inspector
  // that edits it, and dialogs keep it. The preview picture handles its own
  // click (first click deselects, the next plays).
  useEffect(() => {
    if (!selected) return;
    const keep =
      ".film-overlay > *, .film-preview, .zoom-block, .cut-block, .annotation-track, .audio-track, .webcam-track, .st-properties, .st-header-right, [role=dialog], .st-toast";
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t instanceof Element && !t.closest(keep)) setSelected(null);
    };
    // Capture phase: the timeline stops its pointer events from bubbling.
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [selected]);
  // Sliders, switches, buttons and menus hand the keyboard back to the
  // editor as soon as you finish using them with the mouse, so Space and the
  // arrow keys keep driving playback. Only text fields hold on to typing.
  useEffect(() => {
    const control = (el: Element | null): el is HTMLElement =>
      el instanceof HTMLButtonElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLInputElement && !typing(el));
    const release = () =>
      setTimeout(() => {
        const a = document.activeElement;
        if (control(a) && !a.closest("[role=dialog]")) a.blur();
      });
    const pointer = (e: PointerEvent) => {
      // A native menu is still open after the click that opened it.
      if (!(e.target instanceof HTMLSelectElement)) release();
    };
    window.addEventListener("pointerup", pointer, true);
    window.addEventListener("change", release, true);
    return () => {
      window.removeEventListener("pointerup", pointer, true);
      window.removeEventListener("change", release, true);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!current.current?.film || modal || typing(target)) {
        if (e.key === "Escape") target.blur?.();
        if (
          e.key === "Enter" &&
          target instanceof HTMLInputElement &&
          !modal
        )
          target.blur();
        return;
      }
      // A slider or menu reached with Tab still adjusts with the arrow keys.
      if (
        (target instanceof HTMLSelectElement ||
          (target instanceof HTMLInputElement && target.type === "range")) &&
        /^(Arrow|Page|Home|End)/.test(e.key)
      )
        return;
      const f = current.current.film,
        mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        history(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history("redo");
        return;
      }
      if (mod || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (target !== document.body) target.blur?.();
        togglePlay();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30);
        seek((t) => Math.max(0, Math.min(f.duration, t + d)));
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(f.trimStart);
      } else if (e.key === "End") {
        e.preventDefault();
        setPlaying(false);
        seek(f.trimEnd);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (removeSelected()) e.preventDefault();
      } else if (e.key === "Escape") setSelected(null);
      else {
        const action = {
          i: markIn,
          o: markOut,
          x: addCut,
          z: addZoom,
          t: () => addText(),
          "?": () => setModal("shortcuts"),
        }[e.key.toLowerCase()];
        // Keep the keystroke from also typing into a field that opens.
        if (action) {
          e.preventDefault();
          action();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function importFile(file: File) {
    try {
      const project = await importProject(file);
      const movie = ensureFilm(project);
      await saveProject(movie);
      location.hash = `project/${movie.id}`;
      setModal(null);
      toast("Project opened.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function addVideos(files: File[]) {
    if (!files.length) return;
    try {
      const project = p || newProject(files[0].name.replace(/\.[^.]+$/, "")),
        clips = await addMedia(project, files);
      if (p?.film) {
        const duration =
          p.film.duration + clips.reduce((n, s) => n + s.duration, 0);
        update({
          ...p,
          steps: [...p.steps, ...clips],
          film: { ...p.film, duration, trimEnd: duration },
        });
      } else {
        project.steps = clips;
        const q = ensureFilm(project);
        await saveProject(q);
        location.hash = `project/${q.id}`;
        setModal(null);
      }
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function dropped(files: File[]) {
    const project = files.find((f) => /\.(zip|html)$/i.test(f.name));
    if (project) void importFile(project);
    else
      void addVideos(
        files.filter((f) => /^(video|image)\//.test(f.type)),
      );
  }
  function select(id: string | null, t?: string) {
    setSelected(id);
    if (t) setTab(t);
    if (id) setPlaying(false);
  }
  async function render() {
    if (!p) return;
    setRendering(true);
    setPlaying(false);
    setProgress({ value: 0, fps: 0 });
    setResult(null);
    cancel.current = new AbortController();
    try {
      const r = await exportFilm(p, output, setProgress, cancel.current.signal);
      download(r.blob, filename(p) + "." + r.extension);
      setResult({ elapsed: r.elapsed, duration: r.duration });
      toast(`Video exported in ${r.elapsed.toFixed(1)} seconds.`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRendering(false);
      setProgress(null);
      cancel.current = null;
    }
  }
  async function sample() {
    try {
      const r = await fetch("./example.mp4");
      if (!r.ok)
        throw Error(
          "The example video is unavailable. Import a recording to start.",
        );
      const project = newProject("A calmer place to work"),
        clip = newStep("video");
      clip.assetId = uid();
      clip.title = "Meadow";
      clip.start = 0;
      clip.end = clip.duration = 8;
      clip.width = 1280;
      clip.height = 800;
      await putAsset({
        id: clip.assetId,
        projectId: project.id,
        blob: await r.blob(),
      });
      project.steps = [clip];
      const q = ensureFilm(project),
        f = q.film!;
      f.cursorRecorded = true;
      f.clicks = [
        { id: uid(), t: 1.8, x: 10, y: 23, label: "Projects" },
        { id: uid(), t: 3.4, x: 82, y: 18, label: "New project" },
        { id: uid(), t: 5.2, x: 55, y: 52, label: "Project name" },
      ];
      f.pointer = Array.from({ length: 241 }, (_, i) => {
        const t = i / 30;
        const waypoints = [
          { t: 0, x: 45, y: 60 },
          { t: 1.8, x: 10, y: 23 },
          { t: 3.4, x: 82, y: 18 },
          { t: 5.2, x: 55, y: 52 },
          { t: 8, x: 60, y: 60 },
        ];
        let j = 0;
        while (j < waypoints.length - 2 && waypoints[j + 1].t < t) j++;
        const a = waypoints[j],
          b = waypoints[j + 1],
          v = (t - a.t) / (b.t - a.t),
          e = v * v * (3 - 2 * v);
        return {
          t,
          x: a.x + (b.x - a.x) * e,
          y: a.y + (b.y - a.y) * e,
          kind: "arrow" as const,
        };
      });
      await saveProject(q);
      location.hash = `project/${q.id}`;
      setModal(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function rename(project: Project, title: string) {
    setRenaming(null);
    const name = title.trim();
    if (!name || name === project.title) return;
    await saveProject({ ...project, title: name, updated: Date.now() });
    await refresh();
  }
  const tabs = [
    { id: "camera", name: "Zoom", icon: Focus },
    { id: "cursor", name: "Cursor", icon: MousePointer2 },
    { id: "canvas", name: "Canvas", icon: Palette },
    { id: "annotations", name: "Text", icon: Type },
    { id: "audio", name: "Audio", icon: Volume2 },
    { id: "webcam", name: "Webcam", icon: Camera },
  ];
  const framing =
    !playing && (!!region || !!annotation || selected === "webcam");
  return (
    <div
      className="studio-app"
      onDragOver={(e) => {
        if (p || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDropping(false);
      }}
      onDrop={(e) => {
        if (p) return;
        e.preventDefault();
        setDropping(false);
        dropped([...e.dataTransfer.files]);
      }}
    >
      <input
        hidden
        ref={importRef}
        type="file"
        accept=".zip,.html"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={videoRef}
        type="file"
        accept="video/mp4,video/webm,image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          void addVideos([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={audioRef}
        type="file"
        accept="audio/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && p?.film) {
            const id = uid();
            await putAsset({ id, projectId: p.id, blob: file });
            changeFilm({
              audio: [
                ...(p.film.audio || []),
                {
                  assetId: id,
                  start: time,
                  end: p.film.duration,
                  sourceStart: 0,
                  volume: 1,
                },
              ],
            });
          }
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={webcamRef}
        type="file"
        accept="video/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && p) {
            const id = uid();
            await putAsset({ id, projectId: p.id, blob: file });
            changeFilm({ webcamId: id });
          }
          e.target.value = "";
        }}
      />
      {!p ? (
        <>
          <header className="st-library-header">
            <a href="#" className="st-brand">
              <span>
                <Play size={16} fill="currentColor" />
              </span>
              Open Arcade <small>Studio</small>
            </a>
            <div>
              <span className="st-local">
                <i /> Saved on this device
              </span>
              <button
                className="st-secondary"
                onClick={() => importRef.current?.click()}
              >
                <FolderOpen size={15} /> Open project
              </button>
              <button className="st-primary" onClick={() => setModal("record")}>
                <CircleDot size={15} /> New recording
              </button>
            </div>
          </header>
          <main className="st-library">
            <div className="st-library-title">
              <div>
                <span className="st-eyebrow">Your product, in motion.</span>
                <h1>
                  Make a little screen time
                  <br />
                  <em>worth watching.</em>
                </h1>
                <p>
                  Record a tab, and the editor adds smooth zooms on every click,
                  a big friendly cursor and a beautiful frame. Trim, cut and
                  export an MP4 in minutes.
                </p>
                <div className="st-hero-actions">
                  <button
                    className="st-primary"
                    onClick={() => setModal("record")}
                  >
                    <CircleDot size={15} /> New recording
                  </button>
                  <button
                    className="st-secondary"
                    onClick={() => videoRef.current?.click()}
                  >
                    <Upload size={15} /> Import a video
                  </button>
                </div>
              </div>
              <Showcase onOpen={sample} />
            </div>
            <section className="st-recordings">
              <div className="st-collection-header">
                <div>
                  <h2>
                    Your recordings <small>{projects.length}</small>
                  </h2>
                  <p>Drop a video or project file anywhere on this page.</p>
                </div>
                {projects.length > 3 && (
                  <label className="st-search">
                    <Search size={15} />
                    <input
                      aria-label="Search recordings"
                      placeholder="Search recordings"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="st-project-grid">
                {loading ? (
                  <p>Opening your workspace…</p>
                ) : (
                  projects
                    .filter((v) =>
                      v.title.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((project) => (
                      <article key={project.id} className="st-project">
                        <button
                          className="st-project-open"
                          aria-label={`Open ${project.title}`}
                          onClick={() =>
                            (location.hash = `project/${project.id}`)
                          }
                        >
                          <Thumb project={project} />
                        </button>
                        <div className="st-project-details">
                          {renaming === project.id ? (
                            <input
                              className="st-rename"
                              aria-label="Recording name"
                              autoFocus
                              defaultValue={project.title}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={(e) =>
                                void rename(project, e.currentTarget.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setRenaming(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() =>
                                (location.hash = `project/${project.id}`)
                              }
                              onDoubleClick={() => setRenaming(project.id)}
                            >
                              {project.title}
                            </button>
                          )}
                          <span>
                            {clock(
                              project.film
                                ? outputDuration(project.film)
                                : project.steps.reduce(
                                    (n, s) => n + s.duration,
                                    0,
                                  ),
                            )}{" "}
                            <i /> Edited{" "}
                            {new Date(project.updated).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                            {project.status === "recording" && (
                              <b className="st-badge">Recording</b>
                            )}
                          </span>
                          <div className="st-menu-wrap">
                            <Icon
                              label={`Options for ${project.title}`}
                              onClick={() =>
                                setMenu(menu === project.id ? null : project.id)
                              }
                            >
                              <MoreHorizontal size={18} />
                            </Icon>
                            {menu === project.id && (
                              <div className="st-dropdown" role="menu">
                                <button
                                  role="menuitem"
                                  onClick={() => {
                                    setRenaming(project.id);
                                    setMenu(null);
                                  }}
                                >
                                  <Pencil size={14} /> Rename
                                </button>
                                <button
                                  role="menuitem"
                                  onClick={async () => {
                                    setMenu(null);
                                    await duplicateProject(project);
                                    await refresh();
                                    toast("Recording duplicated.");
                                  }}
                                >
                                  <Copy size={14} /> Duplicate
                                </button>
                                <button
                                  role="menuitem"
                                  className="danger"
                                  onClick={() => {
                                    setModal("delete:" + project.id);
                                    setMenu(null);
                                  }}
                                >
                                  <Trash2 size={14} /> Delete recording
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    ))
                )}
                <button
                  className="st-new-recording"
                  onClick={() => videoRef.current?.click()}
                >
                  <Upload size={22} />
                  <strong>Import a video</strong>
                  <span>MP4, WebM or images · or drop files here</span>
                </button>
              </div>
            </section>
            <div className="st-library-foot">
              <span>
                <Monitor size={15} /> Built for Chrome tabs.
              </span>
              <a
                href="https://github.com/webadderallorg/Recordly"
                target="_blank"
                rel="noreferrer"
              >
                Motion code adapted from Recordly · AGPLv3
              </a>
              <button onClick={sample}>
                Explore an example <ChevronRight size={15} />
              </button>
            </div>
          </main>
          {dropping && (
            <div className="st-drop">
              <Upload size={34} />
              <strong>Drop to import</strong>
              <span>Videos, images or an .arcade.zip project</span>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="st-editor-header">
            <Icon
              label="Back to recordings"
              onClick={() => (location.hash = "")}
            >
              <ArrowLeft size={19} />
            </Icon>
            <input
              className="st-project-name"
              aria-label="Recording title"
              value={p.title}
              onChange={(e) => update({ ...p, title: e.target.value }, "title")}
            />
            <span className="st-save-state">
              {saved ? <Check size={12} /> : <Loader2 size={12} />}{" "}
              {saved ? "Saved on device" : "Saving"}
            </span>
            <div className="st-header-right">
              <Icon label="Keyboard shortcuts" onClick={() => setModal("shortcuts")}>
                <Keyboard size={17} />
              </Icon>
              <Icon
                label="Undo"
                onClick={() => history("undo")}
                disabled={!undo.current.length}
              >
                <Undo2 size={17} />
              </Icon>
              <Icon
                label="Redo"
                onClick={() => history("redo")}
                disabled={!redo.current.length}
              >
                <Redo2 size={17} />
              </Icon>
              <button
                className="st-secondary"
                title="Download an editable backup with the original media"
                onClick={async () => {
                  try {
                    download(await filmArchive(p), filename(p) + ".arcade.zip");
                    toast("Editable project saved to your downloads.");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <FolderOpen size={14} /> Save project
              </button>
              <button
                className="st-primary"
                onClick={() => {
                  setModal("export");
                  setPlaying(false);
                }}
              >
                <Download size={15} /> Export video
              </button>
            </div>
          </header>
          <div className="st-editor-body">
            <main className="st-stage-area">
              <div className="st-preview-wrap">
                {p.steps.length ? (
                  <FilmPreview
                    project={p}
                    media={media}
                    time={time}
                    playing={playing}
                    seekId={seekId}
                    framing={framing}
                    onTime={publishTime}
                    onEnded={() => setPlaying(false)}
                    onToggle={() => {
                      if (selected && !playing) setSelected(null);
                      else togglePlay();
                    }}
                    overlay={(stage) => (
                      <Overlay
                        stage={stage}
                        film={film!}
                        time={time}
                        playing={playing}
                        selected={selected}
                        region={region}
                        onSelect={select}
                        onBegin={() => update(current.current!, true)}
                        onZoom={(r, patch) => patchZoom(r, patch)}
                        onAnnotation={(id, patch) => patchNote(id, patch)}
                        onSettings={(patch) =>
                          changeFilm(
                            {
                              settings: {
                                ...current.current!.film!.settings,
                                ...patch,
                              },
                            },
                            false,
                          )
                        }
                      />
                    )}
                  />
                ) : (
                  <div className="st-empty-film">
                    <Video size={36} />
                    <h2>Bring a recording to life.</h2>
                    <p>Record a Chrome tab or import a video to start.</p>
                    <button
                      className="st-primary"
                      onClick={() => videoRef.current?.click()}
                    >
                      <Upload size={15} /> Import video
                    </button>
                  </div>
                )}
              </div>
              <div className="st-transport">
                <span className="st-clock" title="Position in the finished video">
                  {clock(film ? outputTime(film, time) : 0, true)}{" "}
                  <i>/ {clock(finalLength, true)}</i>
                </span>
                <div>
                  <Icon label="Jump to start" onClick={() => seek(film!.trimStart)}>
                    <SkipBack size={17} fill="currentColor" />
                  </Icon>
                  <button
                    className="st-play"
                    aria-label={playing ? "Pause video" : "Play video"}
                    title="Play / pause (Space)"
                    onClick={togglePlay}
                  >
                    {playing ? (
                      <Pause size={19} fill="currentColor" />
                    ) : (
                      <Play size={19} fill="currentColor" />
                    )}
                  </button>
                  <Icon
                    label="Jump to end"
                    onClick={() => {
                      setPlaying(false);
                      seek(film!.trimEnd);
                    }}
                  >
                    <SkipForward size={17} fill="currentColor" />
                  </Icon>
                </div>
                <div className="st-trim-fields">
                  <label title="Trim start in seconds (I sets it at the playhead)">
                    In
                    <input
                      aria-label="Trim in"
                      type="number"
                      min="0"
                      max={film!.trimEnd - 0.1}
                      step=".1"
                      value={Number(film!.trimStart.toFixed(2))}
                      onChange={(e) => {
                        const t = Math.max(
                          0,
                          Math.min(film!.trimEnd - 0.1, +e.target.value),
                        );
                        changeFilm({ trimStart: t }, "trim-in");
                        seek(t);
                      }}
                    />
                  </label>
                  <label title="Trim end in seconds (O sets it at the playhead)">
                    Out
                    <input
                      aria-label="Trim out"
                      type="number"
                      min={film!.trimStart + 0.1}
                      max={film!.duration}
                      step=".1"
                      value={Number(film!.trimEnd.toFixed(2))}
                      onChange={(e) =>
                        changeFilm(
                          {
                            trimEnd: Math.min(
                              film!.duration,
                              Math.max(film!.trimStart + 0.1, +e.target.value),
                            ),
                          },
                          "trim-out",
                        )
                      }
                    />
                  </label>
                  <label title="Speeds up or slows down the exported video">
                    <Gauge size={14} />
                    <select
                      aria-label="Video speed"
                      value={film!.speed}
                      onChange={(e) => changeFilm({ speed: +e.target.value })}
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <Timeline
                project={p}
                media={media}
                time={time}
                playing={playing}
                onSeek={seek}
                onChange={update}
                onSelect={select}
                selected={selected}
                tools={
                  <div className="tl-tools">
                    <button onClick={addCut} title="Remove a section (X)">
                      <Scissors size={14} /> Cut <Kbd>X</Kbd>
                    </button>
                    <button onClick={addZoom} title="Add a zoom (Z)">
                      <Focus size={14} /> Zoom <Kbd>Z</Kbd>
                    </button>
                    <button onClick={() => addText()} title="Add text (T)">
                      <Type size={14} /> Text <Kbd>T</Kbd>
                    </button>
                    <span className="tl-sep" />
                    <button onClick={markIn} title="Trim the start to the playhead (I)">
                      Set in <Kbd>I</Kbd>
                    </button>
                    <button onClick={markOut} title="Trim the end to the playhead (O)">
                      Set out <Kbd>O</Kbd>
                    </button>
                    <button onClick={() => videoRef.current?.click()} title="Append another video or image">
                      <Plus size={14} /> Add clip
                    </button>
                  </div>
                }
              />
            </main>
            <aside className="st-properties">
              <nav aria-label="Video properties">
                {tabs.map(({ id, name, icon: Icon }) => (
                  <button
                    key={id}
                    className={tab === id ? "selected" : ""}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={17} />
                    <span>{name}</span>
                  </button>
                ))}
              </nav>
              <div className="st-properties-body">
                {cut && (
                  <div className="st-selection-card">
                    <Scissors size={16} />
                    <div>
                      <strong>Cut section</strong>
                      <small>
                        {clock(cut.start, true)} – {clock(cut.end, true)} is
                        removed from the video
                      </small>
                    </div>
                    <button onClick={removeSelected}>
                      <RotateCcw size={13} /> Restore
                    </button>
                  </div>
                )}
                {tab === "camera" && (
                  <>
                    <div className="st-panel-heading">
                      <Focus size={17} />
                      <h2>Zoom</h2>
                    </div>
                    <p className="st-panel-intro">
                      The camera glides in on the action and back out again.
                    </p>
                    <Switch
                      label="Zoom on clicks"
                      checked={settings!.autoZoom}
                      onChange={(v) => changeSetting("autoZoom", v)}
                      hint={
                        film!.clicks.length
                          ? `${film!.clicks.length} recorded click${film!.clicks.length === 1 ? "" : "s"}; nearby ones share one move`
                          : "Needs a recording made with the extension"
                      }
                    />
                    <Range
                      label="Zoom strength"
                      value={settings!.zoom}
                      min={1}
                      max={3}
                      step={0.05}
                      suffix="×"
                      onChange={(v) => changeSetting("zoom", v)}
                    />
                    <Range
                      label="Smoothness"
                      value={settings!.cameraSmoothness}
                      min={0.15}
                      max={1}
                      step={0.05}
                      onChange={(v) => changeSetting("cameraSmoothness", v)}
                    />
                    <div className="st-panel-divider" />
                    <div className="st-section-label">
                      ZOOMS
                      <button onClick={addZoom} aria-label="Add zoom" title="Add a zoom at the playhead (Z)">
                        <Plus size={14} />
                      </button>
                    </div>
                    {regions.length ? (
                      regions.map((r) => (
                        <button
                          className={`st-region-row ${selected === r.id ? "selected" : ""}`}
                          key={r.id}
                          onClick={() => {
                            select(r.id);
                            seek(r.start);
                          }}
                        >
                          <Focus size={14} />
                          <span>
                            {r.automatic ? "Click zoom" : "Zoom"}
                            <small>
                              {clock(r.start, true)} – {clock(r.end, true)}
                            </small>
                          </span>
                          <b>{r.scale.toFixed(1)}×</b>
                        </button>
                      ))
                    ) : (
                      <p className="st-hint">
                        No zooms yet. Press <Kbd>Z</Kbd> or drag across the Zoom
                        lane in the timeline.
                      </p>
                    )}
                    {!!film!.dismissed?.length && settings!.autoZoom && (
                      <button
                        className="st-link"
                        onClick={() =>
                          changeFilm({
                            dismissed: [],
                            zooms: film!.zooms.filter(
                              (z) => !film!.dismissed!.includes(z.id),
                            ),
                          })
                        }
                      >
                        <RotateCcw size={13} /> Reset click zooms
                      </button>
                    )}
                    {region && (
                      <div className="st-region-edit">
                        <h3>Selected zoom</h3>
                        <p className="st-hint">
                          Drag the box on the preview to reframe. Drag a corner
                          to zoom in or out.
                        </p>
                        <Range
                          label="Zoom level"
                          value={region.scale}
                          min={1}
                          max={3}
                          step={0.05}
                          suffix="×"
                          onChange={(v) =>
                            patchZoom(region, { scale: v }, "zoom-scale")
                          }
                        />
                        <div className="st-two">
                          <label>
                            Start
                            <input
                              type="number"
                              step=".1"
                              min={0}
                              max={region.end - 0.1}
                              value={Number(region.start.toFixed(2))}
                              onChange={(e) =>
                                patchZoom(
                                  region,
                                  {
                                    start: Math.max(
                                      0,
                                      Math.min(region.end - 0.1, +e.target.value),
                                    ),
                                  },
                                  "zoom-start",
                                )
                              }
                            />
                          </label>
                          <label>
                            End
                            <input
                              type="number"
                              step=".1"
                              min={region.start + 0.1}
                              max={film!.duration}
                              value={Number(region.end.toFixed(2))}
                              onChange={(e) =>
                                patchZoom(
                                  region,
                                  {
                                    end: Math.min(
                                      film!.duration,
                                      Math.max(region.start + 0.1, +e.target.value),
                                    ),
                                  },
                                  "zoom-end",
                                )
                              }
                            />
                          </label>
                        </div>
                        <button className="st-danger-text" onClick={removeSelected}>
                          <Trash2 size={13} /> Remove zoom
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "cursor" && (
                  <>
                    <div className="st-panel-heading">
                      <MousePointer2 size={17} />
                      <h2>Cursor</h2>
                    </div>
                    <p className="st-panel-intro">
                      A little bigger. A lot more personality.
                    </p>
                    {film!.cursorEmbedded ? (
                      <p className="st-hint">
                        This older recording already contains its cursor. It is
                        shown once. Record a new clip to use the large,
                        separately animated cursor.
                      </p>
                    ) : !film!.pointer.length ? (
                      <p className="st-hint">
                        This video has no recorded cursor movement, so there is
                        no cursor to style. Recordings made with the Open Arcade
                        extension capture it automatically.
                      </p>
                    ) : (
                      <>
                        <div className="st-cursor-styles">
                          {(["arrow", "dot", "native"] as const).map((v) => (
                            <button
                              className={
                                settings!.cursorStyle === v ? "selected" : ""
                              }
                              key={v}
                              onClick={() => changeSetting("cursorStyle", v)}
                            >
                              {v === "arrow" ? (
                                <MousePointer2
                                  size={28}
                                  fill={settings!.cursorColor}
                                />
                              ) : v === "dot" ? (
                                <span className="st-cursor-dot" />
                              ) : (
                                <X size={18} />
                              )}
                              <span>
                                {v === "arrow"
                                  ? "Arrow"
                                  : v === "dot"
                                    ? "Dot"
                                    : "Hidden"}
                              </span>
                            </button>
                          ))}
                        </div>
                        {settings!.cursorStyle !== "native" && (
                          <>
                            <Range
                              label="Cursor size"
                              min={24}
                              max={120}
                              value={settings!.cursorSize}
                              suffix=" px"
                              onChange={(v) => changeSetting("cursorSize", v)}
                            />
                            <Range
                              label="Cursor smoothing"
                              min={0}
                              max={1}
                              step={0.05}
                              value={settings!.cursorSmoothing}
                              onChange={(v) =>
                                changeSetting("cursorSmoothing", v)
                              }
                            />
                            <label className="st-color-label">
                              Cursor color
                              <input
                                aria-label="Cursor color"
                                type="color"
                                value={settings!.cursorColor}
                                onChange={(e) =>
                                  changeSetting("cursorColor", e.target.value)
                                }
                              />
                            </label>
                            <Switch
                              label="Gentle cursor tilt"
                              checked={settings!.cursorTilt}
                              onChange={(v) => changeSetting("cursorTilt", v)}
                            />
                            <Switch
                              label="Click ripple"
                              checked={settings!.clickEffect}
                              onChange={(v) => changeSetting("clickEffect", v)}
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {tab === "canvas" && (
                  <>
                    <div className="st-panel-heading">
                      <Palette size={17} />
                      <h2>Canvas</h2>
                    </div>
                    <p className="st-panel-intro">
                      Give your recording a little room to shine.
                    </p>
                    <div className="st-backgrounds">
                      {Object.entries(backgrounds).map(([id, b]) => (
                        <button
                          key={id}
                          aria-label={`${b.name} background`}
                          className={
                            settings!.background === id ? "selected" : ""
                          }
                          onClick={() => changeSetting("background", id)}
                          style={{
                            background: `linear-gradient(135deg,${b.colors.join(",")})`,
                          }}
                        >
                          <span>{b.name}</span>
                        </button>
                      ))}
                    </div>
                    <label className="st-color-label">
                      Custom color
                      <input
                        type="color"
                        aria-label="Custom background color"
                        value={
                          settings!.background.startsWith("#")
                            ? settings!.background
                            : "#b9d2bd"
                        }
                        onChange={(e) =>
                          changeSetting("background", e.target.value)
                        }
                      />
                    </label>
                    <div className="st-section-label">ASPECT RATIO</div>
                    <div className="st-aspects">
                      {(["native", "16:9", "1:1", "9:16"] as const).map((v) => (
                        <button
                          className={settings!.aspect === v ? "selected" : ""}
                          key={v}
                          onClick={() => changeSetting("aspect", v)}
                        >
                          {v === "native" ? "Auto" : v}
                        </button>
                      ))}
                    </div>
                    <Range
                      label="Padding"
                      value={settings!.padding}
                      min={0}
                      max={160}
                      suffix=" px"
                      onChange={(v) => changeSetting("padding", v)}
                    />
                    <Range
                      label="Corner radius"
                      value={settings!.radius}
                      min={0}
                      max={48}
                      suffix=" px"
                      onChange={(v) => changeSetting("radius", v)}
                    />
                    <Range
                      label="Shadow"
                      value={settings!.shadow}
                      min={0}
                      max={80}
                      onChange={(v) => changeSetting("shadow", v)}
                    />
                  </>
                )}
                {tab === "audio" && (
                  <>
                    <div className="st-panel-heading">
                      <Volume2 size={17} />
                      <h2>Audio</h2>
                    </div>
                    <p className="st-panel-intro">
                      Keep your sound in step with the story.
                    </p>
                    {film!.hasSystemAudio && (
                      <Range
                        label="Tab audio volume"
                        value={settings!.systemVolume}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(v) => changeSetting("systemVolume", v)}
                      />
                    )}
                    {film!.micId && (
                      <>
                        <Range
                          label="Microphone volume"
                          value={settings!.micVolume}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(v) => changeSetting("micVolume", v)}
                        />
                        <button
                          className="st-danger-text"
                          onClick={() => changeFilm({ micId: undefined })}
                        >
                          <Trash2 size={13} /> Remove microphone track
                        </button>
                      </>
                    )}
                    {!film!.hasSystemAudio && !film!.micId && (
                      <p className="st-hint">
                        This recording has no sound of its own. Add music or a
                        voiceover below.
                      </p>
                    )}
                    <button
                      className="st-full"
                      onClick={() => audioRef.current?.click()}
                    >
                      <Upload size={14} /> Add music or voiceover
                    </button>
                    <p className="st-hint">
                      Added audio starts at the playhead and runs to the end.
                    </p>
                    {film!.audio?.map((a, i) => (
                      <div className="st-audio-layer" key={a.assetId}>
                        <div>
                          Audio {i + 1}
                          <Icon
                            label={`Remove audio ${i + 1}`}
                            onClick={() =>
                              changeFilm({
                                audio: film!.audio!.filter(
                                  (v) => v.assetId !== a.assetId,
                                ),
                              })
                            }
                          >
                            <X size={13} />
                          </Icon>
                        </div>
                        <div className="st-two">
                          <label>
                            Start
                            <input
                              type="number"
                              min="0"
                              max={a.end - 0.1}
                              value={a.start}
                              step=".1"
                              onChange={(e) =>
                                changeFilm(
                                  {
                                    audio: film!.audio!.map((v) =>
                                      v.assetId === a.assetId
                                        ? {
                                            ...v,
                                            start: Math.max(
                                              0,
                                              Math.min(a.end - 0.1, +e.target.value),
                                            ),
                                          }
                                        : v,
                                    ),
                                  },
                                  `audio-start-${i}`,
                                )
                              }
                            />
                          </label>
                          <label>
                            End
                            <input
                              type="number"
                              min={a.start + 0.1}
                              max={film!.duration}
                              step=".1"
                              value={a.end}
                              onChange={(e) =>
                                changeFilm(
                                  {
                                    audio: film!.audio!.map((v) =>
                                      v.assetId === a.assetId
                                        ? {
                                            ...v,
                                            end: Math.min(
                                              film!.duration,
                                              Math.max(a.start + 0.1, +e.target.value),
                                            ),
                                          }
                                        : v,
                                    ),
                                  },
                                  `audio-end-${i}`,
                                )
                              }
                            />
                          </label>
                        </div>
                        <Range
                          label={`Audio ${i + 1} volume`}
                          value={a.volume}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(v) =>
                            changeFilm(
                              {
                                audio: film!.audio!.map((layer) =>
                                  layer.assetId === a.assetId
                                    ? { ...layer, volume: v }
                                    : layer,
                                ),
                              },
                              `audio-volume-${i}`,
                            )
                          }
                        />
                      </div>
                    ))}
                  </>
                )}
                {tab === "webcam" && (
                  <>
                    <div className="st-panel-heading">
                      <Camera size={17} />
                      <h2>Webcam</h2>
                    </div>
                    <p className="st-panel-intro">
                      Put a face to your recording.
                    </p>
                    {!film!.webcamId ? (
                      <>
                        <button
                          className="st-full"
                          onClick={() => webcamRef.current?.click()}
                        >
                          <Upload size={14} /> Add webcam video
                        </button>
                        <p className="st-hint">
                          Or turn on “Webcam” in the extension before you
                          record.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="st-hint">
                          Drag the bubble on the preview to move it. Drag its
                          corner to resize.
                        </p>
                        <div className="st-section-label">POSITION</div>
                        <div className="st-corners">
                          {(
                            [
                              ["Top left", 12, 16],
                              ["Top right", 88, 16],
                              ["Bottom left", 12, 84],
                              ["Bottom right", 88, 84],
                            ] as const
                          ).map(([name, x, y]) => (
                            <button
                              key={name}
                              aria-label={name}
                              className={
                                Math.abs(settings!.webcamX - x) < 1 &&
                                Math.abs(settings!.webcamY - y) < 1
                                  ? "selected"
                                  : ""
                              }
                              onClick={() =>
                                changeFilm({
                                  settings: {
                                    ...settings!,
                                    webcamX: x,
                                    webcamY: y,
                                  },
                                })
                              }
                            >
                              <i style={{ left: `${x * 0.7}%`, top: `${y * 0.6}%` }} />
                            </button>
                          ))}
                        </div>
                        <Range
                          label="Webcam size"
                          value={settings!.webcamSize}
                          min={8}
                          max={40}
                          suffix="%"
                          onChange={(v) => changeSetting("webcamSize", v)}
                        />
                        <div className="st-aspects">
                          {(["circle", "rounded"] as const).map((v) => (
                            <button
                              className={
                                settings!.webcamShape === v ? "selected" : ""
                              }
                              key={v}
                              onClick={() => changeSetting("webcamShape", v)}
                            >
                              {v === "circle" ? "Circle" : "Rounded"}
                            </button>
                          ))}
                        </div>
                        <button
                          className="st-danger-text"
                          onClick={() => changeFilm({ webcamId: undefined })}
                        >
                          <Trash2 size={14} /> Remove webcam
                        </button>
                      </>
                    )}
                  </>
                )}
                {tab === "annotations" && (
                  <>
                    <div className="st-panel-heading">
                      <Type size={17} />
                      <h2>Text &amp; covers</h2>
                    </div>
                    <p className="st-panel-intro">
                      Add captions, or hide private details.
                    </p>
                    <div className="st-two">
                      <button className="st-full" onClick={() => addText()}>
                        <Plus size={14} /> Add text
                      </button>
                      <button
                        className="st-full"
                        aria-label="Add privacy cover"
                        onClick={() => addText("cover")}
                      >
                        <Plus size={14} /> Add cover
                      </button>
                    </div>
                    {film!.annotations.map((a) => (
                      <button
                        key={a.id}
                        className={`st-region-row ${a.id === selected ? "selected" : ""}`}
                        onClick={() => {
                          select(a.id);
                          seek(Math.min(a.start + 0.25, (a.start + a.end) / 2));
                        }}
                      >
                        <Type size={14} />
                        <span>
                          {a.type === "cover" ? "Privacy cover" : a.text || "Empty text"}
                          <small>
                            {clock(a.start, true)} – {clock(a.end, true)}
                          </small>
                        </span>
                      </button>
                    ))}
                    {annotation && (
                      <div className="st-region-edit">
                        <h3>
                          {annotation.type === "cover"
                            ? "Selected cover"
                            : "Selected text"}
                        </h3>
                        {annotation.type === "text" ? (
                          <>
                            <label>
                              Text
                              <textarea
                                aria-label="Annotation text"
                                autoFocus
                                value={annotation.text}
                                onFocus={(e) => {
                                  if (annotation.text === "Your message here")
                                    e.currentTarget.select();
                                }}
                                onChange={(e) =>
                                  patchNote(
                                    annotation.id,
                                    { text: e.target.value },
                                    `text-${annotation.id}`,
                                  )
                                }
                              />
                            </label>
                            <Range
                              label="Text size"
                              value={annotation.size ?? 32}
                              min={16}
                              max={96}
                              suffix=" px"
                              onChange={(v) =>
                                patchNote(annotation.id, { size: v }, "text-size")
                              }
                            />
                            <div className="st-aspects">
                              {(["light", "dark", "accent"] as const).map((v) => (
                                <button
                                  key={v}
                                  className={
                                    (annotation.theme || "light") === v
                                      ? "selected"
                                      : ""
                                  }
                                  onClick={() =>
                                    patchNote(annotation.id, { theme: v }, true)
                                  }
                                >
                                  {v[0].toUpperCase() + v.slice(1)}
                                </button>
                              ))}
                            </div>
                            <p className="st-hint">Drag the text on the preview to place it.</p>
                          </>
                        ) : (
                          <p className="st-hint">
                            Drag the cover on the preview to move it; drag its
                            corner to resize. Covers are baked into exported
                            videos.
                          </p>
                        )}
                        <div className="st-two">
                          <label>
                            Start
                            <input
                              type="number"
                              step=".1"
                              min="0"
                              max={annotation.end - 0.1}
                              value={Number(annotation.start.toFixed(2))}
                              onChange={(e) =>
                                patchNote(
                                  annotation.id,
                                  {
                                    start: Math.max(
                                      0,
                                      Math.min(annotation.end - 0.1, +e.target.value),
                                    ),
                                  },
                                  "note-start",
                                )
                              }
                            />
                          </label>
                          <label>
                            End
                            <input
                              type="number"
                              step=".1"
                              min={annotation.start + 0.1}
                              max={film!.duration}
                              value={Number(annotation.end.toFixed(2))}
                              onChange={(e) =>
                                patchNote(
                                  annotation.id,
                                  {
                                    end: Math.min(
                                      film!.duration,
                                      Math.max(annotation.start + 0.1, +e.target.value),
                                    ),
                                  },
                                  "note-end",
                                )
                              }
                            />
                          </label>
                        </div>
                        <button className="st-danger-text" onClick={removeSelected}>
                          <Trash2 size={14} /> Remove{" "}
                          {annotation.type === "cover" ? "cover" : "text"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      {modal === "record" && (
        <Dialog title="New recording" onClose={() => setModal(null)}>
          <div className="st-record-help">
            <ol className="st-steps">
              <li>
                <b>1</b>
                <div>
                  <strong>Open the page you want to show</strong>
                  <span>Any regular website tab in Chrome.</span>
                </div>
              </li>
              <li>
                <b>2</b>
                <div>
                  <strong>
                    Click Open Arcade in the toolbar, or press{" "}
                    <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>R</Kbd>
                  </strong>
                  <span>
                    Pin it from Chrome’s puzzle-piece menu so it’s one click
                    away. Choose tab audio, microphone or webcam there.
                  </span>
                </div>
              </li>
              <li>
                <b>3</b>
                <div>
                  <strong>Count down, then just use the site</strong>
                  <span>
                    A small control window lets you pause, finish or discard.
                    When you finish, the recording opens here with zooms already
                    on every click.
                  </span>
                </div>
              </li>
            </ol>
            {!extension && (
              <p className="st-install">
                You’re viewing the studio outside the extension. To record,
                build it and load <code>dist</code> at{" "}
                <code>chrome://extensions</code> → Developer mode → Load
                unpacked.
              </p>
            )}
            <div className="st-dialog-actions">
              <button
                className="st-secondary"
                onClick={() => videoRef.current?.click()}
              >
                <Upload size={15} /> Import a video instead
              </button>
              <button className="st-primary" onClick={sample}>
                Try the example <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {modal === "shortcuts" && (
        <Dialog title="Keyboard shortcuts" onClose={() => setModal(null)}>
          <dl className="st-shortcuts">
            {shortcuts.map(([k, v]) => (
              <div key={k}>
                <dt>
                  {k.split(" / ").map((part, i) => (
                    <span key={part}>
                      {i > 0 && " / "}
                      <Kbd>{part}</Kbd>
                    </span>
                  ))}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
      {modal === "export" && p && (
        <Dialog
          title="Export your video"
          onClose={() => {
            if (!rendering) setModal(null);
          }}
        >
          <p className="st-export-intro">
            {clock(finalLength, true)} long · exactly what you see in the
            preview, rendered frame by frame on this device.
          </p>
          <div className="st-export-format">
            {(["mp4", "gif"] as const).map((v) => (
              <button
                className={output.format === v ? "selected" : ""}
                disabled={rendering}
                key={v}
                onClick={() =>
                  setOutput({
                    ...output,
                    format: v,
                    width: v === "gif" ? 640 : 1920,
                    fps: v === "gif" ? 20 : 60,
                  })
                }
              >
                <Film size={20} />
                <strong>{v.toUpperCase()}</strong>
                <small>
                  {v === "mp4" ? "Video with audio" : "Silent looping animation"}
                </small>
              </button>
            ))}
          </div>
          <div className="st-two">
            <label>
              Resolution
              <select
                aria-label="Export resolution"
                disabled={rendering}
                value={output.width}
                onChange={(e) =>
                  setOutput({ ...output, width: +e.target.value })
                }
              >
                {(output.format === "gif"
                  ? [480, 640, 960, 1280]
                  : [1280, 1920, 2560, 3840]
                ).map((v) => (
                  <option key={v} value={v}>
                    {{ 1280: "720p", 1920: "1080p", 2560: "1440p", 3840: "4K" }[v] ??
                      `${v} px`}{" "}
                    · {v} wide
                  </option>
                ))}
              </select>
            </label>
            <label>
              Frame rate
              <select
                aria-label="Export frame rate"
                disabled={rendering}
                value={output.fps}
                onChange={(e) => setOutput({ ...output, fps: +e.target.value })}
              >
                {(output.format === "gif" ? [10, 20, 25] : [30, 60]).map((v) => (
                  <option key={v} value={v}>
                    {v} fps
                    {output.format === "gif" && v === 10 ? " · smallest file" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {output.format === "mp4" && (
            <label>
              Quality
              <select
                aria-label="Export quality"
                disabled={rendering}
                value={output.quality}
                onChange={(e) =>
                  setOutput({ ...output, quality: +e.target.value })
                }
              >
                <option value="4000000">Balanced · smaller file</option>
                <option value="8000000">High · recommended</option>
                <option value="16000000">Maximum detail</option>
              </select>
            </label>
          )}
          {progress && (
            <div className="st-render-progress">
              <div>
                <Loader2 size={16} />
                <strong>Rendering {Math.round(progress.value * 100)}%</strong>
                <span>
                  {progress.fps > 0 ? `${Math.round(progress.fps)} fps` : ""}
                </span>
              </div>
              <progress max="1" value={progress.value} />
              <button
                className="st-link"
                onClick={() => cancel.current?.abort()}
              >
                Cancel export
              </button>
            </div>
          )}
          {result && (
            <div className="st-export-result">
              <Check size={18} />
              <div>
                Ready in {result.elapsed.toFixed(1)} seconds
                <small>
                  {(result.duration / result.elapsed).toFixed(1)}× playback
                  speed · Saved to downloads
                </small>
              </div>
            </div>
          )}
          <button
            className="st-primary st-export-submit"
            disabled={rendering || !p.steps.length || finalLength <= 0}
            onClick={render}
          >
            {rendering ? <Loader2 size={16} /> : <Download size={16} />}{" "}
            {rendering ? "Rendering…" : `Export ${output.format.toUpperCase()}`}
          </button>
        </Dialog>
      )}
      {modal?.startsWith("delete:") && (
        <Dialog title="Delete this recording?" onClose={() => setModal(null)}>
          <p className="st-panel-intro">
            This removes the recording and its original media from this device.
            It can’t be undone.
          </p>
          <div className="st-dialog-actions">
            <button className="st-secondary" onClick={() => setModal(null)}>
              Keep recording
            </button>
            <button
              className="st-danger"
              onClick={async () => {
                await deleteProject(modal.slice(7));
                await refresh();
                setModal(null);
                toast("Recording deleted.");
              }}
            >
              Delete recording
            </button>
          </div>
        </Dialog>
      )}
      {p?.status === "recording" && (
        <div className="st-recover">
          <span>This recording is still in progress or was interrupted.</span>
          <button
            onClick={async () => {
              if (extension) {
                const s = await chrome.runtime.sendMessage({
                  target: "background",
                  type: "state",
                });
                if (s?.projectId === p.id) {
                  toast("Finish recording from the extension first.");
                  return;
                }
              }
              const stored = (await getProject(p.id)) || structuredClone(p);
              const q = ensureFilm(
                stored.status === "recording"
                  ? await recoverProject(stored)
                  : stored,
              );
              setP(q);
              seek(q.film!.trimStart);
              toast("Saved recording recovered.");
            }}
          >
            Recover saved media
          </button>
        </div>
      )}
      {notice && (
        <div className="st-toast" role="status">
          <Check size={16} />
          {notice}
          <Icon label="Dismiss notification" onClick={() => setNotice("")}>
            <X size={14} />
          </Icon>
        </div>
      )}
    </div>
  );
}
