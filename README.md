<p align="center">
  <img src="public/icons/128.png" width="96" height="96" alt="Open Arcade icon">
</p>

<h1 align="center">Open Arcade</h1>

<p align="center"><strong>Record your browser. Make a video worth sharing.</strong></p>

<p align="center">
  A free, open-source Chrome tab recorder and local video studio.<br>
  Automatic zooms, a smooth cursor, and editing tools, right in your browser.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-you-can-make">Features</a> ·
  <a href="#record-and-edit">How it works</a> ·
  <a href="#development-and-verification">Develop</a> ·
  <a href="#license">License</a>
</p>

---

Record a product walkthrough, a tutorial, or a quick demo without stitching together screenshots. Open Arcade captures one Chrome tab as continuous video, then opens it in an editor with automatic zooms around your clicks.

**No account. No subscription. No watermark.** Projects and media stay in your Chrome profile, and exports are made locally. See [Privacy](PRIVACY.md) for details.

## What you can make

| Record | Edit | Export |
| --- | --- | --- |
| Capture a Chrome tab with optional tab audio, microphone, and webcam. | Refine automatic zooms and cursor movement, trim or cut clips, add text and privacy covers, and adjust speed and backgrounds. | Export an MP4 with audio or a silent GIF. Save an editable project backup for later. |

- **Guide the eye.** Automatic zooms follow click clusters. Reframe or add zooms on the timeline, and customize the animated cursor.
- **Make it yours.** Arrange the webcam bubble, captions, and privacy covers directly on the preview.
- **Keep working locally.** Import MP4s, WebM files, images, and supported Open Arcade projects. Imported videos do not include a recorded cursor path.
- **Try before recording.** The workspace includes an example video and cursor track under **Try the editor**.

## Get started

You will need Node.js 22.12 or later and Chrome 130 or later.

```sh
git clone https://github.com/gitcommit90/open-arcade.git
cd open-arcade
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `dist/` folder.
3. Pin **Open Arcade — Video Studio**, open a website, and start recording.

After rebuilding, reload the extension on `chrome://extensions` and reopen its workspace. Chrome Web Store publication is a separate distribution step.

> **Local projects need backups.** Clearing extension storage or uninstalling the extension deletes local work. Save important projects as editable backups. Backups contain original media, including material hidden by trims or privacy covers; share a rendered export when that material must not be included.

## Record and edit

1. Open the website you want to show. Click the pinned extension and choose **Start recording**, or press **Alt Shift R**. Tab audio, microphone, webcam and "follow links to other sites" are remembered between recordings. Chrome asks for microphone/webcam access in a setup page the first time.
2. A 3-2-1 countdown runs in the page (click it to start immediately). A small control window opens beside the browser with a timer, **Pause/Resume**, **Finish** and **Discard**. It is a separate window, so it never appears in the video.
3. Use the product normally. One continuous video records the tab; cursor positions and clicks are saved separately. **Alt Shift R** pauses/resumes, **Alt Shift S** finishes.
4. Finishing opens the editor with a zoom already on every click cluster:
   - **Preview:** select a zoom and drag its box to reframe, or drag a corner to zoom further. Drag captions, privacy covers and the webcam bubble directly on the video.
   - **Timeline:** drag trim handles, drag across the Zoom lane to add a zoom, move/resize any block (edges snap to the playhead and to each other), and zoom the timeline with the buttons or ⌘/Ctrl-scroll.
   - **Cut (X)** removes a section from the middle; playback and export skip it. **I/O** set trim in/out at the playhead, **Z** adds a zoom, **T** adds text, **Delete** removes the selection. Press **?** for all shortcuts.
   - Undo groups each slider drag or typing burst into one step.
5. **Export video** produces MP4 with audio or a silent GIF. **Save project** downloads an editable backup without transcoding.

The workspace's **Try the editor** example contains a generated eight-second source video and a smooth cursor track. You can also drop MP4, WebM and images (or an `.arcade.zip` project) anywhere on the recordings page. Imported videos have no recorded cursor path; add zooms manually. Existing Open Arcade project archives and HTML exports can be imported. Missing motion/cursor data in older screenshots cannot be reconstructed.

## Export and performance

MP4 uses WebCodecs through Mediabunny in a dedicated worker: sequential source decoding, one shared camera/cursor renderer, hardware encoding when available, and streamed audio mixing. Export generates frames as fast as the browser can process them; it does not wait for real-time playback or seek an HTML video for every frame. Preview uses the source video’s own playback clock and retains its last composed frame while decoding/seeking. Transport updates never trigger corrective seeks during ordinary playback.

Choose 1280–3840 pixels wide, 30/60 fps, bitrate, and native/landscape/square/portrait composition. GIF uses 10, 20 (default) or 25 fps, rates GIF can time exactly, with a palette chosen per frame and color-corrected so flat UI keeps its true tint. It is intended for short clips. Higher resolutions, complex footage, GIF quantization, and software codecs take more time and memory. Rendering speed depends on hardware and source media; the export dialog reports actual elapsed time and throughput.

An editable `.arcade.zip` archive includes the **original media**, metadata, and all referenced audio/webcam assets. Trims and privacy covers remain editable in that backup. Share the rendered MP4/GIF when discarded frames or uncovered source material must not be included. MP4/GIF render only the selected trim range and bake covers into pixels. Local undo and source files can retain uncovered content; covers are not secure erasure.

## Local storage and recovery

Projects and media live in IndexedDB in the extension's Chrome profile. Capture writes video chunks and cursor checkpoints incrementally. Interrupted recordings can recover data committed before the interruption; unfinished media buffers can be lost. Back up valuable projects. Clearing extension storage or uninstalling deletes local work. The web development preview and installed extension use separate databases.

## Browser limits

- Records one Chrome tab, including visible sensitive information. It does not capture other tabs, desktop applications, browser toolbars, native dialogs, or file pickers.
- Cursor/click metadata currently comes from the top-level document. Cross-origin frames appear in the video but do not supply their internal cursor events. Cross-site navigation requires the optional website-access setting.
- Chrome internal pages, the Chrome Web Store, and extension pages cannot be recorded.
- New recordings capture compositor frames without the native cursor. The styled cursor is rendered from separate telemetry. Older version 0.3 recordings retain their embedded cursor and are displayed once, without a second overlay. Re-record to change their cursor styling.
- Cursor-free recording uses Chrome’s `debugger` permission on the selected tab. Chrome displays its debugging banner during recording; opening DevTools on that tab or dismissing that banner can end the capture. The debugger is detached on finish.
- Capture timing and source frame rate limit click precision. The camera runs continuously across click clusters instead of restarting its animation on every click.
- Speed changes resample audio, changing pitch. GIF is silent. Video export needs browser AVC/AAC WebCodecs support.
- This local release has no cloud hosting, collaborative editing, system-wide recording, or remote services.

## Development and verification

```sh
npm run dev              # localhost:5173 studio; tab recording needs extension
npm run check            # TypeScript
npm test                 # motion, asset archives, recovery, import validation
npm run build            # extension + complete source ZIP + SHA-256 hashes
npx playwright install chromium
npm run test:e2e         # studio editing, decoded audio/video, GIF, cancellation
npm run test:extension   # real extension recording/navigation/pause/export/recovery
```

On macOS, browser tests use installed Google Chrome. Elsewhere set `CHROME_PATH` for extension tests to a current Chrome supporting the extension debugging protocol. Tests use isolated temporary profiles and local fixtures. They do not use your signed-in browser profile. Artifacts and user recordings are excluded from release archives.

Regenerate the fictional bundled footage with `npm run dev` running, then `node scripts/generate-example.mjs`.

Core files: `src/Studio.tsx` (editor), `src/film/Preview.tsx` (native preview), `src/film/motion.ts` (continuous spring camera/cursor), `src/film/draw.ts` (shared compositor), `src/film/export-worker.ts` (offline encoding and audio mix), `src/extension/offscreen.ts` (native recording), and `src/lib/db.ts` (local media and recovery).

## Recordly source review and attribution

Reviewed [Recordly](https://github.com/webadderallorg/Recordly) at commit `109ca3a13c362e969d9add25d1f93406c36dba2a`, including `motionSmoothing.ts`, `cursorFollowCamera.ts`, `sceneMotion.ts`, `cursorPosition.ts`, `previewVideoSource.ts`, `usePreviewVideoReady.ts`, `zoomRegionUtils.ts`, and the native ScreenCaptureKit recorder.

Recordly excludes the native cursor before drawing its telemetry cursor, keeps one video source alive, preserves the last valid frame during seeks, and uses a persistent camera with a safe zone. Open Arcade now follows that capture/composition separation, uses the video clock for preview, and includes Recordly’s spring solver plus adapted camera-follow behavior in `src/film/recordly-spring.ts` and `src/film/motion.ts`. Cursor position filtering is symmetric, preserves clicks, and holds still during gaps between mouse events; it does not add a following spring delay.

Recordly code copyright (C) 2026 webadderall, licensed AGPL-3.0. See [RECORDLY-LICENSE.md](RECORDLY-LICENSE.md). UI attribution and the upstream license are included in both release archives. The Electron, PixiJS, and native desktop runtime are not bundled.

## License

AGPL-3.0-only. See [LICENSE](LICENSE). Dependencies retain their respective licenses; packaged notices are included. Independent implementation, unaffiliated with Arcade Software or Recordly.
