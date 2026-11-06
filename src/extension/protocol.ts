export type Session = {
  projectId: string;
  tabId: number;
  paused: boolean;
  started: number;
  // Total paused time, and when the current pause began, for the timer.
  pausedMs: number;
  pausedAt?: number;
  origin: string;
  crossSite: boolean;
  hudWindow?: number;
};
export type RecordOptions = {
  systemAudio: boolean;
  microphone: boolean;
  camera: boolean;
  crossSite: boolean;
};
export const defaultOptions: RecordOptions = {
  systemAudio: true,
  microphone: false,
  camera: false,
  crossSite: false,
};
export const elapsed = (s: Session, now = Date.now()) =>
  Math.max(0, (s.pausedAt ?? now) - s.started - s.pausedMs) / 1000;
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export type CaptureEvent = {
  kind: "click" | "activity" | "viewport" | "pointer";
  viewport?: { width: number; height: number };
  time: number;
  x?: number;
  y?: number;
  label: string;
  cursor?: "arrow" | "hand" | "text";
  visible?: boolean;
};
export async function command(
  type: string,
  data: Record<string, unknown> = {},
) {
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type,
    ...data,
  });
  if (response?.error) throw Error(response.error);
  return response;
}
