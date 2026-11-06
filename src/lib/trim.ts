import type { Redaction } from "./model";
// Bake a clip into independent media so exports cannot expose discarded recording sections.
export async function trimVideo(
  blob: Blob,
  start: number,
  end: number,
  redactions: Redaction[] = [],
  crop?: Redaction,
): Promise<Blob> {
  if (!(end > start)) throw Error("Invalid video trim.");
  const url = URL.createObjectURL(blob),
    video = document.createElement("video"),
    canvas = document.createElement("canvas");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let stream: MediaStream | undefined,
    audio: AudioContext | undefined,
    frame = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(Error("Unable to decode video for export."));
    });
    const region = crop || { x: 0, y: 0, width: 100, height: 100 };
    const sx = (video.videoWidth * region.x) / 100,
      sy = (video.videoHeight * region.y) / 100,
      sw = (video.videoWidth * region.width) / 100,
      sh = (video.videoHeight * region.height) / 100;
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d")!;
    if (start > 0)
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(Error("Unable to trim video."));
        video.currentTime = start;
      });
    const drawFrame = () => {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#18251f";
      for (const r of redactions)
        ctx.fillRect(
          (r.x / 100) * canvas.width,
          (r.y / 100) * canvas.height,
          (r.width / 100) * canvas.width,
          (r.height / 100) * canvas.height,
        );
    };
    drawFrame();
    stream = canvas.captureStream(30);
    // Use the source audio without playing it into the room.
    try {
      audio = new AudioContext();
      await audio.resume();
      const source = audio.createMediaElementSource(video),
        destination = audio.createMediaStreamDestination();
      source.connect(destination);
      for (const track of destination.stream.getAudioTracks())
        stream.addTrack(track);
    } catch {
      await audio?.close();
      audio = undefined;
    }
    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) throw Error("This browser cannot encode a portable video clip.");
    const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
      }),
      chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(Error("Video export failed."));
    });
    const draw = () => {
      if (video.currentTime < end) drawFrame();
      frame = requestAnimationFrame(draw);
    };
    recorder.start();
    await video.play();
    draw();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          clearInterval(poll);
          reject(Error("Video trim timed out."));
        },
        Math.max(15000, (end - start) * 2000),
      );
      const poll = setInterval(() => {
        if (video.currentTime >= end || video.ended) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve();
        }
      }, 10);
    });
    cancelAnimationFrame(frame);
    video.pause();
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: recorder.mimeType });
  } finally {
    cancelAnimationFrame(frame);
    video.pause();
    video.removeAttribute("src");
    video.load();
    stream?.getTracks().forEach((t) => t.stop());
    await audio?.close();
    URL.revokeObjectURL(url);
  }
}
