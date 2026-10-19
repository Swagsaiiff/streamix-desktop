# STREAMIX Desktop

STREAMIX is a responsive Netflix-style movie and series streaming application powered by real content from provider implementations.

This repository represents **STREAMIX Desktop** (migrating the working web application baseline to a native desktop shell).

---

## Architecture Overview (Phase 2B: Electron Foundation)

In this phase, Electron is introduced as a secure desktop shell surrounding the audited STREAMIX baseline:
- `packages/client/`: React 19 + Vite 8 frontend.
- `packages/server/`: Node.js + Express 5 backend with provider scrapers and media processing.
- `packages/desktop/`: Electron 44 desktop shell and preload bridge.

### Security Model
The desktop shell adheres strictly to Electron security best practices:
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true` (never disabled)
- Navigation is strictly restricted to application origins; external links are dispatched to the system browser via `shell.openExternal`.
- The preload bridge (`packages/desktop/src/preload.cjs`) exposes only safe read-only identification primitives (`window.streamixDesktop`).

---

## Getting Started

### 1. Installation
Install all monorepo workspace dependencies:
```bash
npm install
```

### 2. Launching the Web Version
The original web development workflow remains completely intact:
```bash
npm run dev
```
Starts:
- Express backend API at `http://localhost:4000`
- Vite frontend dev server at `http://localhost:5173`

Individual service commands:
- `npm run dev:server` — start only the Express backend
- `npm run dev:client` — start only the Vite client
- `npm run health` — run backend healthcheck

### 3. Launching the Electron Desktop Application
Launch the coordinated desktop development stack:
```bash
npm run dev:electron
```
This single command:
1. Boots the Express backend on `http://localhost:4000`.
2. Boots the Vite dev server on `http://localhost:5173` (proxying `/api` requests to Express).
3. Spawns the Electron application window, which waits for the Vite dev server to become ready before rendering.
4. Uses `concurrently --kill-others` to guarantee that closing the Electron window terminates the background web and server processes cleanly, preventing orphaned listeners.

If you already have `npm run dev` running in another terminal:
```bash
npm run dev:desktop
```
This attaches an Electron window directly to the existing dev server.

---

## Verification & Testing

- **Full test suite:**
  ```bash
  npm run test
  ```
  Runs 97 backend unit/integration tests and 34 client tests (131 total).
- **Client production build:**
  ```bash
  npm run build
  ```
- **Backend health:**
  ```bash
  npm run health
  ```

---

## Known Limitations (Phase 2B Scope)

- **Not Standalone Yet:** STREAMIX Desktop in Phase 2B is a desktop shell embedding the Vite dev server and proxying to the local Express backend. It has not yet been converted to a self-contained single-process bundle.
- **Playback Engine:** Playback remains on the existing HTML5 / `hls.js` + server-side FFmpeg pipeline. Native `libmpv` integration is scheduled for subsequent phases.
- **Provider Resolution:** Live stream resolution depends on third-party upstream availability (see `DESKTOP_MIGRATION_AUDIT.md` for live provider audit notes). Synthetic test fixture playback remains available via `?fixture=1`.
- **Packaging:** Production executable packaging (`electron-builder`) will be introduced in packaging phases.