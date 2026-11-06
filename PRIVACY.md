# Privacy

Open Arcade has no backend. It does not send recordings, cursor paths, audio, webcam footage, analytics, or projects to its authors or any hosted service. Executable code, fonts, and the example are bundled locally.

Permissions:

- **activeTab:** access to the website you explicitly choose to record.
- **debugger:** read compositor frames from the explicitly selected tab without its native cursor. Only that tab is attached; the connection is detached on finish or failure. Chrome shows its debugging banner while attached.
- **tabCapture:** capture optional audio from that tab.
- **scripting:** attach cursor/click listeners on approved websites.
- **storage:** maintain recording session state.
- **offscreen:** continue native recording through navigation.
- **unlimitedStorage:** store larger local media projects, subject to disk/browser limits.
- **Optional website access:** track cursor/click metadata when navigating across websites in the selected tab.
- **Optional microphone/camera access:** requested by Chrome when you enable those recording devices. Device streams are stopped after recording.

Visible information, including sensitive content, is recorded. Cursor metadata includes timestamps, normalized positions, cursor type, and click target labels. Input values are not read into metadata, but visible typed content is part of the video. Review recordings before sharing.

Projects, source footage, microphone/webcam tracks, uploaded files, and recovery chunks are stored in IndexedDB in your extension browser profile. Exports download to your device. No upload or hosted sharing is provided.

Rendered MP4/GIF exports bake timed covers into pixels and include only the selected trim range. Editable project archives deliberately retain original source media, discarded frames, and editable covers. They are backups, not sanitized sharing copies. Undo/local sources may retain sensitive originals. Deleting a recording removes its local assets and recovery chunks. Clearing extension storage or uninstalling removes local work; export backups first.
