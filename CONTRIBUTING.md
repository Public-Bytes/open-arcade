# Contributing

Use Node.js 22.12+ and `npm ci`. Run `npm run check`, `npm test`, `npm run build`, and `npm run test:e2e` before proposing changes. For recorder changes, verify the packaged extension against an actual website, including navigation, pause/resume, stop, and recovery.

Keep the application usable locally without accounts or paid services. Do not add telemetry, remote executable code, required cloud dependencies, or artificial feature limits. Preserve portable project compatibility, sanitize untrusted imports, and exclude unreferenced originals from exports.

Recordings must remain explicitly initiated by the user and scoped to the chosen tab. Keep typed input values out of metadata. Document browser capture limitations clearly.
