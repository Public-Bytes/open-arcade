import { command } from "./protocol";
import "./popup.css";
const options = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const button = document.querySelector<HTMLButtonElement>("#allow")!;
document.querySelector("#detail")!.textContent =
  `Allow ${[options.microphone && "your microphone", options.camera && "your webcam"].filter(Boolean).join(" and ")} to include it in this recording. Everything stays on your device.`;
button.onclick = async () => {
  button.disabled = true;
  const error = document.querySelector<HTMLElement>("#error")!;
  error.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: !!options.microphone,
      video: !!options.camera,
    });
    stream.getTracks().forEach((t) => t.stop());
    await chrome.tabs.update(options.tabId, { active: true });
    await command("start", options);
    window.close();
  } catch (e) {
    error.textContent = (e as Error).message;
    error.hidden = false;
    button.disabled = false;
  }
};
