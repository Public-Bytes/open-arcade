export type PointerPoint = {
  t: number;
  x: number;
  y: number;
  kind?: "arrow" | "hand" | "text";
  visible?: boolean;
};
export type FilmClick = {
  id: string;
  t: number;
  x: number;
  y: number;
  label: string;
};
export type ZoomRegion = {
  id: string;
  start: number;
  end: number;
  scale: number;
  x: number;
  y: number;
  automatic: boolean;
  // Stored by older versions, which could pan with the cursor. Ignored now:
  // every zoom goes straight into its box and holds still.
  follow?: boolean;
};
export type FilmAnnotation = {
  width?: number;
  height?: number;
  id: string;
  start: number;
  end: number;
  x: number;
  y: number;
  text: string;
  type: "text" | "cover";
  size?: number;
  theme?: "light" | "dark" | "accent";
};
export type FilmCut = { id: string; start: number; end: number };
export type FilmSettings = {
  zoom: number;
  autoZoom: boolean;
  cameraSmoothness: number;
  cursorSize: number;
  cursorStyle: "arrow" | "dot" | "native";
  cursorColor: string;
  cursorSmoothing: number;
  clickEffect: boolean;
  cursorTilt: boolean;
  padding: number;
  radius: number;
  shadow: number;
  background: string;
  aspect: "native" | "16:9" | "1:1" | "9:16";
  systemVolume: number;
  micVolume: number;
  webcamSize: number;
  webcamX: number;
  webcamY: number;
  webcamShape: "circle" | "rounded";
};
export type FilmData = {
  cursorRecorded?: boolean;
  cursorEmbedded?: boolean;
  hasSystemAudio?: boolean;
  duration: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  pointer: PointerPoint[];
  clicks: FilmClick[];
  zooms: ZoomRegion[];
  // Removed sections of the recording, in source time.
  cuts?: FilmCut[];
  // Automatic zoom ids the user deleted. Clicks stay; the camera ignores them.
  dismissed?: string[];
  annotations: FilmAnnotation[];
  settings: FilmSettings;
  audio?: {
    assetId: string;
    start: number;
    end: number;
    sourceStart: number;
    volume: number;
  }[];
  micId?: string;
  webcamId?: string;
};
export const defaultSettings = (): FilmSettings => ({
  zoom: 1.75,
  autoZoom: true,
  cameraSmoothness: 0.65,
  cursorSize: 70,
  cursorStyle: "arrow",
  cursorColor: "#ffffff",
  cursorSmoothing: 0.7,
  clickEffect: true,
  cursorTilt: true,
  padding: 42,
  radius: 18,
  shadow: 32,
  background: "aurora",
  aspect: "native",
  systemVolume: 1,
  micVolume: 1,
  webcamSize: 20,
  webcamX: 85,
  webcamY: 80,
  webcamShape: "circle",
});
export const blankFilm = (duration = 0): FilmData => ({
  duration,
  trimStart: 0,
  trimEnd: duration,
  speed: 1,
  pointer: [],
  clicks: [],
  zooms: [],
  annotations: [],
  settings: defaultSettings(),
});
export const backgrounds: Record<string, { name: string; colors: string[] }> = {
  aurora: { name: "Aurora", colors: ["#2b5bff", "#8b5cf6", "#ff8a7a"] },
  violet: { name: "Dusk", colors: ["#1a1446", "#6a3fb5", "#f28fb0"] },
  ocean: { name: "Ocean", colors: ["#04264f", "#0a72c2", "#6fd6f5"] },
  peach: { name: "Peach", colors: ["#ffb088", "#ffd3c4", "#e9c6f2"] },
  ink: { name: "Graphite", colors: ["#0c0c10", "#1d1d26", "#34344a"] },
  paper: { name: "Paper", colors: ["#fbfbfd", "#ededf2", "#e2e2ea"] },
};
