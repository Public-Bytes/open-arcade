import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Plus,
  Search,
  LayoutGrid,
  FolderOpen,
  BookOpen,
  ArrowLeft,
  ChevronRight,
  Play,
  MoreHorizontal,
  Upload,
  Download,
  MousePointer2,
  Target,
  ScanLine,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  GripVertical,
  X,
  Check,
  Film,
  Image as ImageIcon,
  Type,
  Settings2,
  Monitor,
  HardDrive,
  ExternalLink,
  Mic,
  Square,
  ArrowUp,
  ArrowDown,
  Loader2,
  Keyboard,
  ShieldCheck,
  Globe,
  SlidersHorizontal,
} from "lucide-react";
import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  duplicateProject,
  getAsset,
  putAsset,
  recoverProject,
} from "./lib/db";
import {
  newProject,
  newStep,
  uid,
  referencedAssets,
  type Project,
  type Step,
  type Hotspot,
} from "./lib/model";
import { addMedia, redactImage } from "./lib/media";
import { createSample } from "./lib/sample";
import {
  download,
  filename,
  portableHTML,
  exportProject,
  importProject,
  exportGuide,
} from "./lib/export";
import { renderSequence } from "./lib/render";
import { Player } from "./components/Player";
import { repairStoredCapture } from "./lib/capture-media";
const isExtension = !!globalThis.chrome?.runtime?.id;
let saveQueue = Promise.resolve();
const commit = (p: Project) => {
  saveQueue = saveQueue.catch(() => {}).then(() => saveProject(p));
  return saveQueue;
};
const date = (n: number) =>
  new Date(n).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo">
      <span className="brand-mark">
        <Play size={19} fill="currentColor" />
      </span>
      {!compact && (
        <span>
          open<span className="logo-light">arcade</span>
          <sup>↗</sup>
        </span>
      )}
    </div>
  );
}
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    closeRef.current();
  };
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const controls = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex='0']",
          ) ?? []),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="Close" onClick={close}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
function useMedia(p: Project | null) {
  const [media, set] = useState<Record<string, string>>({});
  const key = p ? referencedAssets(p).join(",") : "";
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      const data: Record<string, string> = {};
      for (const id of key.split(",").filter(Boolean)) {
        const a = await getAsset(id);
        if (a) {
          const u = URL.createObjectURL(a.blob);
          urls.push(u);
          data[id] = u;
        }
      }
      if (alive) set(data);
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return media;
}
function Thumbnail({ project }: { project: Project }) {
  const s =
    project.steps.find((s) => s.type === "image") ||
    project.steps.find((s) => s.posterId);
  const thumbnailId = s?.type === "image" ? s.assetId : s?.posterId;
  const [src, set] = useState("");
  useEffect(() => {
    let u = "",
      live = true;
    if (thumbnailId)
      void getAsset(thumbnailId).then((a) => {
        if (a) {
          u = URL.createObjectURL(a.blob);
          if (live) set(u);
        }
      });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [thumbnailId]);
  return (
    <div className="thumbnail" style={{ background: project.background }}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <div className="thumbnail-empty">
          <Play size={30} />
          <span>Your next great story</span>
        </div>
      )}
      <span className="thumb-play">
        <Play size={16} fill="currentColor" />
      </span>
    </div>
  );
}
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [section, setSection] = useState("All demos"),
    [modal, setModal] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [selected, setSelected] = useState(0),
    [tool, setTool] = useState<"pointer" | "hotspot" | "redact">("pointer"),
    [hotspotId, setHotspotId] = useState<string | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [saved, setSaved] = useState(true),
    [progress, setProgress] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [embedURL, setEmbedURL] = useState("https://your-site.com/demo.html");
  const saveVersion = useRef(0),
    latestProject = useRef<Project | null>(null);
  latestProject.current = project;
  const undo = useRef<Project[]>([]),
    redo = useRef<Project[]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    archiveInput = useRef<HTMLInputElement>(null),
    narrationInput = useRef<HTMLInputElement>(null),
    replaceInput = useRef<HTMLInputElement>(null),
    stage = useRef<HTMLDivElement>(null),
    dragStart = useRef<{ x: number; y: number } | null>(null),
    exportAbort = useRef<AbortController | null>(null),
    audioRecorder = useRef<MediaRecorder | null>(null),
    [recordingAudio, setRecordingAudio] = useState(false),
    [rect, setRect] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null);
  const media = useMedia(project),
    step = project?.steps[selected],
    hotspot = step?.hotspots.find((h) => h.id === hotspotId);
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(
    () => () => {
      if (audioRecorder.current?.state === "recording")
        audioRecorder.current.stop();
    },
    [project?.id, selected],
  );
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);
  const open = useCallback(async (id: string) => {
    const stored = await getProject(id);
    if (stored) {
      const p = await repairStoredCapture(stored);
      setProject(p);
      setSelected(0);
      undo.current = [];
      redo.current = [];
    }
  }, []);
  useEffect(() => {
    void refresh().then(() => setLoading(false));
    const route = () => {
      const id = location.hash.match(/^#project\/(.+)$/)?.[1];
      if (id) void open(id);
      else {
        setProject(null);
        void refresh();
      }
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, [refresh, open]);
  function edit(next: Project, history = true) {
    if (project?.status === "recording") {
      notify("Finish or recover this recording before editing.");
      return;
    }
    if (project && history) {
      undo.current.push(structuredClone(project));
      undo.current = undo.current.slice(-60);
      redo.current = [];
    }
    const p = { ...next, updated: Date.now() };
    setProject(p);
    setSaved(false);
    const version = ++saveVersion.current;
    void commit(p)
      .then(() => {
        if (saveVersion.current === version) setSaved(true);
      })
      .catch((e) =>
        notify(`Could not save: ${e.message}. Export a project backup.`),
      );
  }
  function patchStep(patch: Partial<Step>) {
    if (project && step)
      edit({
        ...project,
        steps: project.steps.map((s) =>
          s.id === step.id ? { ...s, ...patch } : s,
        ),
      });
  }
  function patchHotspot(patch: Partial<Hotspot>) {
    if (step && hotspot)
      patchStep({
        hotspots: step.hotspots.map((h) =>
          h.id === hotspot.id ? { ...h, ...patch } : h,
        ),
      });
  }
  function travel(direction: "undo" | "redo") {
    if (!project) return;
    const from = direction === "undo" ? undo.current : redo.current,
      to = direction === "undo" ? redo.current : undo.current;
    const p = from.pop();
    if (p) {
      to.push(project);
      edit(p, false);
      setSelected((i) => Math.min(i, Math.max(0, p.steps.length - 1)));
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!project && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search demos"]')
          ?.focus();
        return;
      }
      if (
        !project ||
        modal ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        travel(e.shiftKey ? "redo" : "undo");
      }
      if (e.key === "ArrowDown")
        setSelected((i) => Math.min(i + 1, project.steps.length - 1));
      if (e.key === "ArrowUp") setSelected((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function create() {
    const p = newProject();
    await saveProject(p);
    location.hash = `project/${p.id}`;
    setModal(null);
  }
  async function sample() {
    setBusy(true);
    try {
      const p = await createSample();
      location.hash = `project/${p.id}`;
      setModal(null);
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: File[], replace = false) {
    if (!project || !files.length) return;
    try {
      const steps = await addMedia(project, files);
      if (replace && step && steps[0])
        patchStep({
          ...steps[0],
          id: step.id,
          title: step.title,
          body: step.body,
          hotspots: step.hotspots,
        });
      else {
        edit({ ...project, steps: [...project.steps, ...steps] });
        setSelected(project.steps.length);
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function addChapter() {
    if (!project) return;
    const s = newStep();
    edit({
      ...project,
      steps: [
        ...project.steps.slice(0, selected + 1),
        s,
        ...project.steps.slice(selected + 1),
      ],
    });
    setSelected(Math.min(selected + 1, project.steps.length));
  }
  function moveStep(from: number, to: number) {
    if (!project || to < 0 || to >= project.steps.length) return;
    const steps = [...project.steps];
    steps.splice(to, 0, steps.splice(from, 1)[0]);
    edit({ ...project, steps });
    setSelected(to);
  }
  async function exportAs(format: string) {
    if (!project) return;
    setBusy(true);
    try {
      if (format === "html")
        download(
          new Blob([await portableHTML(project)], { type: "text/html" }),
          filename(project) + ".html",
        );
      if (format === "project")
        download(
          await exportProject(project),
          filename(project) + ".arcade.zip",
        );
      if (format === "guide")
        download(await exportGuide(project), filename(project) + "-guide.html");
      if (format === "video" || format === "gif") {
        setProgress(0);
        exportAbort.current = new AbortController();
        const result = await renderSequence(
          project,
          format,
          setProgress,
          exportAbort.current.signal,
        );
        download(result.blob, filename(project) + "." + result.extension);
      }
      notify("Export ready. Saved to your downloads.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
      exportAbort.current = null;
    }
  }
  async function narrate() {
    if (!project || !step) return;
    if (recordingAudio) {
      audioRecorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream),
        chunks: Blob[] = [];
      audioRecorder.current = recorder;
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecordingAudio(false);
        const id = uid(),
          projectId = project.id,
          stepId = step.id;
        void putAsset({
          id,
          projectId,
          blob: new Blob(chunks, { type: recorder.mimeType }),
        })
          .then(async () => {
            const current = latestProject.current;
            if (current?.id === projectId)
              edit({
                ...current,
                steps: current.steps.map((s) =>
                  s.id === stepId ? { ...s, narrationId: id } : s,
                ),
              });
            else {
              const stored = await getProject(projectId);
              if (stored)
                await commit({
                  ...stored,
                  updated: Date.now(),
                  steps: stored.steps.map((s) =>
                    s.id === stepId ? { ...s, narrationId: id } : s,
                  ),
                });
            }
          })
          .catch((e) => notify(`Could not save narration: ${e.message}`));
      };
      recorder.start();
      setRecordingAudio(true);
    } catch {
      notify(
        "Microphone access is unavailable. You can upload an audio file instead.",
      );
    }
  }
  async function redact() {
    if (!project || !step?.assetId || !rect) return;
    if (step.type === "video") {
      patchStep({
        redactions: [
          ...(step.redactions || []),
          {
            x: (rect.x - step.focus.x) / step.zoom + step.focus.x,
            y: (rect.y - step.focus.y) / step.zoom + step.focus.y,
            width: rect.width / step.zoom,
            height: rect.height / step.zoom,
          },
        ],
      });
      setRect(null);
      setTool("pointer");
      notify(
        "Redaction applied to the clip. Exported video will contain the solid cover.",
      );
      return;
    }
    const a = await getAsset(step.assetId);
    if (!a) return;
    try {
      const id = uid();
      await putAsset({
        id,
        projectId: project.id,
        blob: await redactImage(a.blob, {
          x: (rect.x - step.focus.x) / step.zoom + step.focus.x,
          y: (rect.y - step.focus.y) / step.zoom + step.focus.y,
          width: rect.width / step.zoom,
          height: rect.height / step.zoom,
        }),
      });
      patchStep({ assetId: id });
      setRect(null);
      setTool("pointer");
      notify(
        "Redaction applied to the image. Exported media contains the solid cover.",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const settings = (
    <>
      <label>
        Demo title
        <input
          value={project?.title || ""}
          onChange={(e) =>
            project && edit({ ...project, title: e.target.value })
          }
        />
      </label>
      <label>
        Description
        <textarea
          value={project?.description || ""}
          onChange={(e) =>
            project && edit({ ...project, description: e.target.value })
          }
        />
      </label>
      <div className="two-col">
        <label>
          Accent color
          <input
            type="color"
            value={project?.accent}
            onChange={(e) =>
              project && edit({ ...project, accent: e.target.value })
            }
          />
        </label>
        <label>
          Background
          <input
            type="color"
            value={project?.background}
            onChange={(e) =>
              project && edit({ ...project, background: e.target.value })
            }
          />
        </label>
      </div>
      <label>
        Personalization variables
        <textarea
          key={project?.id}
          defaultValue={Object.entries(project?.variables || {})
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")}
          placeholder={"company=Acme\nname=Alex"}
          onBlur={(e) => {
            if (project)
              edit({
                ...project,
                variables: Object.fromEntries(
                  e.target.value
                    .split("\n")
                    .filter((l) => l.includes("="))
                    .map((l) => {
                      const i = l.indexOf("=");
                      return [l.slice(0, i).trim(), l.slice(i + 1)];
                    }),
                ),
              });
          }}
        />
      </label>
      <p className="hint">
        Use {"{{company}}"} or {"{{name}}"} in titles, captions, and hotspot
        labels.
      </p>
    </>
  );
  return (
    <>
      <input
        ref={archiveInput}
        type="file"
        accept=".zip,.html"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const p = await importProject(f);
            location.hash = `project/${p.id}`;
            notify("Project imported. Ready to make it yours.");
          } catch (err) {
            notify((err as Error).message);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4"
        multiple
        hidden
        onChange={(e) => {
          void upload(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4"
        hidden
        onChange={(e) => {
          void upload(Array.from(e.target.files || []), true);
          e.target.value = "";
        }}
      />
      <input
        ref={narrationInput}
        type="file"
        accept="audio/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f && project) {
            const id = uid();
            await putAsset({ id, projectId: project.id, blob: f });
            patchStep({ narrationId: id });
          }
          e.target.value = "";
        }}
      />
      {!project ? (
        <div className="dashboard">
          <aside className="sidebar">
            <Logo />
            <div className="workspace-switch">
              <span className="workspace-icon">Y</span>
              <div>
                Your workspace<small>Personal · Local</small>
              </div>
              <span className="local-dot" />
            </div>
            <button
              aria-label="New demo"
              className="new-button"
              onClick={() => setModal("new")}
            >
              <Plus size={17} /> New demo <span>↗</span>
            </button>
            <div className="nav-label">WORKSPACE</div>
            <nav>
              {[
                { name: "All demos", icon: LayoutGrid },
                { name: "Drafts", icon: FolderOpen },
                { name: "Getting started", icon: BookOpen },
              ].map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  className={section === name ? "active" : ""}
                  onClick={() => setSection(name)}
                >
                  <Icon size={18} />
                  {name}
                  {name === "All demos" && <span>{projects.length}</span>}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="local-note">
                <ShieldCheck size={21} />
                <strong>Yours. All yours.</strong>
                <p>
                  Your demos live on your device.
                  <br />
                  No cloud. No limits. No catch.
                </p>
              </div>
              <button
                className="sidebar-link"
                onClick={() => setModal("about")}
              >
                <HardDrive size={16} /> Local storage <span>↗</span>
              </button>
              <div className="profile">
                <span className="avatar">Y</span>
                <div>
                  Your workspace<small>Free, forever.</small>
                </div>
                <span className="free-badge">OPEN</span>
              </div>
            </div>
          </aside>
          <main className="dashboard-main">
            <header className="dashboard-header">
              <div>
                Workspace <ChevronRight size={14} /> <span>{section}</span>
              </div>
              <button className="quiet" onClick={() => setModal("help")}>
                <Keyboard size={16} /> Quick start <ArrowUpRight size={14} />
              </button>
            </header>
            <div className="dashboard-content">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A LITTLE SHOW GOES A LONG WAY</span>
                  <h1>
                    {section === "Getting started"
                      ? "Let’s make your first demo."
                      : "Make something worth exploring."}
                  </h1>
                  <p>Turn a few clicks into a story people can experience.</p>
                </div>
                <span className="outlined-pill">
                  <span className="local-dot" /> Saved on your device
                </span>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-tag">
                    <span /> THE PRODUCT IS THE STORY
                  </span>
                  <h2>
                    Don’t just tell it.
                    <br />
                    <em>Let them try it.</em>
                  </h2>
                  <p>
                    Capture your flow. Add a little context.
                    <br />
                    Give your audience a front-row seat.
                  </p>
                  <button
                    className="dark-button"
                    onClick={() => setModal("new")}
                  >
                    Create your first demo <ArrowUpRight size={17} />
                  </button>
                  <div className="hero-foot">
                    <Check size={13} /> Free to create. Free to share. Always.
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="art-spark spark-one">✳</div>
                  <div className="floating-label label-one">
                    <span className="tiny-dot" /> A little click. A big idea.
                  </div>
                  <div className="mini-browser">
                    <div className="mini-browser-bar">
                      <i />
                      <i />
                      <i />
                      <span>your next big thing</span>
                    </div>
                    <div className="mini-app">
                      <aside>
                        <b>◈ meadow</b>
                        <span>▦ Overview</span>
                        <span className="mini-active">▤ Projects</span>
                        <span>▧ Inbox</span>
                        <span>♧ Team</span>
                      </aside>
                      <div className="mini-app-body">
                        <small>YOUR WORKSPACE, REIMAGINED</small>
                        <b>Room for good work.</b>
                        <div className="mini-stats">
                          <div>
                            <span>Projects</span>
                            <strong>12</strong>
                            <i />
                          </div>
                          <div>
                            <span>Ideas in motion</span>
                            <strong>86</strong>
                            <i />
                          </div>
                        </div>
                        <div className="mini-lines">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                    <div className="demo-hotspot">1</div>
                  </div>
                  <div className="art-caption">
                    <span>01</span>
                    <div>
                      <b>Show them what’s possible.</b>
                      <small>Click to explore your next big idea.</small>
                    </div>
                    <ArrowUpRight size={17} />
                  </div>
                  <div className="art-cursor">
                    <MousePointer2 size={30} fill="#1e3827" />
                    <span>You, telling a better story</span>
                  </div>
                  <div className="art-spark spark-two">✧</div>
                </div>
              </section>
              {section === "Getting started" ? (
                <div className="getting-started">
                  {[
                    [
                      "01",
                      "Record your flow",
                      "Open a website, click the extension, and walk through your product.",
                    ],
                    [
                      "02",
                      "Make it your own",
                      "Move a hotspot, add context, and guide people to the good stuff.",
                    ],
                    [
                      "03",
                      "Take it anywhere",
                      "Export a standalone demo. Send the file or host it on your website.",
                    ],
                  ].map(([n, t, d]) => (
                    <article key={n}>
                      <span>{n}</span>
                      <h3>{t}</h3>
                      <p>{d}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <>
                  <div className="collection-heading">
                    <div>
                      <h2>
                        Your demos{" "}
                        <span>
                          {
                            projects.filter(
                              (p) =>
                                section !== "Drafts" || p.status === "draft",
                            ).length
                          }
                        </span>
                      </h2>
                      <p>A home for your product stories.</p>
                    </div>
                    <div className="collection-actions">
                      <div className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search demos"
                          placeholder="Search demos…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <kbd>⌘ K</kbd>
                      </div>
                      <IconButton
                        title="Import project"
                        onClick={() => archiveInput.current?.click()}
                      >
                        <Upload size={17} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="demo-grid">
                    {loading ? (
                      <p>Opening your workspace…</p>
                    ) : (
                      projects
                        .filter(
                          (p) =>
                            (section !== "Drafts" || p.status === "draft") &&
                            p.title.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((p) => (
                          <article className="demo-card" key={p.id}>
                            <button
                              className="card-open"
                              aria-label={`Open ${p.title}`}
                              onClick={() =>
                                (location.hash = `project/${p.id}`)
                              }
                            >
                              <Thumbnail project={p} />
                            </button>
                            <div className="card-info">
                              <button
                                className="card-title"
                                onClick={() =>
                                  (location.hash = `project/${p.id}`)
                                }
                              >
                                {p.title}
                              </button>
                              <div className="card-meta">
                                <span
                                  className={`status ${p.status === "recording" ? "recoverable" : ""}`}
                                >
                                  {p.status === "recording"
                                    ? "Recover recording"
                                    : "Draft"}
                                </span>
                                <span>{p.steps.length} steps</span>
                                <span>Edited {date(p.updated)}</span>
                              </div>
                              <div className="card-menu-wrap">
                                <IconButton
                                  title={`Options for ${p.title}`}
                                  onClick={() =>
                                    setMenu(menu === p.id ? null : p.id)
                                  }
                                >
                                  <MoreHorizontal size={19} />
                                </IconButton>
                                {menu === p.id && (
                                  <div className="dropdown">
                                    <button
                                      onClick={async () => {
                                        await duplicateProject(p);
                                        await refresh();
                                        setMenu(null);
                                      }}
                                    >
                                      Duplicate demo
                                    </button>
                                    <button
                                      onClick={() => {
                                        setModal(`delete:${p.id}`);
                                        setMenu(null);
                                      }}
                                    >
                                      Delete demo
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        ))
                    )}
                    {!query && (
                      <button
                        className="new-card"
                        onClick={() => setModal("new")}
                      >
                        <span>
                          <Plus size={25} />
                        </span>
                        <strong>A new story starts here.</strong>
                        <small>Create a demo</small>
                      </button>
                    )}
                    {query &&
                      !projects.some((p) =>
                        p.title.toLowerCase().includes(query.toLowerCase()),
                      ) && (
                        <div className="empty-search">
                          No demos match “{query}”.
                        </div>
                      )}
                  </div>
                </>
              )}
              <div className="inspiration-strip">
                <span className="inspiration-icon">✳</span>
                <div>
                  <b>
                    A blank canvas can be a lot. Start with a little
                    inspiration.
                  </b>
                  <p>Explore an example demo, then make it your own.</p>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={sample}
                >
                  Open example <ArrowUpRight size={16} />
                </button>
              </div>
              <footer className="dashboard-footer">
                <Logo compact />
                <span>Made for sharing. Built to be yours.</span>
                <span>
                  Open source. Open possibilities. <ArrowUpRight size={13} />
                </span>
              </footer>
            </div>
          </main>
        </div>
      ) : (
        <div className="editor">
          <header className="editor-header">
            <IconButton
              title="Back to demos"
              onClick={() => {
                location.hash = "";
              }}
            >
              <ArrowLeft size={19} />
            </IconButton>
            <Logo compact />
            <input
              className="project-title"
              aria-label="Project title"
              value={project.title}
              onChange={(e) => edit({ ...project, title: e.target.value })}
            />
            <span className="save-state">
              {saved ? (
                <>
                  <Check size={13} /> Saved locally
                </>
              ) : (
                <>
                  <Loader2 size={13} /> Saving…
                </>
              )}
            </span>
            <div className="editor-header-actions">
              <IconButton
                title="Undo"
                disabled={!undo.current.length}
                onClick={() => travel("undo")}
              >
                <Undo2 size={18} />
              </IconButton>
              <IconButton
                title="Redo"
                disabled={!redo.current.length}
                onClick={() => travel("redo")}
              >
                <Redo2 size={18} />
              </IconButton>
              <button
                className="secondary-button"
                onClick={() => setModal("preview")}
              >
                <Play size={15} /> Preview
              </button>
              <button
                className="dark-button"
                onClick={() => setModal("export")}
              >
                <Download size={15} /> Export demo
              </button>
            </div>
          </header>
          <aside className="steps-panel">
            <div className="steps-heading">
              <strong>Your story</strong>
              <span>{project.steps.length} steps</span>
            </div>
            <div className="step-list">
              {project.steps.map((s, i) => (
                <button
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", String(i))
                  }
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveStep(Number(e.dataTransfer.getData("text/plain")), i);
                  }}
                  className={`step-row ${i === selected ? "selected" : ""}`}
                  key={s.id}
                  onClick={() => {
                    setSelected(i);
                    setHotspotId(null);
                    setRect(null);
                  }}
                >
                  <span className="step-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div
                    className="step-thumb"
                    style={{ background: project.background }}
                  >
                    {s.type === "chapter" ? (
                      <Type size={20} />
                    ) : s.type === "video" ? (
                      <Film size={20} />
                    ) : (
                      <img src={media[s.assetId || ""]} alt="" />
                    )}
                  </div>
                  <span className="step-row-label">
                    {s.title}
                    <small>
                      {s.type === "chapter"
                        ? "Chapter"
                        : s.type === "video"
                          ? "Video clip"
                          : `${s.hotspots.length} hotspot${s.hotspots.length !== 1 ? "s" : ""}`}
                    </small>
                  </span>
                  <GripVertical size={13} />
                </button>
              ))}
            </div>
            <div className="add-step-actions">
              <button onClick={() => fileInput.current?.click()}>
                <Plus size={16} /> Add media
              </button>
              <button onClick={addChapter}>
                <Type size={16} /> Add chapter
              </button>
            </div>
            <button
              className="step-bottom"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} /> Demo settings <ChevronRight size={14} />
            </button>
          </aside>
          <main className="editor-canvas">
            <div className="canvas-toolbar">
              <div className="tool-group">
                {[
                  { id: "pointer", icon: MousePointer2, label: "Select" },
                  { id: "hotspot", icon: Target, label: "Add hotspot" },
                  {
                    id: "redact",
                    icon: ScanLine,
                    label:
                      step?.type === "video" ? "Redact video" : "Redact image",
                  },
                ].map(({ id, icon: Icon, label }) => (
                  <button
                    disabled={
                      (id === "redact" && step?.type === "chapter") ||
                      (id === "hotspot" && step?.type === "chapter")
                    }
                    key={id}
                    className={tool === id ? "active" : ""}
                    onClick={() => {
                      setTool(id as typeof tool);
                      setRect(null);
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
              <span className="canvas-label">
                <Monitor size={14} />{" "}
                {step ? `${step.width} × ${step.height}` : "Your canvas"}
              </span>
            </div>
            <div className="canvas-scroll">
              <div className="canvas-context">
                <span>
                  {step?.type === "chapter"
                    ? "CHAPTER"
                    : step?.type === "video"
                      ? "VIDEO STEP"
                      : "SCREENSHOT STEP"}
                </span>
                <span>
                  {String(selected + 1).padStart(2, "0")} /{" "}
                  {String(project.steps.length).padStart(2, "0")}
                </span>
              </div>
              {step ? (
                <>
                  <div
                    ref={stage}
                    className={`edit-stage tool-${tool}`}
                    style={{
                      aspectRatio: `${step.width}/${step.height}`,
                      background: project.background,
                    }}
                    onPointerDown={(e) => {
                      if (
                        e.target instanceof Element &&
                        e.target.closest("button")
                      )
                        return;
                      const r = e.currentTarget.getBoundingClientRect();
                      const pt = {
                        x: ((e.clientX - r.left) / r.width) * 100,
                        y: ((e.clientY - r.top) / r.height) * 100,
                      };
                      if (tool === "hotspot") {
                        const h = {
                          id: uid(),
                          x: Math.max(
                            0,
                            Math.min(
                              100,
                              (pt.x - step.focus.x) / step.zoom + step.focus.x,
                            ),
                          ),
                          y: Math.max(
                            0,
                            Math.min(
                              100,
                              (pt.y - step.focus.y) / step.zoom + step.focus.y,
                            ),
                          ),
                          label: "Continue",
                          target: "next",
                        };
                        patchStep({ hotspots: [...step.hotspots, h] });
                        setHotspotId(h.id);
                        setTool("pointer");
                      }
                      if (tool === "redact") {
                        dragStart.current = pt;
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }
                    }}
                    onPointerMove={(e) => {
                      if (!dragStart.current || tool !== "redact") return;
                      const r = e.currentTarget.getBoundingClientRect(),
                        x = Math.max(
                          0,
                          Math.min(100, ((e.clientX - r.left) / r.width) * 100),
                        ),
                        y = Math.max(
                          0,
                          Math.min(100, ((e.clientY - r.top) / r.height) * 100),
                        );
                      setRect({
                        x: Math.min(x, dragStart.current.x),
                        y: Math.min(y, dragStart.current.y),
                        width: Math.abs(x - dragStart.current.x),
                        height: Math.abs(y - dragStart.current.y),
                      });
                    }}
                    onPointerUp={() => {
                      dragStart.current = null;
                    }}
                  >
                    {step.type === "chapter" ? (
                      <div className="chapter-preview">
                        <span>CHAPTER {selected + 1}</span>
                        <h2>{step.title}</h2>
                        <p>
                          {step.body ||
                            "Add a little context to set the scene."}
                        </p>
                        <span className="chapter-preview-button">
                          Let’s explore →
                        </span>
                      </div>
                    ) : step.type === "image" ? (
                      <div className="edit-viewport">
                        <img
                          draggable={false}
                          style={{
                            width: step.crop
                              ? `${10000 / step.crop.width}%`
                              : undefined,
                            height: step.crop
                              ? `${10000 / step.crop.height}%`
                              : undefined,
                            position: step.crop ? "absolute" : undefined,
                            left: step.crop
                              ? `${(-step.crop.x / step.crop.width) * 100}%`
                              : undefined,
                            top: step.crop
                              ? `${(-step.crop.y / step.crop.height) * 100}%`
                              : undefined,
                            transform: `scale(${step.zoom})`,
                            transformOrigin: `${step.focus.x}% ${step.focus.y}%`,
                          }}
                          src={media[step.assetId || ""]}
                          alt={step.title}
                        />
                      </div>
                    ) : (
                      <video
                        key={step.assetId}
                        style={{
                          transform: `scale(${step.zoom})`,
                          transformOrigin: `${step.focus.x}% ${step.focus.y}%`,
                        }}
                        src={media[step.assetId || ""]}
                        controls={tool !== "redact"}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.currentTime =
                            (step.start || 0) + (step.click?.time || 0);
                        }}
                        onTimeUpdate={(e) => {
                          if (
                            e.currentTarget.currentTime >=
                            (step.end ?? Infinity)
                          )
                            e.currentTarget.pause();
                        }}
                      />
                    )}
                    {step.hotspots.map((h, i) => (
                      <button
                        aria-label={`Edit hotspot ${i + 1}`}
                        title={h.label}
                        key={h.id}
                        className={`edit-hotspot ${hotspotId === h.id ? "selected" : ""}`}
                        style={{
                          left: `${(h.x - step.focus.x) * step.zoom + step.focus.x}%`,
                          top: `${(h.y - step.focus.y) * step.zoom + step.focus.y}%`,
                          background: project.accent,
                        }}
                        onClick={() => {
                          setHotspotId(h.id);
                          setTool("pointer");
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                    {(step.redactions || []).map((r, i) => (
                      <div
                        key={i}
                        className="redaction-rect"
                        style={{
                          outline: "none",
                          left: `${(r.x - step.focus.x) * step.zoom + step.focus.x}%`,
                          top: `${(r.y - step.focus.y) * step.zoom + step.focus.y}%`,
                          width: `${r.width * step.zoom}%`,
                          height: `${r.height * step.zoom}%`,
                        }}
                      />
                    ))}
                    {rect && (
                      <div
                        className="redaction-rect"
                        style={{
                          left: `${rect.x}%`,
                          top: `${rect.y}%`,
                          width: `${rect.width}%`,
                          height: `${rect.height}%`,
                        }}
                      />
                    )}
                  </div>
                  <div className="canvas-below">
                    {tool === "hotspot" ? (
                      <>
                        <Target size={14} /> Click anywhere on the screenshot to
                        place a hotspot.
                      </>
                    ) : tool === "redact" ? (
                      <>
                        <ScanLine size={14} /> Drag to cover sensitive
                        information.{" "}
                        {rect && (
                          <button className="text-button" onClick={redact}>
                            Apply redaction <Check size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <MousePointer2 size={14} /> Select a hotspot to edit its
                        label and destination.
                      </>
                    )}
                  </div>
                  <div className="step-caption-card">
                    <span className="small-label">THE STORY AT THIS STEP</span>
                    <h3>{step.title}</h3>
                    <p>
                      {step.body ||
                        "A few words can make all the difference. Add a caption in the panel on the right."}
                    </p>
                  </div>
                </>
              ) : (
                <div className="empty-canvas">
                  <div>
                    <Plus size={35} />
                  </div>
                  <h2>Every good story starts somewhere.</h2>
                  <p>
                    Add screenshots, a video, or an opening chapter.
                    <br />
                    Then give your audience something to explore.
                  </p>
                  <button
                    className="dark-button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={16} /> Add your first media
                  </button>
                  <button className="text-button" onClick={addChapter}>
                    Start with a chapter <ArrowUpRight size={15} />
                  </button>
                </div>
              )}
            </div>
            <footer className="canvas-footer">
              <span>
                <HardDrive size={13} /> On your device. In your control.
              </span>
              <button className="text-button" onClick={() => setModal("help")}>
                A little help <ArrowUpRight size={13} />
              </button>
            </footer>
          </main>
          <aside className="properties-panel">
            <div className="properties-heading">
              <SlidersHorizontal size={17} />
              <strong>{hotspot ? "Hotspot settings" : "Step settings"}</strong>
              {hotspot && (
                <IconButton
                  title="Close hotspot settings"
                  onClick={() => setHotspotId(null)}
                >
                  <X size={15} />
                </IconButton>
              )}
            </div>
            {step ? (
              <div className="properties-content">
                {hotspot ? (
                  <>
                    <label>
                      Hotspot label
                      <input
                        value={hotspot.label}
                        onChange={(e) =>
                          patchHotspot({ label: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Go to
                      <select
                        value={hotspot.target}
                        onChange={(e) =>
                          patchHotspot({ target: e.target.value })
                        }
                      >
                        <option value="next">Next step</option>
                        <option value="end">End of demo</option>
                        {project.steps.map((s, i) => (
                          <option key={s.id} value={s.id}>
                            {i + 1}. {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two-col">
                      <label>
                        X position
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={hotspot.x.toFixed(1)}
                          onChange={(e) =>
                            patchHotspot({
                              x: Math.min(100, Math.max(0, +e.target.value)),
                            })
                          }
                        />
                      </label>
                      <label>
                        Y position
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={hotspot.y.toFixed(1)}
                          onChange={(e) =>
                            patchHotspot({
                              y: Math.min(100, Math.max(0, +e.target.value)),
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="danger-text"
                      onClick={() => {
                        patchStep({
                          hotspots: step.hotspots.filter(
                            (h) => h.id !== hotspot.id,
                          ),
                        });
                        setHotspotId(null);
                      }}
                    >
                      <Trash2 size={14} /> Remove hotspot
                    </button>
                    <p className="hint">
                      A hotspot can jump to any step. Use multiple hotspots to
                      let your viewers choose their path.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Step title
                      <input
                        value={step.title}
                        onChange={(e) => patchStep({ title: e.target.value })}
                      />
                    </label>
                    <label>
                      Caption
                      <textarea
                        rows={4}
                        value={step.body}
                        placeholder="What should they notice here?"
                        onChange={(e) => patchStep({ body: e.target.value })}
                      />
                    </label>
                    <label>
                      {step.type === "video"
                        ? "Clip duration"
                        : "Playback duration"}
                      <div className="input-suffix">
                        <input
                          type="number"
                          min="1"
                          max="300"
                          readOnly={step.type === "video"}
                          value={
                            step.type === "video"
                              ? Number(
                                  ((step.end || 0) - (step.start || 0)).toFixed(
                                    2,
                                  ),
                                )
                              : step.duration
                          }
                          onChange={(e) =>
                            patchStep({
                              duration: Math.max(1, +e.target.value),
                            })
                          }
                        />
                        <span>seconds</span>
                      </div>
                    </label>
                    {step.type === "video" && (
                      <div className="two-col">
                        <label>
                          Trim start (s)
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={step.start}
                            onChange={(e) => {
                              const start = Math.max(
                                0,
                                Math.min(
                                  +e.target.value,
                                  (step.end || 1) - 0.1,
                                ),
                              );
                              patchStep({
                                start,
                                duration: (step.end || 1) - start,
                              });
                            }}
                          />
                        </label>
                        <label>
                          Trim end (s)
                          <input
                            type="number"
                            min={(step.start || 0) + 0.1}
                            step="0.1"
                            value={step.end}
                            onChange={(e) => {
                              const end = Math.min(
                                step.sourceDuration ?? step.end ?? 300,
                                Math.max(
                                  (step.start || 0) + 0.1,
                                  +e.target.value,
                                ),
                              );
                              patchStep({
                                end,
                                duration: end - (step.start || 0),
                              });
                            }}
                          />
                        </label>
                      </div>
                    )}
                    {step.type !== "chapter" && (
                      <>
                        <div className="property-divider" />
                        <div className="property-section-heading">
                          Focus & framing <span>{step.zoom.toFixed(1)}×</span>
                        </div>
                        <label className="motion-toggle">
                          <input
                            type="checkbox"
                            checked={step.motion !== false}
                            onChange={(e) =>
                              patchStep({ motion: e.target.checked })
                            }
                          />{" "}
                          Smooth camera motion
                        </label>
                        <p className="hint">
                          Automatically zoom toward the click, then pull back to
                          show its result.
                        </p>
                        <label className="range-label">
                          Zoom
                          <input
                            type="range"
                            min="1"
                            max="3"
                            step="0.1"
                            value={step.zoom}
                            onChange={(e) =>
                              patchStep({ zoom: +e.target.value })
                            }
                          />
                        </label>
                        <div className="two-col">
                          <label>
                            Focus X
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={step.focus.x}
                              onChange={(e) =>
                                patchStep({
                                  focus: {
                                    ...step.focus,
                                    x: Math.min(
                                      100,
                                      Math.max(0, +e.target.value),
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            Focus Y
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={step.focus.y}
                              onChange={(e) =>
                                patchStep({
                                  focus: {
                                    ...step.focus,
                                    y: Math.min(
                                      100,
                                      Math.max(0, +e.target.value),
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                        </div>
                        <button
                          className="full-secondary"
                          onClick={() => replaceInput.current?.click()}
                        >
                          <ImageIcon size={15} /> Replace media
                        </button>
                      </>
                    )}
                    <div className="property-divider" />
                    <div className="property-section-heading">
                      Voice & audio <Mic size={14} />
                    </div>
                    <div className="two-col">
                      <button
                        className={`full-secondary ${recordingAudio ? "recording" : ""}`}
                        onClick={narrate}
                      >
                        {recordingAudio ? (
                          <Square size={13} />
                        ) : (
                          <Mic size={13} />
                        )}{" "}
                        {recordingAudio ? "Stop" : "Record"}
                      </button>
                      <button
                        className="full-secondary"
                        onClick={() => narrationInput.current?.click()}
                      >
                        <Upload size={13} /> Upload
                      </button>
                    </div>
                    {step.narrationId && (
                      <>
                        <audio src={media[step.narrationId]} controls />
                        <button
                          className="danger-text"
                          onClick={() => patchStep({ narrationId: undefined })}
                        >
                          Remove audio
                        </button>
                      </>
                    )}
                    <div className="property-divider" />
                    <div className="property-section-heading">
                      Call to action <ArrowUpRight size={14} />
                    </div>
                    <label>
                      Button label
                      <input
                        placeholder="Try it yourself"
                        value={step.cta?.label || ""}
                        onChange={(e) =>
                          patchStep({
                            cta: {
                              label: e.target.value,
                              url: step.cta?.url || "",
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Destination URL
                      <input
                        placeholder="https://your-product.com"
                        value={step.cta?.url || ""}
                        onChange={(e) =>
                          patchStep({
                            cta: {
                              label: step.cta?.label || "",
                              url: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <div className="property-divider" />
                    <div className="step-manage">
                      <IconButton
                        title="Move step up"
                        disabled={!selected}
                        onClick={() => moveStep(selected, selected - 1)}
                      >
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton
                        title="Move step down"
                        disabled={selected === project.steps.length - 1}
                        onClick={() => moveStep(selected, selected + 1)}
                      >
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton
                        title="Duplicate step"
                        onClick={() => {
                          const s = structuredClone(step);
                          s.id = uid();
                          s.title += " (copy)";
                          edit({
                            ...project,
                            steps: [
                              ...project.steps.slice(0, selected + 1),
                              s,
                              ...project.steps.slice(selected + 1),
                            ],
                          });
                          setSelected(selected + 1);
                        }}
                      >
                        <Copy size={16} />
                      </IconButton>
                      <IconButton
                        title="Delete step"
                        onClick={() => {
                          edit({
                            ...project,
                            steps: project.steps.filter(
                              (s) => s.id !== step.id,
                            ),
                          });
                          setSelected(Math.max(0, selected - 1));
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="properties-empty">
                <Settings2 size={24} />
                <p>
                  The details live here.
                  <br />
                  Add a step to get started.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
      {modal === "new" && (
        <Modal
          title="A new story starts here."
          subtitle="How would you like to begin?"
          onClose={() => setModal(null)}
        >
          <div className="new-options">
            <button onClick={() => setModal("record")}>
              <span className="option-icon">
                <Monitor size={24} />
              </span>
              <div>
                <strong>Record your product</strong>
                <p>Turn clicks into an interactive walkthrough.</p>
              </div>
              <ChevronRight size={18} />
            </button>
            <button onClick={create}>
              <span className="option-icon">
                <Plus size={24} />
              </span>
              <div>
                <strong>Start from scratch</strong>
                <p>Bring your screenshots, clips, and ideas.</p>
              </div>
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => {
                archiveInput.current?.click();
                setModal(null);
              }}
            >
              <span className="option-icon">
                <Upload size={24} />
              </span>
              <div>
                <strong>Import a project</strong>
                <p>Pick up a story you’ve already started.</p>
              </div>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="modal-note">
            <ShieldCheck size={15} /> Everything stays on your device. Always.
          </div>
        </Modal>
      )}
      {modal === "record" && (
        <Modal
          title="Let your product do the talking."
          subtitle="Record from the Open Arcade Chrome extension."
          onClose={() => setModal(null)}
        >
          <ol className="instruction-list">
            <li>
              <span>1</span>
              <div>
                <strong>Open the website you want to show.</strong>
                <p>Sign in and get your starting view ready.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Click Open Arcade in Chrome’s toolbar.</strong>
                <p>Choose Record this tab, then click through your flow.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Finish recording. Start telling your story.</strong>
                <p>The editor opens with your screenshots and video steps.</p>
              </div>
            </li>
          </ol>
          {!isExtension && (
            <div className="callout">
              <strong>Install the local extension</strong>
              <p>
                Run <code>npm run build</code>, open{" "}
                <code>chrome://extensions</code>, enable Developer mode, and
                load the <code>dist</code> folder.
              </p>
            </div>
          )}
          <button className="full-secondary" onClick={create}>
            Or start with your own screenshots <ArrowUpRight size={15} />
          </button>
        </Modal>
      )}
      {modal === "settings" && project && (
        <Modal
          title="Make it yours."
          subtitle="The little details that tie your story together."
          onClose={() => setModal(null)}
        >
          <div className="settings-form">{settings}</div>
        </Modal>
      )}
      {modal === "preview" && project && (
        <Modal
          wide
          title="See it through their eyes."
          subtitle="Use the hotspots, arrow keys, or Next to explore."
          onClose={() => setModal(null)}
        >
          <Player project={project} media={media} />
        </Modal>
      )}
      {modal === "export" && project && (
        <Modal
          title="Good stories travel."
          subtitle="Take your demo anywhere. No account required."
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          {busy && progress === null && (
            <div className="export-working" role="status">
              <Loader2 size={15} /> Preparing media… Keep this tab open while
              video clips are trimmed.
            </div>
          )}
          <div className="export-options">
            {[
              {
                id: "html",
                icon: Globe,
                title: "Interactive demo",
                desc: "One HTML file. Opens offline, or hosts anywhere.",
              },
              {
                id: "project",
                icon: FolderOpen,
                title: "Editable project",
                desc: "A portable backup with all referenced media.",
              },
              {
                id: "guide",
                icon: BookOpen,
                title: "Step-by-step guide",
                desc: "A printable HTML guide for your documentation.",
              },
              {
                id: "video",
                icon: Film,
                title: "Video",
                desc: "MP4 where supported; otherwise WebM. Renders in real time.",
              },
              {
                id: "gif",
                icon: ImageIcon,
                title: "Animated GIF",
                desc: "A silent, linear preview. Best for short demos.",
              },
            ].map(({ id, icon: Icon, title, desc }) => (
              <button
                key={id}
                disabled={busy || !project.steps.length}
                onClick={() => void exportAs(id)}
              >
                <Icon size={21} />
                <div>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </div>
                <Download size={16} />
              </button>
            ))}
          </div>
          {progress !== null && (
            <div className="export-progress">
              <progress max="1" value={progress} />
              <span>
                Rendering {Math.round(progress * 100)}% — keep this tab open.
              </span>
              <button
                className="text-button"
                onClick={() => exportAbort.current?.abort()}
              >
                Cancel
              </button>
            </div>
          )}
          <div className="embed-section">
            <label>
              Embed on your website
              <input
                value={embedURL}
                onChange={(e) => setEmbedURL(e.target.value)}
                aria-label="Hosted demo URL"
              />
            </label>
            <button
              className="full-secondary"
              onClick={async () => {
                let url: URL;
                try {
                  url = new URL(embedURL);
                  if (!["http:", "https:"].includes(url.protocol))
                    throw Error();
                } catch {
                  notify(
                    "Enter a valid HTTP or HTTPS URL for your hosted demo.",
                  );
                  return;
                }
                try {
                  await navigator.clipboard.writeText(
                    `<iframe src="${url.href.replace(/&/g, "&amp;").replace(/"/g, "%22")}" title="Interactive product demo" style="width:100%;aspect-ratio:16/10;border:0" allowfullscreen loading="lazy"></iframe>`,
                  );
                  notify(
                    "Embed code copied. Host the HTML export at this URL first.",
                  );
                } catch {
                  notify(
                    "Clipboard access was denied. Use an iframe with your hosted demo URL.",
                  );
                }
              }}
            >
              <Copy size={14} /> Copy embed code
            </button>
            <p className="hint">
              Host the HTML export at the URL above before embedding. Branching
              remains interactive in HTML. Video, GIF, and guides follow the
              step order. Narration is included in HTML, project archives, and
              video exports.
            </p>
          </div>
        </Modal>
      )}
      {modal?.startsWith("delete:") && (
        <Modal
          title="Delete this demo?"
          subtitle="This removes the project and its media from this device."
          onClose={() => setModal(null)}
        >
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Keep demo
            </button>
            <button
              className="danger-button"
              onClick={async () => {
                await deleteProject(modal.slice(7));
                await refresh();
                setModal(null);
                notify("Demo deleted.");
              }}
            >
              Delete demo
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A few things to get you going."
          onClose={() => setModal(null)}
        >
          <ol className="instruction-list">
            <li>
              <span>1</span>
              <div>
                <strong>Capture or bring your own media.</strong>
                <p>
                  The extension records clicks and video. You can also upload
                  PNG, JPG, WebP, GIF, MP4, or WebM.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Build a story, one step at a time.</strong>
                <p>
                  Drag steps to reorder. Add hotspots to guide clicks or create
                  branching paths. Use chapters to set the scene.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Preview, then take it anywhere.</strong>
                <p>
                  Export an HTML demo for offline viewing or static hosting.
                  Keep a project archive as your editable backup.
                </p>
              </div>
            </li>
          </ol>
          <div className="callout">
            <strong>Handy shortcuts</strong>
            <p>
              Editor: ⌘/Ctrl Z to undo, Shift ⌘/Ctrl Z to redo, ↑ ↓ to select
              steps.
              <br />
              Recorder: Alt Shift R to pause/resume, Alt Shift S to finish.
              <br />
              Player: ← → to move between steps.
            </p>
          </div>
        </Modal>
      )}
      {modal === "about" && (
        <Modal title="Your work stays yours." onClose={() => setModal(null)}>
          <div className="about-copy">
            <ShieldCheck size={36} />
            <p>
              Open Arcade stores projects and media in this browser profile’s
              local database. It has no server, telemetry, or paid services.
            </p>
            <p>
              Export project archives to back up your work. Removing the
              extension or clearing its storage removes local projects. The
              website preview and installed extension have separate storage.
            </p>
            <p>
              Free software under AGPL-3.0. No watermarks or artificial demo
              limits. Available space depends on your device.
            </p>
          </div>
        </Modal>
      )}
      {project?.status === "recording" && (
        <div className="recovery-banner">
          <span>
            This recording was interrupted. Recover the saved media before
            editing.
          </span>
          <button
            onClick={async () => {
              const s = isExtension
                ? await chrome.storage.session.get("session")
                : {};
              if (s.session?.projectId === project.id) {
                notify(
                  "This recording is still running. Finish it from the extension first.",
                );
                return;
              }
              const p = await recoverProject(project);
              setProject({ ...p });
              notify("Recording recovered from saved media.");
            }}
          >
            Recover recording
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
