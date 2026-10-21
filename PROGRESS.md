## Navbar Buttons Navigation Fix (COMPLETED)

### Objective
Fix navbar buttons (Home, Movies, Series, Settings, STREAMIX brand) not switching views when clicked.

### Root Cause & Fix Applied
- **Root Cause**: In [packages/client/src/App.jsx](file:///d:/saif/streamix/packages/client/src/App.jsx), `handleNavigate(v)` called `clearSearch()`. Inside `clearSearch()`, `setView("home")` was hardcoded to reset the view to home. As a result, whenever the user clicked Movies, Series, or Settings, `setView(v)` was called, but was immediately overridden by `clearSearch()` back to `"home"`, preventing any navigation from taking effect.
- **Fix**: Separated `resetSearchState()` (aborts pending search queries and resets search results/query) from `clearSearch()`. Updated `handleNavigate(v)` to invoke `resetSearchState()` and then `setView(v)`.
- Rebuilt desktop installer (`packages/desktop/dist/setup.exe` v1.0.10).

### Verification Evidence
- `npm test`: 97/97 tests passing (63 server tests, 34 client tests).
- `npm run build --workspace=packages/client`: Clean Vite production build completed in 250ms.
- `npm run package:desktop`: Successfully generated updated `packages/desktop/dist/STREAMIX Setup 1.0.10.exe` and mirror `dist/setup.exe`.

---

## Player Controls Auto-Hide & Mouse Hover Re-appearance Fix (COMPLETED)

### Objective
Fix video playback controller auto-hide behavior so that:
1. When video plays, the controller disappears after delay, but immediately reappears whenever the mouse is hovered/moved over the video surface or window.
2. The controller stays visible while the user hovers over the control bars (timeline seekbar, buttons, volume, tracks).
3. When the controller appears or disappears, the video canvas maintains constant full dimensions without resizing, shifting, or jumping.

### Root Causes & Fixes Applied
1. **Desktop Native MPV Surface Message Interception (`packages/desktop/src/video-host.cs`):**
   - In desktop mode, `mpv.exe` runs inside `StreamixVideoSurface` with `--wid`. Win32 `WM_MOUSEMOVE` messages were consumed by the MPV child window and never delivered to `CustomWndProc`.
   - **Fix:** Added cursor position tracking via `GetCursorPos(out curPt)` inside the 30ms `WM_TIMER` loop of `video-host.cs`. When the cursor moves within the video bounds `(lastScreenX, lastScreenY, lastTargetW, lastTargetH)` by >= 2px, it immediately emits `{"event":"mousemove"}` and wakes up the controls. Also added left-click state tracking via `GetAsyncKeyState(0x01)`.
   - Recompiled `streamix-video-host.exe` with `csc.exe`.
2. **Artificial 400ms Lockout & High Movement Threshold (`packages/client/src/components/Player.jsx`):**
   - `handleMouseMove` had an arbitrary `lastHideTimeRef.current < 400` lockout and a `>= 4px` delta filter that swallowed user hover movements after controls hid.
   - **Fix:** Removed the 400ms lockout. Configured `minDelta = controlsVisible ? 2 : 1` so that any intentional movement immediately reveals hidden controls.
3. **Controls Hover Persistence (`packages/client/src/components/Player.jsx`):**
   - Previously, the hide timer hid the controls even while the user was hovering over or interacting with the timeline, volume slider, or track selectors.
   - **Fix:** Added `isHoveringControlsRef` and attached `onMouseEnter`/`onMouseLeave` handlers to `.player-top` and `.player-bottom`. The controls will never hide while the mouse is hovering over them.
4. **Window-Level Mouse Movement Listener (`packages/client/src/components/Player.jsx`):**
   - Added global `window.addEventListener("mousemove", onWindowMove, { passive: true })` so moving the mouse anywhere across the player window immediately brings up the controls.
5. **Fixed Canvas Sizing Maintained (`packages/client/src/index.css` & `packages/client/src/components/Player.jsx`):**
   - Verified `.player-desktop-canvas` and `.player-video` remain `position: absolute; inset: 0; width: 100%; height: 100%`.
   - Controls float as absolute overlays on top (`z-index: 10`) with opacity transitions, guaranteeing 0% resize or shift of the video canvas.

### Verification Evidence
- `npm test`: 97/97 tests passing (63 server tests, 34 client tests).
- `npm run build --workspace=packages/client`: Clean Vite production build completed in 246ms.
- `streamix-video-host.exe`: Successfully recompiled with `csc.exe`.
- `npm run package:desktop`: Successfully generated updated `packages/desktop/dist/STREAMIX Setup 1.0.9.exe` and mirror `dist/setup.exe`.

---

## Streamix Desktop — Complete Extension-Based Architecture Migration (COMPLETED)

### Objective
Transform Streamix Desktop into a fully extension-driven streaming application where:
- TMDB powers the home catalog, title metadata, search, and live search suggestions.
- A single extension repository URL (`https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/main/repository/repository.json`) discovers all available providers.
- Users choose which providers to download and install. Installed providers auto-enable and feature real Enable/Disable toggles.
- All movie, series, and anime source discovery/extraction is delegated strictly to enabled, installed extensions.
- The hardcoded VegaMovies implementation and fallbacks are completely removed from the core codebase.
- A live diagnostic log is embedded at the bottom of Settings.

### Files Modified & Created
1. **Server Extensions Architecture (`packages/server/src/extensions/`):**
   - `errors.js`: Standard extension error hierarchy (`ExtensionError`, `ItemNotFoundError`, `SourceUnavailableError`, `ExtensionTimeoutError`).
   - `diagnostics.js`: Bounded circular buffer (`DiagnosticBuffer`, `diagnosticLogger`) with automatic secret/token/cookie redacting, log level filtering, search, and clear.
   - `sdk.js`: Runtime implementations of Streamix Extension SDK helpers (`searchCinemeta`, `fetchCinemetaMeta`, `CINEMETA_BASE_URL`, `getLatestDynamicUrls`, `getProviderBaseUrl`, `DEFAULT_FALLBACK_URLS`, `extractImdbId`, HTML decoding, `extractHubCloudSources`, `extractGdflixSources`, `extractDriveleechSources`).
   - `runtime.js`: In-memory ZIP package unpacker (`fflate`), sandboxed runner (`sucrase`) with isolated console, storage shim, fetch wrapper, and execution of `initialize()`, `search()`, `getDetails()`, `resolveSources()`.
   - `manager.js`: Full `ExtensionManager` with single-URL repository discovery (`repository.json` -> `plugins.json`), disk persistence (`data/extensions/` and `data/extensions-config.json`), SHA-256 and byte-size package integrity verification, install, auto-enable, enable/disable toggles, enableAll, disableAll, uninstall, and extension-only `resolveSources()`.
   - `routes.js`: Express router exposing `/api/extensions/repository` (GET/POST/DELETE), `/api/extensions/catalog`, `/api/extensions/installed`, `/api/extensions/install`, `/api/extensions/uninstall`, `/api/extensions/toggle`, `/api/extensions/toggle-all`, `/api/extensions/logs`, `/api/extensions/logs/clear`.
2. **VegaMovies Removal & Provider Clean-up:**
   - Deleted `packages/server/src/providers/vegamovies.js` and `vegamovies.test.js`.
   - Removed `VegaMoviesProvider` import and registry entry from `packages/server/src/providers/index.js`.
   - Removed hardcoded `resolveByTitle` fallback from `packages/server/src/providers/extractor.js`.
   - Cleaned `search.test.js` and `extractor.test.js` of VegaMovies references.
3. **Core Server Wiring:**
   - `packages/server/src/providers/extractor.js`: Wired `extensionManager.resolveSources(...)` for all title extractions; honest failure reporting when no extension returns a stream.
   - `packages/server/src/routes/search.js`: Added `/api/search/suggestions` endpoint backed by TMDB autocomplete; updated `/api/search` to prioritize TMDB title results and log to `diagnosticLogger`.
   - `packages/server/src/index.js`: Mounted `extensionsRouter` under `/api`, wired `extensionManager` into `createResolver`, and initialized `extensionManager.start()` at server boot.
4. **Client Settings, Navigation & Search UI:**
   - `packages/client/src/api.js`: Added client methods for repository, catalog, install, uninstall, toggles, logs, and live suggestions.
   - `packages/client/src/components/Settings.jsx`: Complete Extension Management & Live Logs screen:
     - Repository URL input (prefilled with lab URL), Connect, Refresh, and Remove actions.
     - Installed Providers list with operational status badges, Enable/Disable toggles, Enable All, Disable All, and Uninstall.
     - Available Providers Catalog with live filter input and [Install] buttons with progress indicator.
     - Collapsible "Runtime Diagnostics / Live Logs" console with level filter tabs (ALL, INFO, WARN, ERROR, DEBUG), text search, Pause/Resume toggle, Copy to clipboard, Export JSON, and Clear logs.
   - `packages/client/src/components/Navbar.jsx`: Added "Settings" navigation button and wired `onSelectSuggestion`.
   - `packages/client/src/components/SearchBox.jsx`: Replaced with debounced live suggestions dropdown showing poster thumbnail, release year, media badge (Movie / TV Series), rating, keyboard navigation (ArrowUp, ArrowDown, Enter, Esc), mouse selection, and click-outside dismissal.
   - `packages/client/src/App.jsx`: Added `view === "settings"` handling and wired suggestion selection to `openDetail`.
   - `packages/client/src/components/Player.jsx`: Added `postClientLog` event forwarding on stream handoff.
   - `packages/client/src/index.css`: Added complete Netflix-dark styling for Settings, Extensions, and Search Suggestions.

### Exact Commands Run & Observed Results
1. `npm test --workspace=packages/server`:
   - Output: 63/63 passing tests across 12 test suites (0 failures).
2. `npm run build --workspace=packages/client`:
   - Output: Vite production build completed in 245ms with 0 errors.
3. `npm run health` (`node scripts/healthcheck.mjs`):
   - Output: `[healthcheck] ok: true (version: 1.0.0, uptime: 3.12s)` — HTTP 200 OK.
4. Repository discovery verification (`POST /api/extensions/repository`):
   - Command: `Invoke-RestMethod -Uri "http://localhost:4000/api/extensions/repository" -Method POST -Body '{"url":"https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/main/repository/repository.json"}'`
   - Output: Repository connected successfully: "Streamix Official Extension Repository", discovered 6 providers: `org.streamix.provider.bollyflix`, `org.streamix.provider.cinestream`, `org.streamix.provider.moviesdrive`, `org.streamix.provider.moviesmod`, `org.streamix.provider.sample`, `org.streamix.provider.vegamovies`.
5. Package download and integrity check verification (`POST /api/extensions/install`):
   - Installed `org.streamix.provider.sample` and `org.streamix.provider.cinestream`.
   - Output: Packages downloaded, verified against repository SHA-256 and byte sizes, unpacked into memory, initialized, auto-enabled, and persisted to `data/extensions-config.json`.
6. Enable / Disable toggle verification (`POST /api/extensions/toggle`):
   - Toggled enabled status and verified runtime `getEnabledProviders()` updates immediately.
7. TMDB search suggestions verification (`GET /api/search/suggestions?q=inception`):
   - Returned 6 real TMDB items with poster paths, release years, and media types.
8. Extension-only stream resolution & playback verification:
   - `POST /api/stream/movie/10378?mode=native` (Big Buck Bunny) returned genuine playable HLS stream from `org.streamix.provider.sample`.
   - `POST /api/stream/movie/133701?mode=native` (Tears of Steel) returned genuine playable HLS stream from `org.streamix.provider.sample`.
   - Verified that when no extension returns a stream, honest 404/502 error is returned with zero fallback to bundled code.
9. Runtime Diagnostics / Live Logs verification (`GET /api/extensions/logs`):
   - Logs captured real-time events across search, provider extraction, and stream delivery with sensitive keys/tokens automatically redacted.
10. Desktop setup installer rebuild (`npm run package:desktop`):
    - Output: Exit code 0, successfully generated `packages/desktop/dist/STREAMIX Setup 1.0.8.exe` and mirror `dist/setup.exe`.

---

## Streamix Extension & Playback Pipeline Diagnosis & Fix (COMPLETED)

### Objective
Diagnose and fix the video playback pipeline in the Streamix Extension & Playback Tester where repository connection, catalog, and search worked, but zero videos played across providers.

### Execution Path Tracing & Root Causes Identified
1. **React Lifecycle Teardown Loop in `VideoPlayer.tsx` (Common Failure O):**
   - In `VideoPlayer.tsx`, `useEffect` depended on `reportSignals`, which in turn depended on player state (`resolution`, `audioTracks`, `hasFramesProgressed`, `errorMessage`).
   - As soon as video metadata loaded or time updated, `setResolution` or `setAudioTracks` triggered, creating a new `reportSignals` reference.
   - `useEffect` re-triggered and ran `destroyPlayers()`: it destroyed Hls.js, stripped `src` via `videoRef.current.removeAttribute('src')`, and called `load()`, killing the player within milliseconds of loading.
   - **Fix:** Switched to stable `onSignalsUpdateRef` and scoped `useEffect` dependencies solely to `[currentSource?.url, currentSource?.format, allowEmbedIframe, autoPlay, destroyPlayers]`.
2. **Forbidden Request Headers in Browser Fetch & XHR (Common Failures S & Q):**
   - In `VideoPlayer.tsx` (`xhrSetup`) and `provider-runtime.ts` (`checkSourceAccessibility`), `currentSource.headers` (containing `'User-Agent': 'StreamixExtensionLab/1.0.0'`) was being set directly via `xhr.setRequestHeader()` and `fetch({ headers })`.
   - In browser security, `User-Agent`, `Referer`, `Cookie` are forbidden request headers. Setting them triggers a CORS preflight (`OPTIONS`) with `Access-Control-Request-Headers: user-agent`.
   - Cross-origin CDNs (including Mux `test-streams.mux.dev`) do not allow `user-agent` in CORS preflight, causing the browser to immediately block the stream with `BLOCKED BY CORS`.
   - **Fix:** Filtered out `FORBIDDEN_BROWSER_HEADERS` in both `VideoPlayer.tsx` and `provider-runtime.ts`.
3. **`<video crossOrigin="anonymous">` Forcing CORS on Direct Media (Common Failure N):**
   - `crossOrigin="anonymous"` was hardcoded on `<video>`, causing the browser to enforce CORS on direct media files that would otherwise play cleanly as opaque media.
   - **Fix:** Removed `crossOrigin="anonymous"` from `<video>`.
4. **Browser Sandbox Missing `Buffer` Polyfill (Common Failure R):**
   - Provider extractors (`sidexfee` in `gdflix.ts`, `extractDoubleAtob` in `hubcloud.ts`) use `Buffer.from(..., 'base64').toString('utf-8')`. In browser environments, this throws `ReferenceError: Buffer is not defined`.
   - **Fix:** Provided safe sandboxed `Buffer` polyfill inside `provider-runtime.ts`'s `runnerFn`.
5. **Series `episodeId` Omission & Dropdown in `PlaybackLab.tsx` (Common Failures A & C):**
   - For series/multi-episode results, `resolveSources` was called without `episodeId`, passing the article webpage URL to provider extractors instead of the episode stream link.
   - **Fix:** Added episode selector in `PlaybackLab.tsx` and passed `episodeId`, `seasonNumber`, `episodeNumber` to `resolveSources`.
6. **14-Point Playback Diagnostics Matrix (Phase 2):**
   - Integrated full 14-point trace into `PlaybackLab.tsx` and `VideoPlayer.tsx` covering provider metadata, search result, extraction method invocation, source counts, field names, sanitized URL, resource nature, playback engine, header availability, error observing, player lifecycle events, and active currentTime progression.

### Verification Evidence
- `npm run build`: Clean production build (`tsc && vite build`) passing in 3.33s.
- `npm test`: 12/12 unit and integration tests passing (`tests/e2e-playback-pipeline.test.ts`, `tests/repository-service.test.ts`, `tests/runtime-verification.test.ts`).

---



### Summary of Completed Deliverables
1. **Zero Impact on Root App:**
   - Work conducted exclusively in `streamix-repository-tester/`.
   - Main Streamix Desktop (`packages/client`, `packages/desktop`, `packages/server`) remained completely untouched.
2. **Provider Runtime & Execution Sandbox (`src/services/provider-runtime.ts` & SDK):**
   - Unpacks `.streamix-ext` ZIP archives in-memory using `fflate.unzipSync` directly from downloaded package Blobs / ArrayBuffers.
   - Validates `manifest.json` schema and semver API compatibility.
   - Built a secure in-browser sandboxed module loader: transpiles provider TypeScript on demand using `sucrase` and dynamically maps SDK dependencies (`@streamix/sdk`, `../../../sdk/src/index.ts`, relative fixtures).
   - Isolates provider code from host page DOM and secrets, providing sandboxed logger, namespaced storage, and monitored fetch.
3. **Real Movie & Series Search Interface (Phase 3):**
   - Interactive search panel allowing selection of any repository provider.
   - Executes real `provider.search(query)` returning real metadata, poster URLs, and IDs.
   - For CineStream: queries live Cinemeta catalog (`https://v3-cinemeta.strem.io/catalog/movie/top/search=...json`).
   - For Sample Provider: searches real open Creative Commons fixtures (Big Buck Bunny, Tears of Steel, Sintel, etc.).
4. **Real Source Extraction (Phase 4):**
   - Implemented real `provider.resolveSources({ mediaId })`.
   - Comprehensive source classification: HLS (`.m3u8`), direct MP4 (`.mp4`), direct WebM (`.webm`), MPEG-DASH (`.mpd`), Non-native MKV (`.mkv`), and Embed Webpages.
   - Detects and reports in-stream or declared multi-audio tracks and subtitles without leaking sensitive tokens or headers.
5. **Integrated Video Player (Phase 5):**
   - Built modern custom video player supporting:
     - Native HTML5 `<video>` for direct MP4 and WebM.
     - `HLS.js` (`hls.js`) for adaptive bitrate `.m3u8` streams.
     - `DASH.js` (`dashjs`) for MPEG-DASH streams.
     - Strict opt-in isolated iframe sandbox for embed webpage sources (disabled by default; never automatic).
   - Features play/pause, seekbar, volume/mute, fullscreen, source selector, multi-audio track switcher, and subtitle track switcher.
   - Real-time browser media error reporting (`MEDIA_ERR_SRC_NOT_SUPPORTED`, `MEDIA_ERR_NETWORK`, `MEDIA_ERR_DECODE`, `BLOCKED BY CORS`).
6. **Detailed Playback Verification Pipeline (Phase 6 - Stages A to K):**
   - Tracks distinct verification stages:
     - **A. Provider Initialization**: Provider instance initialized via `runner.initialize()`.
     - **B. Movie Search**: Real search query executed, returned results array.
     - **C. Details Retrieval**: `getDetails(id)` executed, returned title and metadata.
     - **D. Source Extraction**: `resolveSources(...)` executed, returned sources list.
     - **E. Source Network Accessibility**: Pre-flight HTTP range/HEAD request (verifies HTTP 206 / 200).
     - **F. Player Initialization**: Player attached to video DOM element.
     - **G. Video Metadata Loaded**: `loadedmetadata` event fired (`video.videoWidth > 0` or `video.duration > 0`).
     - **H. Playback Started**: `play` / `playing` event fired (`!video.paused`).
     - **I. Video Frames Progressing**: Active frame progression confirmed by delta `currentTime2 - currentTime1 > 0.3s` across consecutive `timeupdate` events while video is unpaused.
     - **J. Audio Output / Track Detection**: Verifies presence of audio tracks (via `hls.audioTracks` or HTML5 `video.audioTracks`).
     - **K. Playback Stability**: 3-second continuous playback observation window without stall.
   - Granular status codes: `PASS`, `FAIL`, `BLOCKED BY CORS`, `UNSUPPORTED FORMAT/CODEC`, `DRM PROTECTED`, `NETWORK ERROR`, `TIMEOUT`, `NOT TESTED`.
7. **Provider Diagnostic Matrix & Export (Phase 7 & 8):**
   - Side-by-side dashboard tab comparing all 6 providers across test stages.
   - On-demand single provider test runner with cancellation support.
   - Export full JSON diagnostic report and matrix report.
8. **Verification Evidence:**
   - 11 unit and integration tests passing (`npm test`):
     - `tests/repository-service.test.ts` (7 tests)
     - `tests/runtime-verification.test.ts` (2 tests: Sample & CineStream package unpack & search)
     - `tests/e2e-playback-pipeline.test.ts` (2 tests: Stages A through E, source classification, audio track detection)
   - Live GitHub verification: `npm run test:live` (6/6 packages verified 100% against GitHub repo).
   - Clean production build: `npm run build` (`tsc && vite build`) passing with zero errors.

---

## Streamix Repository Tester Web Application (COMPLETED)

### Objective
Build a standalone developer web application called "Streamix Repository Tester" in `streamix-repository-tester/` to test and validate the Streamix extension repository workflow completely independently from the main Streamix Desktop application.

### Summary of Completed Deliverables
1. **Isolated Project Setup (`streamix-repository-tester/`):**
   - Built a separate, standalone web application using Vite 6 + React 19 + TypeScript 5 in `streamix-repository-tester/`.
   - Zero modifications to the main Streamix application (`packages/client`, `packages/desktop`, `packages/server`).
2. **Repository Service (`src/services/repository-service.ts`):**
   - Implemented `resolveUrl()` to resolve relative catalog and package URLs against repository URLs.
   - Implemented `fetchRepositoryManifest()` and `discoverCatalogUrl()` to discover `plugins.json` from `repository.json`.
   - Implemented `fetchCatalog()` to parse and validate provider entries.
   - Implemented `computeSha256()` via the standard Web Crypto API (`crypto.subtle.digest`).
   - Implemented `validatePackage()` providing real byte-count checks, SHA-256 hash checks, HTTP availability, and package Blob preparation for local download.
3. **Responsive UI Dashboard (`src/App.tsx` & Components):**
   - **Header**: Live connection status badge (`Not Connected`, `Connecting`, `Connected`, `Error`).
   - **Connection Panel**: Prefilled with `https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/main/repository/repository.json`, localStorage persistence, and connect/refresh controls.
   - **Repository Summary**: Displays repository ID, name, version, manifest contract version, discovered catalog URL, and extension count.
   - **Provider Catalog**: Interactive card grid with search by name/ID, language filter, content-type filter, and sorting.
   - **Batch Validation**: "Validate All Providers" button with throttled concurrency, progress bar, per-provider status pills (`Verified`, `Mismatch`, `Error`), and cancellation via `AbortController`.
   - **Provider Details Modal**: Deep inspection of metadata, copyable package URLs, expected vs actual SHA-256 and byte sizes, and local `.streamix-ext` package save button.
   - **Diagnostic Console**: Timestamped collapsible event log with severity filtering and log copy.
   - **Raw Metadata Viewer**: Collapsible JSON viewers for `repository.json`, `plugins.json`, and selected provider data.
4. **Testing & Live Verification:**
   - Unit tests (`tests/repository-service.test.ts`): 7/7 passing in 131ms covering URL resolution, catalog discovery, schema validation, SHA-256 hashing, size checks, and error handling.
   - Live GitHub verification (`tests/live-repo-verification.ts`): All 6 providers (`BollyFlix`, `CineStream`, `MoviesDrive`, `Moviesmod`, `Streamix Open Lab Fixture Provider`, `VegaMovies`) downloaded live from `https://raw.githubusercontent.com/...`, verified exact byte counts, and matched cryptographic SHA-256 hashes 100% (6/6 Passed, 0 Failed).

### Verification Evidence
- `npm test`: 7/7 passed.
- `npm run test:live`: 6/6 passed live against GitHub repository packages.
- `npm run build`: `tsc && vite build` succeeded in 763ms.
- Dev server running on `http://localhost:5180/`.

---

## Streamix Extension Lab: Centralized One-URL Repository Architecture (COMPLETED)

### Objective
Establish a centralized single-URL extension repository discovery architecture for Streamix Desktop, allowing users to enter one repository manifest URL (`repository.json`), discover the complete provider catalog (`plugins.json`), and download/verify native `.streamix-ext` packages (including CineStream, Bollyflix, MoviesDrive, Moviesmod, VegaMovies, and Sample Fixture) with automatic provider discovery.

### Summary of Completed Deliverables
1. **One-URL Repository Contract (`repository/repository.json` & Schemas):**
   - Established official repository manifest specification linking to the provider catalog via `pluginLists: ["plugins.json"]` and `pluginsUrl: "plugins.json"`.
   - Created `schemas/repository-manifest.schema.json` formalizing `repository.json` structure with reverse-DNS ID, name, version, and catalog pointers.
   - Updated `schemas/repository-index.schema.json` to permit `pluginLists` and `pluginsUrl` on repository metadata.

2. **Native SDK Repository Discovery Client (`sdk/src/repository.ts`):**
   - Implemented `resolveUrl(baseUrl, relativeOrAbsolute)` supporting relative and absolute paths across HTTP, HTTPS, and local filesystems.
   - Implemented `validateRepositoryManifest` and `assertValidRepositoryManifest`.
   - Implemented `discoverCatalogUrl(repoManifest, repoManifestUrl)`.
   - Implemented `fetchRepositoryManifest` and `fetchRepositoryCatalog` for single-URL discovery.
   - Implemented `resolvePackageUrl` and `verifyAndLoadPackage` with SHA-256 integrity validation and API compatibility checks.
   - Exported in `sdk/src/index.ts`.

3. **Repository Builder Enhancements (`tools/repo-builder.ts`):**
   - Added automatic provider discovery across `packages/` and `examples/`.
   - Automatically validates provider manifests and builds missing `.streamix-ext` packages via `packageExtension()`.
   - Calculates cryptographic SHA-256 hashes and file sizes for all packages.
   - Maintains synchronized `repository/repository.json` and `repository/plugins.json`.

4. **Automated Test Suite Expansion (`tests/repository-index.test.ts`):**
   - Added 6 new test scenarios covering:
     - Repository manifest validation (valid and invalid structures)
     - Relative and absolute URL resolution
     - Catalog discovery from repository manifest
     - One-URL discovery of all 6 published providers
     - Malformed and missing catalog error handling
     - Automatic packaging and indexing of future providers upon rebuild
   - All 62 test cases passed with 0 failures in 799ms.

5. **Documentation Updates:**
   - Updated `README.md` with complete One-URL architecture diagrams, hosting instructions, and discovery flow.
   - Updated `docs/STREAMIX_INTEGRATION_SPEC.md` to specify `repository.json` as the input in the Settings panel.

### Verification Results
- **TypeScript Type Checking:** `npm run build:sdk` -> `tsc --noEmit` exited 0.
- **Automated Test Suite:** `npm test` -> 62/62 tests passing across 5 suites in 799ms.
- **Full Verification Pipeline:** `npm run check` -> build, test, package all 6 extensions, and repo build exited 0.
- **Git Push:** Committed (`3a0e7ee`) and pushed to `https://github.com/Swagsaiiff/streamix-extension-lab` on `main`.

---

## Streamix Extension Lab: Independent Native Desktop Ecosystem Refactoring (COMPLETED)

### Objective
Refactor `streamix-extension-lab/` into a fully independent Streamix Desktop extension ecosystem, removing the Android/Kotlin/Gradle `cloudstream-compatible/` subproject, CloudStream-specific packaging/publishing instructions, and unverified embed URL fallbacks, while preserving accurate upstream author attribution and establishing strict native Streamix Desktop stream validation.

### Summary of Completed Deliverables
1. **Removed CloudStream Android Subproject:**
   - Deleted `streamix-extension-lab/cloudstream-compatible/` completely (including all Android/Kotlin Gradle modules for Bollyflix, CineStream, MoviesDrive, Moviesmod, VegaMovies, Gradle wrappers, `.cs3` build outputs, and `.github/workflows/build-cloudstream.yml`).
   - Removed `verify:cloudstream` and related npm scripts from `package.json`.
   - Updated `npm run check` to execute only native Streamix SDK type checking, test suites, packaging, and repository generation.

2. **Corrected Manifests & Repository Metadata:**
   - Updated `homepageUrl`, `repositoryUrl`, and `author.url` across `examples/sample-provider/manifest.json`, `packages/*/manifest.json`, `tools/repo-builder.ts`, `repository/repository.json`, and `repository/plugins.json` to point to `https://github.com/Swagsaiiff/streamix-extension-lab`.
   - Preserved accurate GPLv3 author attribution (`megix / Streamix Team`, Saurabh Kaperwan) without operational coupling.

3. **Enforced Honest Stream Resolution (No Embed Fallbacks):**
   - Added `isVideoStreamUrl(url: string)` utility to SDK (`sdk/src/extractors/html.ts`) ensuring HTML web pages, ad redirectors, and embed URLs are never treated as direct video sources.
   - Refactored `CineStream` (`packages/cinestream/src/index.ts`): removed the fake embed URL fallback (`vidsrc.me/embed/...`) that previously claimed embed pages were direct HLS streams. Now correctly throws `SourceUnavailableError` when direct video streams cannot be extracted. Added test verification for this error behavior.
   - Applied `isVideoStreamUrl` checks to `bollyflix`, `moviesdrive`, `moviesmod`, and `vegamovies` stream resolvers.

4. **Updated Documentation & Verification Tables:**
   - Updated `README.md`, `docs/EXTENSION_GUIDE.md`, and `docs/SECURITY_AND_EXECUTION_MODEL.md` to remove all `.cs3`, Gradle, and CloudStream app installation instructions.
   - Replaced unverified "Live tested" claims in documentation tables with honest status reporting: "TypeScript build & fixtures passed; direct streams only; live extraction unverified".

5. **Regenerated Packages & Repository Index:**
   - Rebuilt all 6 `.streamix-ext` packages (`sample`, `bollyflix`, `cinestream`, `moviesdrive`, `moviesmod`, `vegamovies`) and synced to `repository/packages/`.
   - Regenerated `repository/plugins.json` and `repository/repository.json` with updated SHA-256 hashes and file sizes.

### Verification Results
- **TypeScript Type Checking:** `npm run build:sdk` -> `tsc --noEmit` exited 0.
- **Automated Test Suite:** `npm test` -> 57/57 tests passing across 5 suites (including new CineStream embed rejection test) in 854ms.
- **Full Verification Pipeline:** `npm run check` -> built SDK, passed all 57 tests, packaged all 6 extensions into `.streamix-ext`, and regenerated repository index cleanly with exit code 0.
- **Repository Audit:** Grep search confirmed zero `.cs3`, zero Gradle wrappers, zero Android build files, and zero runtime CloudStream dependencies.
- **Git Push:** Committed (`f40a7ac`) and pushed to `https://github.com/Swagsaiiff/streamix-extension-lab` on `main`.

---

## Streamix Extension Lab: Port All CSX Providers to Native Streamix Extension System (COMPLETED)

### Objective
Port all provider implementations published in the CSX repository (`Bollyflix`, `CineStream`, `MoviesDrive`, `Moviesmod`, `VegaMovies`) into the independent, native TypeScript Streamix extension ecosystem inside `streamix-extension-lab/`.

### Summary of Completed Deliverables
1. **Isolated Ecosystem Architecture (`streamix-extension-lab/`):**
   - Strictly isolated inside `streamix-extension-lab/`. Zero modifications made to root Streamix desktop application, existing providers, or dependencies.
   - Built 5 distinct native Streamix extension packages conforming to `StreamixExtension` TypeScript SDK and `schemas/extension-manifest.schema.json`.

2. **Ported Native Provider Packages (`packages/`):**
   - **`packages/bollyflix/` (`org.streamix.provider.bollyflix` v1.0.0)**:
     - Upstream source: `com.megix.BollyflixProvider` (GPLv3).
     - Capabilities: Dynamic domain resolution (`urls.json`), search parsing from `<article>` cards, Cinemeta IMDb metadata enrichment, multi-season & episode parsing, Sidexfee bypass (`web.sidexfee.com`), GDFlix / FastDL multi-server stream extraction.
   - **`packages/cinestream/` (`org.streamix.provider.cinestream` v1.0.0)**:
     - Upstream source: `com.megix.CineStreamProvider` (GPLv3).
     - Capabilities: Cinemeta & Stremio movie & series catalog search, rich metadata with posters/backdrops/genres/IMDb rating, full season & episode breakdown, multi-source stream resolution.
   - **`packages/moviesdrive/` (`org.streamix.provider.moviesdrive` v1.0.0)**:
     - Upstream source: `com.megix.MoviesDriveProvider` (GPLv3).
     - Capabilities: Direct JSON search (`/search.php?q=`) with TMDB thumbnails and IMDb ID mapping, Cinemeta metadata enrichment, HubCloud and GDFlix multi-server extraction (`extractDoubleAtob`, Pixeldrain, FSL Server, BuzzServer, Cloud download).
   - **`packages/moviesmod/` (`org.streamix.provider.moviesmod` v1.0.0)**:
     - Upstream source: `com.megix.MoviesmodProvider` (GPLv3).
     - Capabilities: Article card search parsing, Cinemeta metadata integration, base64 URL redirect decoding, Driveleech / Driveseed / GDFlix multi-server stream extraction.
   - **`packages/vegamovies/` (`org.streamix.provider.vegamovies` v1.0.0)**:
     - Upstream source: `com.megix.VegaMoviesProvider` (GPLv3).
     - Capabilities: Dual search pipeline (JSON hits API with fallback to `/?s=` HTML search), Cinemeta metadata enrichment, V-Cloud / HubCloud / GDFlix multi-server stream extraction.

3. **Shared SDK Extractor Library (`sdk/src/extractors/`):**
   - `urls.ts`: Dynamic mirror URL resolver with in-memory caching and fallback domains.
   - `html.ts`: Zero-dependency HTML parsing helpers (tags, attributes, text extraction, IMDb ID extractor, quality parser).
   - `cinemeta.ts`: Stremio Cinemeta metadata client for movies and series.
   - `hubcloud.ts`: HubCloud and V-Cloud link extractor.
   - `gdflix.ts`: GDFlix, FastDL, and Sidexfee bypass extractor.
   - `driveleech.ts`: Driveleech, Driveseed, and base64 URL parameter decoder.

4. **Native Streamix Repository Generation (`repository/`):**
   - Built all 5 provider packages + reference sample package into `.streamix-ext` distribution archives.
   - Generated `repository/plugins.json` and `repository/repository.json` with cryptographic SHA-256 hashes, exact byte sizes, versions, permissions, and download URLs.
   - Verified 100% schema compliance against `schemas/repository-index.schema.json`.

5. **Licensing and Upstream Attribution:**
   - Documented original author (`megix` / Saurabh Kaperwan) and preserved GNU General Public License v3.0 notices in all package manifests, source files, and READMEs.

### Verification Results
- **Type Checking:** `npm run build:sdk` -> `tsc --noEmit` exited 0.
- **Automated Test Suite:** `npm test` -> 56/56 tests passing (5 suites, 56 test cases) in 820ms:
  - `SampleProviderExtension`: 10/10 passing
  - `BollyflixExtension`: 4/4 passing
  - `CineStreamExtension`: 5/5 passing
  - `MoviesDriveExtension`: 4/4 passing
  - `MoviesmodExtension`: 4/4 passing
  - `VegaMoviesExtension`: 4/4 passing
  - Core SDK (manifest validation, API compatibility, normalized models, errors, timeouts, packager integrity, repo index): 25/25 passing
- **Full Verification Pipeline:** `npm run check` -> build, test, package all 6 extensions, and CloudStream verification all succeeded with 0 errors.
- **Git Push:** Committed (`a9b9913`) and pushed to `https://github.com/Swagsaiiff/streamix-extension-lab` on `main`.

---

## TMDB Homepage Catalog Integration (COMPLETED)

### Objective
Make the TMDB API the actual source of STREAMIX's homepage movie and series catalogs (replacing CineStream as the homepage catalog source) while integrating cleanly with the existing application, details modal, search, and native MPV playback pipeline via the VegaMovies title-resolution bridge.

### Summary of Changes
1. **Extended TMDB Service (`packages/server/src/providers/tmdb.js`):**
   - Implemented `TMDBProvider` extending `BaseProvider` with official TMDB endpoints:
     - `trending`: `/trending/movie/week`
     - `popular-movies`: `/movie/popular`
     - `new-releases`: `/movie/now_playing`
     - `top-rated`: `/movie/top_rated`
     - `action`: `/discover/movie?with_genres=28`
     - `comedy`: `/discover/movie?with_genres=35`
     - `horror`: `/discover/movie?with_genres=27`
     - `popular-series`: `/tv/popular`
     - `action-series`: `/discover/tv?with_genres=10759`
     - `anime-airing`: `/discover/tv?with_genres=16&with_origin_country=JP&air_date.gte=...&air_date.lte=...`
     - `anime-trending`: `/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc`
   - Built cached genre maps for movies and TV (`/genre/movie/list` and `/genre/tv/list`).
   - Implemented complete normalized content model (`id: String(tmdbId)`, `tmdbId`, `type`, `title`, `year`, `poster`, `backdrop`, `rating`, `popularity`, `genres`, `provider: "TMDB"`, `source: "TMDB"`).
   - Implemented `getDetails(type, id)` for movies (with cast, director, runtime, genres, rating, overview) and TV series (with bounded concurrent loading of seasons and episodes matching `DetailModal` schema).
   - Maintained full backwards compatibility with `matchesYear`, `mapWithConcurrency`, and `createTmdbEnricher`.

2. **Provider Registry (`packages/server/src/providers/index.js`):**
   - Registered `TMDBProvider` as `"TMDB"` in the provider registry.
   - Updated `listConfiguredProviders` and `createProvider` defaults.

3. **Homepage Routes (`packages/server/src/routes/home.js`):**
   - Connected `GET /api/home` and individual section routes directly to `TMDBProvider`.
   - Replaced CineStream catalog methods with real TMDB discovery endpoints.
   - Per-row deduplication: deduplicates within each section by `${item.type}:${item.tmdbId ?? item.id}` without cross-row cannibalization.
   - Honest error handling: returns actionable HTTP 503 (`missing_tmdb_api_key`) when unconfigured and HTTP 401 (`invalid_tmdb_api_key`) when unauthorized; never silently falls back to CineStream.

4. **Configuration & Desktop App Support (`packages/server/src/config.js` & `packages/desktop/src/local-backend.js`):**
   - Added user data directory config support (`%APPDATA%\streamix-desktop\config.json` or `.env`).
   - Added upward searching for `.env` so development and packaged environments reliably discover keys.
   - Passed `STREAMIX_USER_DATA` and `TMDB_API_KEY` from Electron main process to local backend.

5. **Attribution & UI (`packages/client/src/App.jsx` & `packages/client/src/index.css`):**
   - Added TMDB attribution footer with official TMDB logo SVG and mandatory disclaimer:
     `"This product uses the TMDB API but is not endorsed or certified by TMDB."`
   - Added responsive, styled footer CSS.

6. **Documentation (`.env.example` & `README.md`):**
   - Updated `.env.example` with clear TMDB API key instructions.
   - Updated `README.md` with TMDB catalog configuration guide, desktop configuration instructions, and attribution notice.

### Verification Performed
- **Unit Test Suite:** `npm test` -> 136/136 tests passing (102 server tests + 34 client tests).
- **Client Build:** `npm run build --workspace=packages/client` -> clean Vite build in 338ms.
- **Server Endpoints Test:**
  - `GET /api/home`: returned HTTP 200 with 11 TMDB rows (`trending`, `popular-movies`, `new-releases`, `top-rated`, `action`, `comedy`, `horror`, `popular-series`, `action-series`, `anime-airing`, `anime-trending`), all items populated with `provider: "TMDB"`, `tmdbId`, `year`, `rating`, `poster`, `backdrop`.
  - `GET /api/detail/movie/1288069?provider=TMDB`: returned movie details (Tenzing, 126 min, cast, genres).
  - `GET /api/detail/series/22980?provider=TMDB`: returned series details with 570 episodes across seasons.
- **End-to-End Stream Resolution Bridge:**
  - `POST /api/stream/series/117376?provider=TMDB&season=1&episode=1` (Vincenzo) resolved via title bridge `TMDB` -> `VegaMovies`, finding S01E01 1080p stream with 3 variants (`1080p`, `720p`, `480p`), returning HTTP 201 with created streaming session.
- **Error Handling Verification:**
  - Missing key -> HTTP 503 `configuration_error` (`missing_tmdb_api_key`) with actionable configuration hint.
  - Invalid key -> HTTP 401 `configuration_error` (`invalid_tmdb_api_key`) with verification hint.
- **Electron Automated Desktop Verification:**
  - `npx electron packages/desktop --test-verification`: started local backend with `provider: "TMDB"`, connected to `/api/health`, mounted React UI, rendered 262 cards live from TMDB. Passed with `VERIFICATION_SUCCESS`.

---

## Phase 7: Windows Packaging, Final Testing, and Release Preparation (COMPLETED)

## Multi-provider search, search-result details, and real playback (verified)

## Real-playback bug fix (progressive HLS + remux) and stale provider status

## Three fixes: CineStream real playback, search grid, search relevance

## Intermittent playback failures: root causes and fixes

## Series playback fix + player redesign

## Netflix-style UI and feature upgrade

## Intermittent series playback failures: root cause and fix

## Playback quality: 360p-only complaint fixed (+ genuine multi-quality HLS)

### Root cause of "Don't Come Home only plays at 360p"

- The title page exposes **9 link pages** (`⚡ G-Direct [Instant]`, `⚡ V-Cloud [Resumable]`, `⚡ Batch/Zip`)
  grouped by declared quality: **480p, 720p, 1080p**. Two defects made playback stick to the lowest tier:
  1. `extractLinkPages(...).slice(0, 4)` inspected only the first four link pages, so the 720p/1080p
     tiers were **never seen** (logs showed only 480p tiers considered).
  2. The resolver took the **first** resolvable tier rather than the best one — the 480p tier's
     pixeldrain mirror is a 360p copy, so the player showed 360p even though 1080p existed.
- Also: tiers were not ordered by their declared quality, and top-level `quality` was dropped when the
  resolution came through the CineStream→VegaMovies title bridge.

### Fixes

- `extractLinkPages` now captures the section **heading** and the resolver reads the declared quality
  from it (`declaredQuality("… 1080p WEB-DL …") → 1080`), then inspects **all** link pages (cap 12)
  and orders tiers by declared quality descending.
- Every tier is probed with **ffprobe** (`mediaVariantsFromHost` → `probeHeight`), so selection uses the
  *real* resolution rather than the page label; the best real rendition is chosen and the rest are kept
  as genuine variants (`sortVariantsByQuality` dedupes by height, preferring signed CDN over mirrors).
- `quality`, `variants` and `variantCount` are propagated through `extractor.js` → `routes/stream.js`.
- **Genuine multi-quality HLS**: `createSession(source, { variants })` now builds a real ladder when ≥2
  renditions exist — one FFmpeg input per rendition, one video variant per input, and the primary
  source's audio renditions **shared across all variants** (so audio switching keeps working at every
  quality). `buildMultiVariantMasterPlaylist()` writes the master from ffprobe data. Single-rendition
  sources keep the previous single-variant behaviour, and any multi-variant failure surfaces as a clear
  error (ffmpeg stderr) rather than silent degradation.
- Client: quality options are now ordered **highest-first** while still submitting the real hls.js level
  index; audio options show full language names.

### Live verification (real providers)

| Case | Before | After |
| --- | --- | --- |
| "Don't Come Home" S1E2 (series) | 360p | **1080p** (variants 1080p + 640p) |
| "Dune" (2021) movie | 480p | **2160p (4K)** (variants 2160p / 816p / 804p) |
| Series master playlist | 1 video variant | 1080p + 640p variants + 3 shared audio renditions (hin/eng/tha, 5.1) |
| Player (browser, S1E2) | quality selector disabled "Auto" | selector **enabled**: `Auto / 1080p / 640p`; switching applies the real level (1080p verified); audio `Hindi / English / Thai`; `readyState 4`; 0 page errors |

- `npm run test` → **131/131 pass** (97 server + 34 client) including new tests for declared-quality
  parsing, variant ordering/dedupe, highest-first option ordering, and the retry-without-episode-switch path.
- `npm run build` → OK. Stale HLS workspaces were purged (876 MB → 6 MB, and boot-time purge remains).

### Remaining limitations

- The ladder is capped at 3 renditions and re-encodes only when a rendition is not H.264/AAC (mixed
  tiers fall back to libx264/aac for the whole ladder, reported via `streamMode`).
- If a title only exposes `G-Direct` (fastdl/filebee) tiers with no vcloud links, playback still returns
  an explicit error — those hosts remain non-portable.

### Reproduced failing case

`POST /api/stream/series/tt31158589?provider=CineStream&season=1&episode=1` ("Don't Come Home", 2024) →
`422 … VegaMovies exposes 13 episode link(s) but none resolved to a valid media file for S1E1`.

### Root causes confirmed by tracing each stage

1. **Wrong link tier chosen.** A VegaMovies series page lists several per-quality link pages:
   `⚡ G-Direct [Instant]` (fastdl/filebee mirrors), `⚡ V-Cloud [Resumable]` (resolvable vcloud links),
   `⚡ Batch/Zip` (archives). The resolver picked the **first page that merely had enough links**
   (a G-Direct page with 22 fastdl/filebee anchors) and never used the vcloud page — and fastdl pages
   return an HTML page with **no media and no iframe**, so every candidate failed ffprobe.
2. **Extension-less media URLs were invisible.** The resolvable vcloud token page exposes media as
   plain anchors: `https://pub-….r2.dev/<hash>?token=…` (no file extension) and
   `https://pixeldrain.dev/u/<id>`. The extractor only matched `.mkv/.mp4/.m3u8` patterns, so it
   collected **zero** candidates for these titles. Verified with ffprobe: the pixeldrain
   `/u/<id>` → `api/file/<id>?download` conversion returns real media (h264, 360p).
3. **No distinction between temporary and permanent failures** (a slow host/page was treated the
   same as an invalid URL), and logs carried full signed URLs.

### Fixes (`packages/server/src/providers/vegamovies.js`, `stream.js`, `routes/search.js`)

- Link tiers are now inspected together (`vega.link_page_tiers`): episode resolution **prefers a
  vcloud tier that covers the requested episode**, falls back to other usable hosts, then to the
  largest list; it also queues the same episode index from other vcloud tiers as cross-tier fallbacks.
- `mediaCandidatesFromHtml()` collects extension-matched URLs **plus** non-static anchors on
  token pages, converts `pixeldrain.dev/u|file/<id>` and the `pxl` variable to the pixeldrain
  download API, and keeps genuine signed links (R2/hubcloud) — validated by ffprobe, never assumed.
- `withRetry()` retries **only retryable** failures (timeout/network/5xx) with backoff (max 2 extra
  attempts); permanent errors (404/invalid data/unsupported codec) are not retried. Retries re-probe
  the **same** candidate and never switch episodes.
- Structured, redacted logging: `redactUrl()` strips `token`/`X-Amz-Signature`/`sig`/`expires` etc.
  (`vega.episode_tier_selected`, `vega.episode_link_unresolved`, `vega.episode_tag_mismatch`,
  `vega.media_retry`, `vega.host_media_candidates`, `vega.link_page_failed`).
- Webpages can never be treated as video: candidates are only accepted after ffprobe reports a real
  video stream; HTML responses fail validation and are skipped.
- Search route timeout raised to 20 s (above the provider's 15 s per-request timeout) so a slow
  provider returns partial results instead of being dropped during spikes.
- **Temp/disk leak fixed:** `initHlsDir()` now purges orphaned session workspaces at server boot and
  the reaper window was reduced (30 min max age, 2 min sweep). A live check found **57 stale session
  dirs / ~14 GB**; they are now removed automatically (verified: temp went to 0).

### Verification (live, real providers)

| Case | Result |
| --- | --- |
| Series "Don't Come Home" S1E1 (previously failing) | ✅ `provider_stream`, episode S1E1, remux |
| Series "Don't Come Home" S1E2 / S1E3 | ✅ correct episode (tag/position verified), remux, 3 audio tracks |
| Series "From" S1E1 / S1E5 (previously failing) | ✅ correct episode, remux, 2 audio tracks |
| Series "Vincenzo" S1E1 | ✅ correct episode, remux |
| Movie "Dune" (2021) — consistently working | ✅ remux, 2 audio tracks |
| Movie "Avengers: Endgame", "Demon Slayer: Infinity Castle" (intermittently failing before) | ✅ resolved, R2 media validated |
| HLS master + first segment for a series episode | ✅ `200`, `application/vnd.apple.mpegurl`, `video/mp2t` (182 KB) |

- `npm run test` → **130/130 pass** (97 server + 33 client). New tests: pixeldrain conversion,
  extension-less anchor collection, URL redaction, retryable-vs-permanent classification,
  `withRetry` exhaustion, series retry without episode switching, boot-time workspace purge.
- `npm run build` → OK.

### Multi-quality status (honest)

Each VegaMovies episode/movie resolves to **one** provider rendition, so the player shows that single
real quality (static chip + explanation). The quality selector's multi-level path is verified with a
genuine 2-variant HLS (Auto/360p/720p, manual switching, back to Auto) — options are never invented.
Generating multi-quality variants from the provider's multiple quality tiers would require a
multi-input FFmpeg pipeline; it is documented here and not faked.

### Remaining blockers

- `fastdl.beer` / `filebee.xyz` G-Direct tiers are not portable (embed pages without direct media or
  iframes), so when a title has **only** G-Direct tiers and no vcloud tier, playback returns an
  explicit error rather than a fabricated source.
- Batch/Zip links are archives and are intentionally not used as video.

### 1. Details modal redesign (`DetailModal.jsx` + CSS)

- Cinematic backdrop with gradient fade into the details panel, large poster + title, and badges for year, rating, runtime, episode count and genres.
- Red **Play/Resume** button plus **Start over** when progress exists.
- Real metadata grid: Type, Released, Runtime, Country, Language, Rating, Director, Writer, Cast, Awards — only fields the provider returns (Language is omitted when absent; never invented).
- Series: season selector (only when >1 season) and clickable episode cards with thumbnails, `E<n>`, title, air date, rating and overview. Episode thumbnails lazy-load with a fallback; **clicking an episode opens that exact episode in the player** (verified S1E2 "I Love You").
- Improved close button (rotates on hover), custom thin scrollbars, rounded corners, entrance animation, Escape + focus trap retained, responsive down to mobile.

### 2. Home page expansion (server + client)

- New combined `GET /api/home` returning 11 real rows with cross-row dedupe (no duplicate titles) and per-row ranking notes; existing single-row endpoints kept and a `latest` alias added for compatibility.
- Rows (all verified live): Trending Movies, Popular Movies, New Releases, Top Rated Movies, Action Movies, Comedy Movies, Horror Movies, Popular Series, Action Series, Airing Anime, Trending Anime — sourced from the CineStream cinemeta top catalog, its genre filters, and the Kitsu anime catalogs. Categories the provider cannot back (e.g. Korean Dramas, Recently Added) are intentionally **not** shown.
- 264 cards render across the rows; client falls back to per-row endpoints if the combined call fails.

### 3. Continue Watching + resume (`lib/progress.js`, `ContinueWatching.jsx`)

- Progress is stored per title **and per episode** (`provider:type:id[:sXeY]`) in `localStorage` through a storage-injected abstraction (`createProgressStore`) for future backend swap.
- Saves every ~5s during playback and on pause/seek/unmount/ended; completion (>=95% or within 30s of the end) removes the entry; entries are deduped, capped at 60 and newest-first.
- Continue Watching row with progress bars, remaining time, and **Resume / Start over / Remove**; resume seeks to the saved position once the real duration is known (never beyond the media length).
- Verified: seeded progress → row + bar; Resume → `currentTime 122.3`, toast "Resumed from 2:00"; Start over → entry removed and playback from 0; invalid/expired data ignored.

### 4. Carousel arrows (`Row.jsx`, `lib/carousel.js`)

- Left/right arrows on every row (22 rendered), disabled at the ends, smooth scroll by ~one viewport, hover-visible on desktop and always visible on touch.
- Pointer-drag scrolling with click suppression after a drag; native wheel/trackpad scrolling untouched (no Shift needed); row is keyboard focusable with arrow-key support.
- Verified: right-arrow click scrolled a row from 4 to 1476.

### 5. Player improvements (`Player.jsx`)

- The "Lang" selector is replaced by a **Quality** selector driven by real `hls.levels` (Auto + actual resolutions); when a source exposes only one quality the selector is disabled with the note "Only one quality is available for this source" — no invented 720p/1080p entries.
- Audio selector uses full language names (`hin` → Hindi, `eng` → English, `tha` → Thai, ISO 639-2/B and /T).
- Series: **Play Next** (panel on finish + Next button) loads the following episode in place, keeping per-episode progress; hidden for movies and handled gracefully at the final episode.
- Progress bar/seek, ±10s, volume, speed, fullscreen, spinner, compact error panel with Retry and autohiding controls retained.

### 6. Server: episode-accurate resolution (this upgrade)

- Series pages list host links **in episode order without embedded tags**, so filename-based matching could never find later episodes. Now `resolveStream` enumerates `vcloud` host links in document order and maps the Nth link to episode N (`hostLinkIndexForEpisode`), verifies the resolved media's own `SxxExx` tag when present, and tries neighbours on failure.
- Added `S`eason/`e`pisode pass-through: `POST /api/stream/:type/:id?season=&episode=` → resolver → VegaMovies, plus `episode` in the response.
- Verified live: S1E1, S1E2, S1E3 each resolve to the correct episode (tag-verified), remux mode.

### Verification and tests

- `npm run test` → **119/119 pass** (90 server + 29 client library tests: resume/persistence/completion, language names, quality options, carousel math, episode mapping).
- `npm run build` → OK.
- Browser (Puppeteer + Edge): 11 rows / 264 cards / 22 arrows; arrow scroll works; movie details show 8 real metadata fields; series shows 20 episode cards (thumbnails loading); episode click plays the correct episode with Quality (Auto/720p) and Audio (Hindi/English) selectors; Play Next present; Continue Watching + Resume + Start over verified; **0 page errors**.

### Remaining limitations

- Episode duration is not provided by the provider metadata, so it is not displayed (never invented); series runtime is shown instead.
- Language metadata is often absent for movies, so the Language field is hidden for those titles.
- Korean-Drama / Recently-Added style rows are not shown because the provider exposes no such catalog.
- Quality options depend on what hls.js reports for the current source; single-quality sources show a disabled selector.

### Series failures (e.g. "Legend of the Blue Sea (2016)") — root cause and fix

Inspected the live VegaMovies series page and chain:
- Series pages have **no `dwd-button` anchors** (movie-only). Links sit in quality `<h3>` sections as direct host links: `nexdrive.beer/genxfm…` labelled "⚡ Single Episodes" / "Batch/Zip". Our `HOST_PATTERN` **omitted `nexdrive`**, and `extractDownloadPageLinks` only matched `dwd-button` → zero candidates → "no playable media" → 422.
- Verified the real chain works: series page → `nexdrive` → nested `vcloud` → `atob(atob(...))` token → direct signed media `Legend.Of.The.Blue.Sea.S01E01.480p.Hindi.WEB-DL…mkv` (R2 + workers.dev mirror).
- Nested pages also contain CMS noise (`xmlrpc.php`, `feed`, `wp-json`, `wp-content`); these are now filtered so they cannot consume the candidate budget.

Changes (`vegamovies.js`):
- `HOST_PATTERN` extended (`nexdrive`, `gdflix`, `hubdrive`, `driveseed`, `driveleech`, `drivebot`) and a `NOISE_LINK_PATTERN` filter applied in `extractHostLinks`.
- New `extractLinkPages(html, baseUrl)` returns ordered `{url,label,kind}` link pages for **both** layouts (`dwd-button` movie downloads and series host links), noise-filtered.
- `resolveStream` now uses `extractLinkPages` (limit 4), follows hosts with noise filtering (limit 6), and reports the chosen page section in the note; per-page failures are logged (`vega.link_page_failed`, `vega.link_pages`).
- Logging added earlier retained: `vega.title_search`, `vega.title_candidates`, `vega.extraction_candidates`, `vega.ffprobe_check`, `vega.media_validated`, `vega.resolved`, `vega.candidate_failed`, `vega.extraction_failed`.

Verified live: `POST /api/stream/series/tt5766194?provider=CineStream` → 5.8 s, `provider_stream`, mode `remux`, master 200, segment 200 (48 KB). Browser: series plays — "Real source · VegaMovies", `duration=1244.9 s`, `readyState=4`, no media error.

### Player UI redesign

`Player.jsx` rewritten as a modern streaming overlay with a **working** controller (no decorative controls):
- Cinematic black stage, `object-fit: contain` video, gradient top/bottom overlays.
- Top bar: Back, title, TEST MODE / "Real source · provider" badges, source note (ellipsised, full text on hover).
- Bottom controller: play/pause, −10 s / +10 s, **timeline with buffered + played fill and elapsed/total time**, **volume slider + mute**, **audio-track selector**, **language preference**, **playback speed**, **fullscreen**.
- Controls show on mouse/touch movement and auto-hide after 3 s of inactivity while playing (verified: `visibleOnMove=true`, `hiddenAfterIdle=true`); cursor hides too.
- Loading spinner during resolution; compact centred error panel (max 420 px — not stretched) with **Retry** and Back.
- Keyboard: Space/K play-pause, ←/→ ±10 s, M mute, F fullscreen, Esc back; form fields excluded.
- Session/HLS cleanup preserved (destroy + DELETE session, orphan cleanup on aborted mount).

Fix found during verification: `hls.audioTracks` was read at `MANIFEST_PARSED`, when it is still empty, so the audio selector never rendered. Now subscribed to `Hls.Events.AUDIO_TRACKS_UPDATED` (with `MANIFEST_PARSED` re-sync). Verified in-browser: 2 real tracks (`hin`, `eng`), switching to `eng` keeps playing with no media error. Rendition names no longer duplicate the language (`hin`, not `hin (hin) (hin)`).

### Verification (all observed)

- `npm run test` → **86/86 pass** (added: series host-link collection, noise filtering, `extractLinkPages` movie+series, series chain to validated media, master CODECS output-vs-source, unique rendition names).
- `npm run build` → OK.
- Browser: spinner shown; all controls present and functional (speed → 1.5, volume → 0.3, seek, autohide, Back → modal); audio selector with `hin`/`eng` and successful switch; series and movie titles both play real sources; "War Dogs" (no source) shows the compact error panel with a working Retry and an honest message.

### Remaining blockers

- Titles with no close VegaMovies match by title+year still return an explicit error (no fabrication).
- Series playback uses the first available episode link ("Single Episodes"); full season/episode selection UI is not implemented.
- Non-H.264/AAC sources transcode (slower start; `streamMode` reports it).

### Root cause of the intermittent browser stall (found and fixed)

`buildMasterPlaylist` derived `CODECS` from the **source** probe, so a session that **transcoded** a non-H.264 source (e.g. HEVC) advertised `CODECS="hvc1..."` while the HLS variants were actually H.264/AAC. hls.js parsed the master, found no level it could play (HEVC unsupported in the test browser's MSE), requested no variant, and the player sat at `readyState 0` — an intermittent "some titles play, others do not" failure (remux/H.264 titles played; HEVC-source titles stalled). Fix: `buildMasterPlaylist({ ..., mode })` now advertises the **output** codecs (`avc1.4d401f,mp4a.40.2` when transcoding). Verified: `Inception` (HEVC source, `mode=transcode`) now plays in the browser — `duration=172.05s`, `readyState=4`, `error=null`, full segment chain 200.

### Title-fallback and diagnostics changes

- `vegamovies.js`: `rankTitleCandidates()` scores by normalized title, year and type (type bonus/penalty rather than a hard filter, dedupe by id, cap 5); `resolveByTitle()` now walks candidates **in rank order**, continuing to the next when a candidate's detail fetch, host-chain extraction, or ffprobe validation fails, and returns the first validated source (note records "candidate N of M"); all-candidates-failed raises an aggregated `unsupported` error listing each candidate and reason. Unknown titles still raise an honest `not_found`.
- Structured logs added: `resolve.title_bridge`, `vega.title_search`, `vega.title_candidates`, `vega.extraction_candidates`, `vega.ffprobe_check`, `vega.media_validated`, `vega.resolved`, `vega.candidate_failed`, `vega.extraction_failed`, `vega.title_no_match`, `resolve.title_bridge_failed` (host-only, no signed URLs logged).
- `extractor.js`: bridge attempts are logged; the final unsupported error now includes the title-bridge failure reason; `resolution` carries `matchedBy`, `matchScore`, `matchesTried`.
- Provider-specific ids preserved: cinemeta `tt…` ids are still routed to CineStream, VegaMovies permalinks to VegaMovies (the bridge only runs for ids the requested provider owns, and adapters reject foreign ids with a permanent `unsupported` error rather than retrying).
- Source headers preserved end-to-end (`Referer` from the resolver reaches ffprobe validation and is returned in the resolved source for FFmpeg).

### Verification (live)

- CineStream titles resolved via the title bridge (exact title + year, score 1210): The Batman (2022), Inception (2010), Oppenheimer (2023), Dune (2021 — ranked above Dune 1984), Avengers: Endgame (2019), Spy x Family Code: White (2023). Honest failures: War Dogs (2016) — no VegaMovies match; series (e.g. `tt5766194`) — episode extraction not ported.
- Browser end-to-end: transcoded CineStream title plays (`readyState=4`, `duration=172.05s`, no media error); HLS + audio tracks unchanged.
- `npm run test` → **81/81 pass** (added: transcode-vs-remux CODECS, ranked candidates, next-candidate-on-failure, aggregated all-failed error, honest no-match, bridge success/failure through the resolver).
- `npm run build` → OK. `GET /api/providers/status` → `verifiedRealProviderPlayback=true`, `realPlaybackProviders=["VegaMovies"]`.

### Remaining blockers

- Series episode extraction for VegaMovies still not ported (music/series titles return an explicit error).
- Titles with no close VegaMovies match (by title + year) return an explicit 422.
- Non-H.264/AAC sources transcode (slower start; `streamMode` reports which).

### 1. CineStream titles now play real streams (title bridge)

- **Blocker fixed:** CineStream is metadata-only (no extractor); its ids are IMDb ids, so its titles previously ended in `No real stream source is available`.
- **Implementation:** `VegaMoviesProvider.resolveByTitle({ title, year, type })` searches the real VegaMovies index, scores candidates (`normalizeForMatch`, `scoreTitleMatch`, `pickBestMatch` with `minScore 400`), fetches the matched detail page and runs the existing real extractor chain. `extractor.js` calls it after the per-provider loop when a provider has no extractor, and reports `resolution.status=provider_stream`, `provider=VegaMovies`, `resolution.requestedProvider`, `matchedBy: "title"`, `matchScore`.
- **Verified:** `POST /api/stream/movie/tt1877830?provider=CineStream` (The Batman 2022) → `provider_stream` via VegaMovies title match (score 1120), 13.4 s, 2 audio tracks, mode `transcode`. Honest negative: `POST /api/stream/movie/tt2005151?provider=CineStream` (War Dogs 2016) → 422 because VegaMovies genuinely has no such title (its search returns other "war" films scored < 400) — no fabrication, no fixture.

### 2. Search results: responsive grid (was one horizontal row)

- New `packages/client/src/components/Grid.jsx`; `App.jsx` renders search results with `<Grid>` instead of `<Row>`.
- CSS `.grid`: `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))` with breakpoints at 1024 px (135 px) and 640 px (110 px); `.grid .card` fills the column so poster sizes are consistent.
- **Measured (Puppeteer + Edge, query "batman"):** 1440 px → 8 columns, 900 px → 5 columns, 390 px → 2 columns; card width uniform (~154 px); poster ratio 1.5 (2:3); multiple rows. Homepage rows unchanged.

### 3. Search relevance ranking

- `routes/search.js`: `normalizeTitle` (lowercase, NFKD, strip diacritics + punctuation) and `relevanceScore` (exact 1000 > starts-with 800/750 > word-boundary 600 > all-tokens 450 > contains 350 > token-overlap ≤200) with `rankSearchResults` (score desc, then newer year, then source order). Applied after the multi-provider merge.
- **Verified live:** `q=batman` → "Batman" (1989), "Batman" (1966) first, then prefixes; `q=the batman` → "The Batman" (2022) first; `q=Spider-Man: No Way Home` → exact 2021 entry first despite 40+ variants.

### Tests

- `npm run test` → **74/74 pass** (added relevance/normalization/ranking tests and VegaMovies `normalizeForMatch`/`scoreTitleMatch`/`pickBestMatch` tests; two initial test cases were corrected where the fixture titles genuinely started with the query).
- `npm run build` → OK.

### Remaining playback blockers

- Titles whose name/year do not closely match any VegaMovies post return an explicit 422 (real gap, not a bug).
- Non-H.264/non-AAC sources still transcode (slower start; mode reported).
- VegaMovies series episode extraction still not ported; Bollyflix/MoviesDrive/Moviesmod remain Cloudflare-blocked.

### Reproduced failure

- `POST /api/stream/movie/<vega permalink>?provider=VegaMovies` with the default `.env` (no `STREAMIX_SESSION_MAX_SECONDS`) never returned until a **full VOD transcode** of a 963 MB movie finished: `createSession` awaited FFmpeg exit and `-hls_playlist_type vod` only writes playlists at the end. Play therefore hung on "Resolving stream and preparing HLS..." — the reported blue/stuck state. Verified working earlier only because a 45 s cap env var was set.

### Root causes and fixes (packages/server/src/providers/stream.js)

1. **No progressive playback** → FFmpeg now uses `-hls_list_size 0 -hls_playlist_type event`; `createSession` returns as soon as the video variant playlist and first segment exist (`status: "streaming"`) instead of waiting for process exit; `getMasterPlaylist`/`resolveFile` accept `ready` or `streaming`.
2. **Always re-encoded** → new `pickStreamMode()` remuxes (`-c:v copy -c:a copy`) when video is H.264 and every audio track is AAC, otherwise transcodes (`libx264`/`aac`). Mode and reason are returned by the API (`streamMode`, `streamModeReason`).
3. **Master playlist had no video variant** (the client stall) → with `event` playlists FFmpeg's auto-generated master (`-master_pl_name`) contained only `#EXT-X-MEDIA` audio renditions and **never** a `#EXT-X-STREAM-INF`; hls.js parsed zero levels and never requested the variant playlist (browser showed `readyState: 0`, no variant/segment requests). Fix: drop `-master_pl_name` and write the master ourselves (`buildMasterPlaylist`) from the ffprobe data, including `#EXT-X-STREAM-INF` with BANDWIDTH/RESOLUTION/CODECS/AUDIO.
4. **Duplicate rendition names** → both audio tracks carried the same release-group title, producing two `NAME="VegaMovies.is"` entries; names are now made unique (`<name> (<lang>)`, with a numeric suffix when still duplicated).
5. **ffprobe ignored source headers** → `probeStreams(ffprobePath, url, headers)` now forwards the resolver's headers (Referer/UA) to ffprobe.
6. **Stale `/api/providers/status`** → `routes/providers.js` hardcoded `verifiedRealProviderPlayback: false` and the "no extractor ported" blocker. It now derives the flag and the real-provider list from `getProviderStatuses()` and reports `fixtureFallbackEnabled`.

### Verification (observed)

- `POST /api/stream/movie/<permalink>?provider=VegaMovies`, no cap → session in **7.4-11.8 s**, `status=streaming`, `streamMode=remux`, reason `copy (h264 + aac/aac)`, 2 audio tracks, `resolution.status=provider_stream`.
- Master playlist (immediately after ready): 2 `#EXT-X-MEDIA:TYPE=AUDIO` (unique names, `DEFAULT=YES`/`NO`, `LANGUAGE="hin"`/`"eng"`) + `#EXT-X-STREAM-INF:BANDWIDTH=...,RESOLUTION=856x356,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="group_aud"` → `index_v0.m3u8`.
- Progressive growth: video segments 273 → 590 within 12 s; variant playlist listed 590 `#EXTINF`. `seg_v0_000.ts` 200 `video/mp2t`.
- `GET /api/stream/:sid/status` → `streaming`, `streamMode=remux`, `playlistUrl` present.
- `GET /api/providers/status` → `verifiedRealProviderPlayback=true`, `realPlaybackProviders=["VegaMovies"]`, `fixtureFallbackEnabled=false`.
- Browser (Puppeteer + Edge, real title): badge "Real source - VegaMovies", `video.duration=888.33 s` (the full movie, not the fixture), `currentTime` advancing, `readyState=4`, `error=null`; requests: master → `index_v0.m3u8` → `index_a0.m3u8` → video+audio segments, all `200`.
- `npm run test` → **65/65 pass** (added `pickStreamMode` and `buildMasterPlaylist` unit tests; stream tests accept `ready`/`streaming`). `npm run build` → OK.

### Files changed this round

- `packages/server/src/providers/stream.js` (progressive event HLS, `pickStreamMode`, `buildMasterPlaylist`, header-aware probe, unique rendition names, servable `streaming` state)
- `packages/server/src/routes/stream.js` (`streamMode`/`status` in responses; status endpoint reports mode/stderr)
- `packages/server/src/routes/providers.js` (status derived from providers; fixture flag)
- `packages/server/src/index.js` (pass `fixtureFallback` to providers router)
- `packages/server/src/providers/stream.test.js` (new/updated tests)

### Remaining limitations

- Non-H.264 video or non-AAC audio still requires transcoding (slower start, CPU-heavy); mode is reported so the client can show it.
- Series episode extraction for VegaMovies is still not ported; other CSX providers (Bollyflix/MoviesDrive/Moviesmod) remain Cloudflare-blocked and unimplemented.
- Signed provider URLs expire (~3 h); each play re-resolves (never cached).

### Diagnosed root causes

1. **Search missed titles** — only one provider (CineStream/cinemeta) was searched; the four other CSX providers were never queried. Fixed by adding a second real provider adapter (VegaMovies) and searching all search-capable providers concurrently.
2. **Search-result clicks did not open details** — the search-results `Row` in `App.jsx` was rendered without `onSelect`, so cards had no click handler. Also, details always used the default provider, so a VegaMovies result was looked up by the CineStream adapter (`/api/detail/movie/<permalink>` → 502). Fixed with `onSelect` + a `provider` parameter end-to-end.
3. **Blue screen on Play** — the resolver always fell back to the local test fixture (a solid-blue synthetic clip) and FFmpeg played it, so Play never used a real source. Fixed by implementing a real VegaMovies extractor path and changing the fixture to an explicit, labelled opt-in.

### Provider source inspected and chosen

- Inspected `Bollyflix/BollyflixProvider.kt`, `MoviesDrive/MoviesDriveProvider.kt`, `Moviesmod/MoviesmodProvider.kt`, `VegaMovies/VegaMoviesProvider.kt`, `VegaMovies/Extractors.kt` on CSX `master`.
- **VegaMovies chosen** because its search is a JSON endpoint (`GET {base}/search.php?q=…&page=1`), portable to Node without JS execution; details resolve via the `imdb_id` on the page + cinemeta merge; and its movie link chain reaches a **direct signed media URL**.
- **Bollyflix / MoviesDrive / Moviesmod** are HTML-scrape providers guarded by Cloudflare (`cfKiller` interceptor) and need a browser/anti-bot path — not ported this round (documented blocker, not claimed as supported).
- Base URL is read dynamically from the CSX `Utils/urls.json` (`vegamovies` key) with a known fallback.

### Real playback path (implemented and verified)

`search.php` JSON → detail page (title/poster/`imdb_id`) → `a:has(button.dwd-button)` download pages → host links (`vcloud.beer` etc.) → `atob(atob(...))` token URL → direct signed media URL on Cloudflare R2 (`.mkv`, expiring `X-Amz-Expires`) → validated with ffprobe → existing FFmpeg → HLS pipeline.

Live evidence for "Beast of War (2025)":
- `POST /api/stream/movie/<permalink>?provider=VegaMovies` → `resolution.status=provider_stream`, `provider=VegaMovies`, note "Resolved from VegaMovies (real provider source)", 2 audio tracks, session ready in ~17 s.
- Real master playlist: `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_aud",NAME="audio_1",DEFAULT=YES,LANGUAGE="hin"` + `audio_2 DEFAULT=NO LANGUAGE="eng"` + a 856x356 H.264 video variant (real Hindi/English dual audio). Segment `seg_v0_000.ts` served 200 `video/mp2t` (163 KB).
- Browser journey (Puppeteer + Edge): search "war" → 66 cards (CineStream 54, VegaMovies 12); clicked a VegaMovies card → detail request `?provider=VegaMovies` → modal "Beast of War · 2025 · 5.4 · Action, Biography, Drama"; Play → badge "Real source - VegaMovies"; `video.currentTime=3.57s, duration=45.09s, readyState=4, paused=false`; console errors `[]`.

### Fixture policy (no silent substitution)

- `STREAMIX_FIXTURE_FALLBACK` (default **false**): when a title has no supported real extractor, Play returns `422 unsupported` with an actionable message (verified: "No real stream source is available for this title (no supported extractor in: CineStream). VegaMovies search results can play real sources.").
- Passing `?fixture=1` explicitly opts into the local fixture, which is labelled "TEST MODE" in the API note and as a yellow badge in the player. Real playback shows a green "Real source" badge.

### Additional fixes in this round

- Multi-provider search: bounded per-provider timeout (12 s), `Promise.allSettled`-style isolation (one provider failing never blocks others), cross-provider dedupe by `type+normalizedTitle+year` (remakes and movie/series with the same name are preserved), and per-provider diagnostics returned to the client (`providers:[{provider,count,ms,error}]`) and logged.
- Provider-aware details: `GET /api/detail/:type/:id?provider=Name`; unknown provider falls back safely; the resolver tries the requested provider first.
- Resolver fan-out: a non-requested provider rejecting an id no longer aborts resolution; the explicitly requested provider's permanent error does abort.
- In-flight session dedupe: concurrent identical play requests (e.g. React StrictMode double-mount) share one HLS session — verified: two requests → one `stream_created`.
- Player releases an aborted mount's session (`cleanupStream`) so no orphan session lingers.
- FFmpeg now receives source headers when the resolver supplies them; optional `STREAMIX_SESSION_MAX_SECONDS` bounds transcode length (used at 45 s for verification).

### Provider status (honest)

- **CineStream** — catalog/search/detail (metadata). Real stream resolution: not implemented.
- **VegaMovies** — search/details/real playback: implemented and verified. `verifiedRealPlayback: true` in `/api/providers/status`.
- **Bollyflix / MoviesDrive / Moviesmod** — not implemented (Cloudflare-gated scraping). Not claimed as supported.

### Specs added/attempted

- `STREAMIX_FIXTURE_FALLBACK`, `STREAMIX_SESSION_MAX_SECONDS` documented in `.env.example`.

### Commands and results

- `npm run test` → 63/63 pass (added: VegaMovies parsers/chain/placeholder-filter, multi-provider merge/dedupe, provider-param routing, fixture policy, fan-out semantics).
- `npm run build` → Vite 8.3.4 OK (main 238 kB + lazy hls chunk).
- Live curl checks and the browser journey above.

### Remaining limitations

- Resolution depends on third-party hosts (`vcloud.beer` etc.) and expiring signed URLs; each play re-resolves (by design — no caching of expiring URLs).
- VegaMovies movie chain verified; **series** episode link extraction is not ported (returns the clear "no playable media" error).
- `ffprobe` validation is required before a candidate is used, so a slow host can add latency.

## Mandatory bug-fix round (visible failures, browser-verified)

### Reproduced (browser harness: Puppeteer-core + Edge, computed styles + image network checks)

1. Poster boxes had `width: 0` (poster images collapsed); 35/72 home posters dead.
2. `.card-title` and `.card-meta` computed `display: inline` — titles, media types, years, ratings ran together on one line.
3. Root cause of 1+2: the Phase-5 TitleCard rewrite used `<span>` containers whose CSS (`width`, `padding-top`, `white-space`, `overflow`, `text-overflow`) only works on block boxes, but the spans were left inline.
4. Search backend was 404 (`/api/search` mount mismatch) in the prior state; UI results were gated behind a `view === "search"` that nothing ever set.
5. Catalog responses were blocked on serial, timeout-less TMDB lookups; the shared route/TMDB cache (500 entries) let TMDB inserts evict route responses, causing constant upstream refetch + re-enrich churn ("pending" forever) and slower loads.
6. Trending and Latest drew from the same catalog slice (19/24 identical titles).
7. Row headers exposed provider jargon (`ranking` strings) to visitors.

### Fixes implemented and verified in-browser

- `index.css`: `.card-poster`, `.card-title`, `.card-meta` are `display: block`; `.card` gets a fixed `width: 150px` (120px mobile); poster box measures exactly 150x225 (2:3); title and metadata are separate block elements; placeholder stays behind lazy posters.
- `App.jsx`: search sets `view: "search"`, clear returns home, latest-query guard prevents stale overwrite.
- `index.js`: dedicated caches — `routeCache` (200), `providerCache` (200), `tmdbCache` (2000, 24h) — no more cross-eviction between routes and TMDB lookups.
- `home.js`: enrichment runs in background on the displayed 24-item slice only; honest section titles "Top Movies" / "Newest Movies" / "Top Series"; "Newest Movies" sourced from a separate catalog band (skip 147+, 5 pages, newest-first, documented in the API `ranking`).
- `cinemeta.js`: `getTopMovies/getTopSeries` accept a `startSkip` so sections can draw from different catalog positions.
- `Row.jsx`/`App.jsx`: `ranking` jargon no longer rendered (still present in API payloads).
- `index.html`: data-URI favicon removes the stray 404 console error.

### Browser verification (Puppeteer + Edge, real page at localhost:5173)

- Home: 72 cards; computed `posterBox 150x225`; `titleDisplay`/`metaDisplay = block`; `loadedImages 72/72`, `broken 0`; console errors `[]`; row titles "Top Movies | Newest Movies | Top Series".
- Search "from": 54 cards, first "From Dusk Till Dawn (1996)"; after horizontal scroll `54/54` posters loaded.
- Search "dune": 23 cards, first "Dune (2021)".
- Clear: catalog restored (72 cards, 72/72 posters).
- API: trending 24/24 and latest 24/24 items carry poster fields without TMDB; overlap trending-vs-latest now `0/24`; first catalog response returns in 0.2-0.3 s with `enrichment.status=pending`, then `enabled` on the next fetch; third fetch `0.004 s` (stable cache).
- Search endpoint timing: cached searches `0.00-0.13 s`; cold 0.4-5.4 s (upstream warm-up); direct upstream probes 71-470 ms.
- `npm run test` → 34/34 pass; `npm run build` → OK (main 238 kB, lazy hls 575 kB).

### Files changed in this round

- `packages/client/src/index.css`, `packages/client/src/components/Row.jsx`, `packages/client/src/App.jsx`, `packages/client/index.html`
- `packages/server/src/index.js`, `packages/server/src/routes/home.js`, `packages/server/src/providers/cinemeta.js`

## Confirmed defects reproduced before repair

1. **Search API was 404.** The search router defines `GET /search` but was mounted at `/api/search`, so the real path was `/api/search/search`; `GET /api/search?q=...` returned `Cannot GET /api/search`.
2. **Search results never rendered in the UI.** App only rendered results when `view === "search"`, but no code path ever set that view (nav links are Home/Movies/Series).
3. **Catalog responses blocked on TMDB.** `home.js` and `search.js` did `await enricher.enrich(items)` before responding; the enricher made a serial, timeout-less TMDB HTTP call per item (146 calls for trending), making TMDB effectively required for the catalog to appear.
4. **Metahub posters were routed through the wsrv.nl proxy unnecessarily.** Direct `images.metahub.space` posters return 200 with a browser UA; the extra proxy hop added an external dependency for every card.
5. **Search input was disabled while results loaded**, blocking continued typing.
6. Playback explicitly fell back to a local fixture (correct behavior); it was labeled, but the real-provider blocker was not precisely pinned to the extractor layer.

## Fixes implemented

- `index.js`: search router mounted at `/api` → `/api/search` works again.
- `App.jsx`: `handleSearch` sets `view = "search"`; `clearSearch` returns to home; `latestQueryRef` guard ensures older responses cannot overwrite newer results (belt-and-braces with the existing abort).
- `SearchBox.jsx`: input stays enabled while requests are in flight; debounce + abort/cancel preserved.
- `tmdb.js`: bounded concurrency (`mapWithConcurrency`, 4 workers), 4 s per-search timeout, items preserved in order.
- `home.js` / `search.js`: provider data is returned **immediately**; when TMDB is configured, enrichment runs in the background and warms the cache (first response `enrichment.status: "pending"`, next fetch `"enabled"` with matched count). TMDB is never required for cards to render.
- `cinemeta.js`: metahub poster URLs are served directly (only Kitsu images stay proxied via wsrv).
- Tests: `mapWithConcurrency` order/limit/empty/rejection coverage.

## Verification (actual results)

- `npm run test` → 34/34 pass
- `npm run build` → OK (main 238 kB, lazy hls chunk 575 kB)
- `GET /api/home/trending` → 0.13 s cold, `enrichment.status=pending`, 24 items; poster now direct `https://images.metahub.space/poster/small/tt6933238/img`; next fetch `cached=true enrichment=enabled matched=146`
- `GET /api/search?q=batman` → 37 results, first `Batman` (1989); `inception` → 30 (`Inception`); `avengers` → 33 (`Avengers: Endgame`); `dune` → 23 (`Dune`); `interstellar` via Vite proxy → 31 (`Interstellar`)
- Cold search latency bound: 0.4-5.4 s (upstream warm-up); cached searches are instant (0.00-0.13 s); direct upstream endpoint probes measured 71-470 ms each
- Proxy page 200/STREAMIX; stream session: `provider=CineStream/local_fixture`, `resolution.status=fixture_fallback`, note "Provider stream resolution is not implemented yet; playing the local test fixture"; playlist 200 `application/vnd.apple.mpegurl`; cleanup OK
- Missing-poster path (TitleCard placeholder behind image) unchanged and verified by code review

## Provider documentation (inspection notes)

- Inspected the real CSX sources: `CineStream/src/main/kotlin/com/megix/{CineStreamProvider,CineStreamExtractors,ApiConstants,CineSimklProvider,CineTmdbProvider}.kt` on the CSX `master` branch, plus the `builds/CS.json` manifest and provider metadata.
- Catalog/search/detail flow used by STREAMIX is the CineStream main API port (cinemeta top catalogs, v3-cinemeta search, kitsu anime search, meta detail) — primary source, no TMDB dependency.
- Playback blocker (exact step): `CineStreamProvider.loadLinks` → `invokeAllSources(...)` → dozens of host extractors (GDLink, GDFlix, febbox, akwam, levidia, ...). Each extractor performs multi-step page fetches with host-specific referer/UA/cookies, JSoup HTML parsing, and media-link extraction using CloudStream-only primitives (`app.get`, `document`, `newExtractorLink`). That Kotlin/Android-dependent pipeline is not ported; no direct, keyless media URL endpoint was validated this session. Fixture playback is clearly labeled in the API response (`provider.resolution=local_fixture`, `resolution.status=fixture_fallback`, note text) and shown in the player.

## Remaining work

1. Port the first permitted extractor path from `CineStreamExtractors.kt` (single host, validate a real media URL end-to-end), then flip `supportsStreamResolution`.
2. Optional: per-endpoint search timeouts after collecting more latency data; browser-level UI QA.

## Desktop native video-host black screen resolution

### Confirmed Cause
1. **Window Hierarchy & Compositor Occlusion:** In `video-host.cs`, when `parent != IntPtr.Zero`, the video surface was created as a standard `WS_CHILD` window under Electron's top-level HWND (`Chrome_WidgetWin_1`). In modern Chromium/Electron, DirectComposition surfaces render directly to the window's visual tree, compositing the web page over standard Win32 `WS_CHILD` siblings.
2. **Opaque DOM Element:** In `packages/client/src/index.css`, `.player-desktop-canvas` had an opaque `background: #000;` with a center badge (`Native MPV Active`), completely covering the player viewport in Chromium's rendering surface.
3. **Viewport Coordinates:** `WS_CHILD` window coordinates could not break out of Chromium's composition tree, whereas flip-model swapchains in modern Direct3D 11 (`gpu-next`) require a top-level or owned composition surface.

### Fix Applied
1. **Owned Popup Window Architecture (`packages/desktop/src/video-host.cs`):**
   - Switched the native video surface window style to an owned popup: `WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS` with `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`.
   - Used Win32 `ClientToScreen(ownerHwnd, ref pt)` to dynamically convert the React player viewport client bounds (`x, y, w, h`) to physical screen coordinates.
   - Added a 30ms timer on the dedicated Win32 message loop thread to automatically re-query `ClientToScreen` and seamlessly track the Electron window during moves, drags, and resizes.
   - Forwarded mouse events (`WM_LBUTTONDOWN`, `WM_LBUTTONDBLCLK`, `WM_MOUSEMOVE`) from the video surface to the main Electron process via stdout.
2. **Host Management & Window Sync (`packages/desktop/src/video-host.js` & `packages/desktop/src/main.js`):**
   - Added event listener support and `sync()` command in `video-host.js`.
   - Hooked Electron window `move`, `resize`, `restore`, `show` events to automatically sync video host position.
   - Forwarded video host mouse events to the renderer as `video-click`, `video-dblclick`, `video-mousemove`.
3. **React Player Integration (`packages/client/src/lib/playbackAdapter.js`, `Player.jsx`, `index.css`):**
   - Added event bridges for `videoclick`, `videodblclick`, `videomousemove`, mapping them to `togglePlay`, `toggleFullscreen`, and `bumpControls`.
   - Removed the 200ms CSS transition on `.player-desktop-canvas` to eliminate resizing jitter.
   - Suppressed the `Native MPV Active` DOM badge when playback is ready.

### Verification Results
- `npm run build` passed cleanly.
- `npm --prefix packages/desktop run prepackage` passed cleanly.
- Full end-to-end Electron render verification executed with real fixture video (`multi-audio.mkv`):
  - MPV initialized with `gpu-next` and `d3d11va` hardware decoding.
  - Native video surface captured via Win32 `PrintWindow` (92,021 bytes) confirmed rendering real video frames (solid blue test frame).
  - Audio playback and real-time audio track switching (switched to Track 2) verified.
  - `setBounds` full-screen / controls-hidden mode verified.
- Automated desktop integration test (`STREAMIX_DESKTOP_TEST=1`) verified:
  - Page title: STREAMIX
  - App mounted: true
  - Cards rendered: 261
  - Bridge keys: `["isDesktop","platform","version","apiUrl","mpv"]`.

## Desktop setup installer rebuild & automation

### Action Taken
- Executed full client build and Electron packaging pipeline (`npm run package:desktop`).
- Produced freshly compiled Windows installer (`packages/desktop/dist/STREAMIX Setup 1.0.0.exe` and `packages/desktop/dist/setup.exe`, 129 MB) embedding the latest native video-host viewport embedding fixes, D3D11 hardware decoding, MPV integration, and player controls.
- Added automated `postpackage` script in `packages/desktop/package.json` ensuring that every execution of `npm run package:desktop` automatically mirrors the built NSIS installer to `dist/setup.exe`.
- Added automatic recompilation check in `prepare-package.mjs` so that `streamix-video-host.exe` is automatically recompiled whenever `video-host.cs` changes.
- Added permanent agent rule in `AGENTS.md` mandating automatic re-building of the desktop installer after every desktop/client bug fix.


## Desktop Zoom Shortcut Handling & Viewport Reset (COMPLETED)

### Objective
Resolve the issue where zooming out via `Ctrl + -` caused the app view to shrink, but pressing `Ctrl + +` failed to enlarge it, and ensure that the app view resets to 100% default and synchronizes properly with native video playback.

### Cause
In Electron on Windows with `autoHideMenuBar: true` and no explicit Application Menu:
1. Standard US keyboards share the `=` and `+` characters on the same physical key.
2. Pressing `Ctrl` and that key without `Shift` produces `key: '='` (`code: 'Equal'`). Chromium does not map unshifted `Ctrl + =` to Zoom In without a menu accelerator.
3. `Ctrl + -` worked because `-` is an unshifted character.
4. Chromium persisted the negative zoom level into user partition preferences on disk, causing the shrunken state to persist across restarts.

### Solution
1. **Window Keyboard Input Interception (`packages/desktop/src/main.js`):**
   - Added `before-input-event` listener capturing:
     - Zoom In: `Ctrl + =`, `Ctrl + +`, `Ctrl + Shift + =`, and `Ctrl + NumpadAdd` (incrementing by +0.1 up to 3.0x).
     - Zoom Out: `Ctrl + -`, `Ctrl + _`, `Ctrl + NumpadSubtract` (decrementing by -0.1 down to 0.5x).
     - Zoom Reset: `Ctrl + 0`, `Ctrl + Numpad0` (resetting to 1.0x / 100%).
   - Added `zoom-changed` listener for mouse-wheel / trackpad zoom gestures.
   - Added `did-finish-load` listener resetting zoom factor to `1.0` and level to `0` on application launch so stuck/shrunk views automatically recover.
   - Synchronized `videoHost.sync()` and dispatched `window.dispatchEvent(new Event('resize'))` on zoom changes so the native video surface aligns with the resized player viewport.
   - Added IPC handlers `window:zoom-in`, `window:zoom-out`, `window:reset-zoom`, and `window:get-zoom`.
2. **Renderer Bridge (`packages/desktop/src/preload.cjs`):**
   - Exposed `streamixDesktop.zoomIn()`, `streamixDesktop.zoomOut()`, `streamixDesktop.resetZoom()`, and `streamixDesktop.getZoom()`.

### Verification Results
- Automated Electron zoom verification test passed all 8 cases:
  - Initial zoom factor: 1.0
  - After `Ctrl + -`: 0.9
  - After `Ctrl + =` (unshifted physical `+` key): 1.0
  - After `Ctrl + Shift + +`: 1.1
  - After `Ctrl + 0` (reset): 1.0
  - Bridge methods `getZoom()`, `zoomIn()`, `resetZoom()` verified.
- End-to-end Electron verification (`npx electron packages/desktop/src/main.js --test-verification`) succeeded:
  - Page title: STREAMIX
  - App mounted: true
  - Cards rendered: 260
  - Bridge keys: `["isDesktop","platform","version","apiUrl","zoomIn","zoomOut","resetZoom","getZoom","mpv"]`.
- Desktop package build (`npm run package:desktop`) executed cleanly:
  - Version auto-incremented to `1.0.3`.
  - Old dist artifacts removed.
  - Output created: `packages/desktop/dist/STREAMIX Setup 1.0.3.exe` and mirror `packages/desktop/dist/setup.exe` (129 MB).


## Native Stream Resolution Latency Optimization (COMPLETED)

### Objective
Diagnose and eliminate the startup delay between clicking Play and video playback starting in STREAMIX Desktop.

### Measured Bottleneck & Diagnosis
Measurements collected on live streaming titles (e.g. *Inception* 2010):
- **VegaMovies search & title matching**: ~1,800ms - 3,300ms
- **Detail-page & host-link extraction**: ~2,200ms - 3,500ms
- **FFprobe validation & retries**: **7,300ms - 9,500ms** (dominated ~60% of total delay)
  - Cause: In native desktop mode, `isNative` was not passed to `resolver.resolveStream`, forcing the server to run the full web HLS pipeline which sequentially spawned `ffprobe` over network sockets across multiple quality tiers and candidates with 20s timeouts and duplicate probes for `probeHeight` and `isPlayableMedia`.
- **MPV start -> playback-restart / file-loaded**: **~1,041ms - 1,343ms**
  - Confirmed: MPV initializes quickly (~1s); the user-facing startup delay was almost entirely server-side network FFprobe probing.

### Solution Implemented
1. **Thread `isNative` to Provider Resolver (`packages/server/src/routes/stream.js`, `extractor.js`):**
   - Passed `isNative` from query mode to `resolver.resolveStream`, `candidate.resolveStream`, and `bridge.resolveByTitle`.
   - Updated in-flight deduplication key to distinguish native fast-path requests from web HLS requests.
2. **Native Fast Path in VegaMovies Provider (`packages/server/src/providers/vegamovies.js`):**
   - When `isNative: true`, once direct signed media URLs are extracted from host links (vcloud, token pages), return them directly to MPV without blocking on network FFprobe.
   - Built a bounded list of genuine alternate candidates across tiers for MPV to try in order.
   - Bounded candidate matching to top 2 high-confidence matches in native mode.
3. **Unified `probeMedia` & Eliminated Duplicate Probes (`vegamovies.js`):**
   - Merged `probeHeight` and `isPlayableMedia` into a single `probeMedia` method that runs `ffprobe` at most once per candidate URL and caches results.
   - Reduced FFprobe timeout from 20s to 8s and distinguished permanent HTTP errors (404, 403, 410) so they are not retried.
4. **MPV Manager & Player Optimization (`packages/desktop/src/mpv-manager.js`, `Player.jsx`):**
   - Batched property observers with `Promise.all` into a single parallel IPC dispatch.
   - Configured `--cache-pause=no` and `--demuxer-readahead-secs=5` to prevent startup cache stalls.
   - Added concise redacted timing measurements across the entire pipeline.

### Verification Results
- **Timings Before vs After:**
  - *Inception* (2010) stream resolution: **14,395ms -> 7,033ms (>50% latency reduction, saving >7.3s)**.
  - MPV native startup: **1,041ms**.
  - Total time from Play click to video starting dropped from **~16s down to ~8s**.
- **Unit & Integration Tests:**
  - `npm test --workspace=packages/server`: 104/104 tests passing (+2 new tests verifying fast path and probe cache).
  - `npm run build`: built in 331ms.
  - `STREAMIX_DESKTOP_TEST=1` Electron test: VERIFICATION_SUCCESS.
  - `npm run package:desktop`: generated Windows installer `STREAMIX Setup 1.0.4.exe` (129 MB) and mirror `setup.exe`.

## Runtime Stability & Hang Prevention (COMPLETED)

### Objective
Investigate and resolve the issue where the desktop application hangs after running for some time during sustained playback or window interactions, applying professional-grade architectural hardening across the Win32 native video host, Electron IPC pipeline, MPV process manager, and React Player lifecycle.

### Root Cause Analysis
1. **Multi-threaded Stdout Interleaving & IPC Desync (`streamix-video-host.exe` & `video-host.js`)**:
   - `video-host.cs` had two concurrent threads writing directly to standard output: Thread 1 (`Main`) writing command responses (`{"ok":true}`), and Thread 2 (`CustomWndProc`) writing user events (`{"event":"mousemove"}`).
   - During playback, mouse movement over the video surface caused `Console.WriteLine` calls from Thread 2 to collide with `Main` thread command responses.
   - Without a locking mechanism, characters interleaved on stdout (e.g. `{"event":"mous{"ok":true}emove"}`), causing `JSON.parse` syntax errors in `video-host.js`.
   - `video-host.js` used a FIFO array (`pendingResolvers.shift()`) with no request correlation IDs or timeouts. When a line failed to parse, the resolver was never shifted; all subsequent commands received the wrong response, and in-flight promises leaked indefinitely.
   - Any `await videoHost.setBounds()` or `sync()` called from `ipcMain.handle` in Electron stalled forever, blocking Electron's IPC queue and freezing renderer promises.
2. **Win32 Timer & Thread Message Pump Overload (`video-host.cs`)**:
   - `video-host.cs` initialized a 30ms timer on the thread message queue that was never killed on window destruction.
   - Electron's `move` and `resize` events called `videoHost.sync()` unthrottled on every single pixel movement, flooding stdin and thread messages.
3. **High-Frequency MPV Property Observation Spam (`mpv-manager.js`)**:
   - `mpv-manager.js` was observing `core-idle`. During network stream demuxing, `core-idle` toggles dozens of times per second as network packets arrive.
   - Every toggle triggered IPC events forwarded across Electron to renderer for a property completely unused by the client, causing memory churn and eventual event loop backlog.
   - MPV had no `--msg-level` restriction, generating high volumes of stderr logs during extended playback.
   - MPV commands had no timeouts and `cleanup()` didn't reject pending commands.
4. **React `ResizeObserver` Dependency Churn (`Player.jsx`)**:
   - `Player.jsx` had `controlsVisible` in the dependency array of the `ResizeObserver` effect `[isDesktop, controlsVisible, fullscreen, phase]`.
   - Every 3.5 seconds as controls auto-toggled, the entire `ResizeObserver` was torn down and reconstructed, dispatching redundant bounds update IPCs.
   - `bumpControls` and player event listeners re-subscribed on every play/pause transition due to changing callback identity.
5. **Chromium Background Timer & IPC Throttling (`main.js`)**:
   - Default `backgroundThrottling: true` caused Chromium to throttle timers, requestAnimationFrame, and IPC message processing down to 1Hz or pause them when the window lost focus or was partially occluded.

### Solutions Implemented
1. **Thread-Safe Stdout & Request Correlation (`video-host.cs`, `video-host.js`)**:
   - Added `lock (consoleLock)` around all `Console.WriteLine` calls in `video-host.cs` to eliminate multi-threaded stdout line interleaving.
   - Introduced request sequence IDs (`id`) on every command and response, replacing the fragile FIFO queue with a correlated Map (`this.pending.set(id, ...)`).
   - Added a 2000ms safety timeout to `sendCommand` so dropped commands reject cleanly rather than hanging the main process.
   - Added deduplication cache and in-flight coalescing to `setBounds` so identical bounds checks are no-ops.
   - Managed Win32 timer lifecycle: timer starts on window creation and is stopped/killed on window destroy (`KillTimer`).
2. **MPV Manager Hardening (`mpv-manager.js`)**:
   - Removed `core-idle` observer to eliminate high-frequency event spam.
   - Added `--msg-level=all=warn` to suppress noisy network chunk and demuxer debug output on stderr.
   - Added 5000ms command timeout and `rejectAllPending` on socket close, error, and cleanup.
3. **Player Lifecycle Stabilization (`Player.jsx`)**:
   - Removed `controlsVisible` from `ResizeObserver` effect dependencies so the observer persists across control visibility toggles.
   - Stabilized `bumpControls` and event listeners using `playingRef` to eliminate hook and subscription churn.
4. **Desktop Window Configuration & IPC Throttling (`main.js`)**:
   - Added `backgroundThrottling: false` to `webPreferences` so playback and IPC are never throttled by the OS or window occlusion.
   - Throttled window `move` and `resize` synchronization to at most 1 call per 50ms.

### Verification Performed
- **Client Build**: `npm run build` -> clean build in 245ms.
- **Server Tests**: `npm test --workspace=packages/server` -> 104/104 tests passing.
- **Electron Integration Test**: `STREAMIX_DESKTOP_TEST=1 npx electron packages/desktop/src/main.js` -> verified app mount, 257 cards, bridge APIs, clean exit without errors.
- **Packaging & Version Bump**: `npm run package:desktop` -> built `STREAMIX Setup 1.0.5.exe` (129 MB) and updated mirror `packages/desktop/dist/setup.exe`.

## Player Controls Auto-Hide Bug Fix (COMPLETED)

### Objective
Fix the issue where STREAMIX Desktop player controls fail to hide automatically after 3 seconds of mouse inactivity, specifically resolving the false trigger where window repositioning during hide transitions caused synthetic mousemove events to reset the hide timer.

### Root Cause
1. **Layout Transition & Window Repositioning**:
   - In desktop native mode, when controls hide, the canvas expands from `.player.controls-visible .player-desktop-canvas` (`top: 56px; height: calc(100% - 152px)`) to `.player.controls-hidden .player-desktop-canvas` (`top: 0; height: 100%`).
   - `ResizeObserver` observed this canvas height expansion and called `videoHost.setBounds(...)`.
   - `video-host.cs` executed `SetWindowPos`, moving the native window 56px upwards.
   - When Windows moved the native window underneath the stationary cursor, Windows generated a `WM_MOUSEMOVE` message.
2. **Missing Cursor Delta Verification**:
   - `video-host.cs` was dispatching `{"event":"mousemove"}` solely based on time elapsed (`now - lastMouseMoveTime > 250`), without checking whether the physical mouse cursor position had actually changed.
   - Because `WM_MOUSEMOVE` was triggered by the window moving under the mouse (or optical sensor micro-jitter), `video-host.cs` dispatched `videomousemove` to the React player.
   - React received `videomousemove` and called `bumpControls()`, immediately setting `controlsVisible = true` and canceling the hide transition.

### Solution
1. **Screen-Space Physical Cursor Delta Check (`video-host.cs`)**:
   - Imported Win32 `GetCursorPos(out POINT lpPoint)` to query the true global cursor screen coordinates.
   - Stored `lastGlobalMouseX` and `lastGlobalMouseY`. Only dispatch `{"event":"mousemove"}` if the physical cursor has moved by at least 4 pixels (`dx >= 4 || dy >= 4`).
   - When `SetWindowPos` moves the window under a stationary mouse, `dx == 0 && dy == 0`, so the synthetic message is safely ignored.
2. **Transition Immunity & Synthetic Event Guard (`Player.jsx`)**:
   - Added `lastHideTimeRef` and guarded both `handleMouseMove` and `videomousemove` with a 400ms transition lock (`Date.now() - lastHideTimeRef.current < 400`).
   - In `handleMouseMove`, verified `screenX`/`screenY` delta (`dx >= 4 || dy >= 4`) before bumping controls to prevent synthetic Chromium mousemove events on element style/class changes.

### Verification
- **Compilation**: Compiled `video-host.cs` with C# 5 compiler (`csc.exe`) into `packages/desktop/bin/streamix-video-host.exe` with exit code 0.
- **Client Build**: `npm run build` -> clean Vite build in 249ms.
- **Server Tests**: `npm test --workspace=packages/server` -> 104/104 tests passed.
- **Electron Verification**: `STREAMIX_DESKTOP_TEST=1 npx electron packages/desktop/src/main.js` -> verified mount, 257 cards, bridge APIs, and clean exit.
- **Packaging & Version Bump**: `npm run package:desktop` -> automatically incremented version to **1.0.6**, generated `STREAMIX Setup 1.0.6.exe` (129 MB), and updated mirror `setup.exe`.


## Player Exit Detail Section Freeze Fix & Full GitHub Releases Archive (COMPLETED)

### Objective
1. Resolve the issue where returning/clicking Back from video playback to the detail modal causes the application to freeze/become unclickable.
2. Build and publish all historical and current setup installer executables (`setup.exe` / `STREAMIX Setup <version>.exe`) across GitHub Releases so users can access every version setup file (`v1.0.0` through `v1.0.7`).

### Root Cause of Detail Section Freeze
1. **Thread Race in Native Window Destruction (`video-host.cs`)**:
   - In `video-host.cs` command loop, handling `cmd == "DESTROY"` immediately set `currentHwnd = IntPtr.Zero;` and `ownerHwnd = IntPtr.Zero;` on the `Main` thread before `windowThread` could process the posted `WM_USER_DESTROY` message.
   - When `windowThread` received `WM_USER_DESTROY`, it checked `if (currentHwnd != IntPtr.Zero)`, which evaluated to false because `Main` had already cleared it.
   - As a result, `DestroyWindow(currentHwnd)` was skipped. The native Win32 window (`WS_POPUP`, owned by Electron) remained alive, visible/transparent, and floating in front of the Electron window.
2. **Mouse Event Interception over Detail Section**:
   - When the user navigated back from `Player` to `DetailModal`, all mouse clicks hit the orphaned native Win32 window.
   - The native window's `CustomWndProc` swallowed `WM_LBUTTONDOWN` and returned `IntPtr.Zero`, preventing clicks from ever reaching Electron's DOM. This made the detail modal completely unresponsive/stuck.

### Solutions Implemented
1. **Thread-Safe Synchronous Window Destruction (`video-host.cs`)**:
   - Introduced `static ManualResetEvent destroyReady = new ManualResetEvent(false);`
   - In `WM_USER_DESTROY` on `windowThread`:
     - Calls `ShowWindow(currentHwnd, SW_HIDE)` immediately so the window stops intercepting input instantly.
     - Calls `DestroyWindow(currentHwnd)` and resets `currentHwnd = IntPtr.Zero;`.
     - Signals `destroyReady.Set()`.
   - In `cmd == "DESTROY"` on `Main` thread:
     - Posts `WM_USER_DESTROY` to `windowThread`.
     - Waits synchronously on `destroyReady.WaitOne(2000)` before returning success to Electron, ensuring the window is completely gone before navigation renders.
2. **Immediate Pre-Teardown & Hide (`video-host.js`)**:
   - Updated `destroy()` in `video-host.js` to issue `HIDE` before `DESTROY` for guaranteed immediate occlusion removal.
3. **Dedicated `handleBack` Teardown (`Player.jsx`)**:
   - Added `handleBack` in `Player.jsx` to synchronously trigger `mpvAdapterRef.current?.destroy()` and clear the reference before calling `onClose()`.
   - Wired `handleBack` to the player back button, error back button, and Escape key listener.
4. **All Versions Built & Published to GitHub Releases**:
   - Auto-incremented desktop release to **v1.0.7**.
   - Built standalone NSIS installer executables for all versions (`STREAMIX Setup 1.0.1.exe` through `STREAMIX Setup 1.0.7.exe`).
   - Tagged all version commits and published individual releases to GitHub (`Swagsaiiff/streamix-desktop`) with full notes and setup executable assets:
     - `v1.0.0`: `STREAMIX.Setup.1.0.0.exe`
     - `v1.0.1`: `STREAMIX.Setup.1.0.1.exe`
     - `v1.0.2`: `STREAMIX.Setup.1.0.2.exe`
     - `v1.0.3`: `STREAMIX.Setup.1.0.3.exe`
     - `v1.0.4`: `STREAMIX.Setup.1.0.4.exe`
     - `v1.0.5`: `STREAMIX.Setup.1.0.5.exe`
     - `v1.0.6`: `STREAMIX.Setup.1.0.6.exe`
     - `v1.0.7`: `STREAMIX.Setup.1.0.7.exe`

### Verification Performed
- **C# Compilation**: Recompiled `packages/desktop/bin/streamix-video-host.exe` with C# 5 compiler (`csc.exe`) -> exit code 0.
- **Client Build**: `npm run build` -> Vite production bundle built in 246ms.
- **Unit & Integration Test Suite**: `npm test` -> 138/138 tests passing (104 server tests + 34 client tests).
- **Electron Smoke Test**: `cmd /c "set STREAMIX_DESKTOP_TEST=1&& npx electron packages/desktop/src/main.js"` -> `VERIFICATION_SUCCESS` (app mounted, 257 catalog cards rendered, bridge APIs verified).
- **Video Host Lifecycle Verification**: Executed automated verification testing `CREATE`, `BOUNDS`, `DESTROY`, and process stop -> verified `currentHwnd: null` after destroy and clean process termination.
- **Installer Build**: `npm run package:desktop` -> built `STREAMIX Setup 1.0.7.exe` (129 MB) and updated mirror `setup.exe`.
- **GitHub Releases Asset Verification**: Checked assets for all tags via `gh release view` -> confirmed 123 MB setup installer attached to every release from `v1.0.0` to `v1.0.7`.

---

## Standalone Extension Development Project (`streamix-extension-lab`)

### Objective
Create a standalone, isolated extension development project and native TypeScript SDK inside `streamix-extension-lab/` to establish a modular extension ecosystem for Streamix Desktop without modifying existing application source files or provider implementations.

### Files Created
- `streamix-extension-lab/package.json`: Standalone npm configuration with isolated devDependencies (`typescript`, `@types/node`) and scripts.
- `streamix-extension-lab/tsconfig.json`: TypeScript configuration with `NodeNext` resolution and strict checking.
- `streamix-extension-lab/.gitignore`: Ignores `node_modules/`, `temp-*/`, and log files.
- `streamix-extension-lab/README.md`: Architectural overview, developer guide, and quick start documentation.
- `streamix-extension-lab/schemas/extension-manifest.schema.json`: JSON schema specification for Streamix extension manifests.
- `streamix-extension-lab/schemas/repository-index.schema.json`: JSON schema specification for community extension repositories (`plugins.json`).
- `streamix-extension-lab/sdk/src/types.ts`: Normalized TypeScript models (`StreamixExtension`, `ExtensionContext`, `MediaDetails`, `SearchResultItem`, `ResolvedSourceResult`, `VideoSource`, `SubtitleItem`).
- `streamix-extension-lab/sdk/src/constants.ts`: SDK API version (`1.0.0`), supported content types, video formats, qualities, and regex patterns.
- `streamix-extension-lab/sdk/src/errors.ts`: Standardized error hierarchy (`ExtensionError`, `ManifestValidationError`, `ApiVersionMismatchError`, `ItemNotFoundError`, `SourceUnavailableError`, `ExtensionTimeoutError`, `PermissionDeniedError`, `PackageIntegrityError`).
- `streamix-extension-lab/sdk/src/validator.ts`: Validation utilities for manifests, SemVer compatibility ranges (`^`, `~`, exact), search items, details, and source payloads.
- `streamix-extension-lab/sdk/src/context.ts`: `ExtensionContext` factory enforcing declared permissions (`network:fetch`, `storage:local`) and providing scoped logging.
- `streamix-extension-lab/sdk/src/runner.ts`: Execution runner managing timeouts, cancellation (`AbortSignal`), and result normalization.
- `streamix-extension-lab/sdk/src/manifest.ts`: Manifest loading, parsing, and validation helpers.
- `streamix-extension-lab/sdk/src/index.ts`: Public SDK entrypoint.
- `streamix-extension-lab/examples/sample-provider/manifest.json`: Sample extension manifest for `org.streamix.provider.sample`.
- `streamix-extension-lab/examples/sample-provider/package.json` & `tsconfig.json`: Isolated sample extension project setup.
- `streamix-extension-lab/examples/sample-provider/src/fixtures.ts`: Legitimate open-content media fixtures (Blender Foundation films with genuine HLS/MP4 test streams and VTT subtitles).
- `streamix-extension-lab/examples/sample-provider/src/index.ts`: Reference `StreamixExtension` implementation.
- `streamix-extension-lab/examples/sample-provider/tests/sample-provider.test.ts`: Provider operations unit tests.
- `streamix-extension-lab/tools/validator-cli.ts`: CLI tool to validate extension manifests and host API compatibility.
- `streamix-extension-lab/tools/packager.ts`: Zero-dependency ZIP packager/unpacker generating `.streamix-ext` archives and SHA-256 hashes.
- `streamix-extension-lab/tools/repo-builder.ts`: Repository builder generating `plugins.json` with cryptographic integrity checksums.
- `streamix-extension-lab/tools/harness.ts`: Standalone development harness exercising extensions end-to-end without UI or Electron.
- `streamix-extension-lab/repository/repository.json` & `plugins.json`: Sample local repository index referencing the built sample package.
- `streamix-extension-lab/packages/org.streamix.provider.sample-1.0.0.streamix-ext`: Pre-built sample extension package with verified SHA-256.
- `streamix-extension-lab/docs/EXTENSION_GUIDE.md`: Developer guide for authoring new extensions.
- `streamix-extension-lab/docs/SECURITY_AND_EXECUTION_MODEL.md`: Security threat model, sandboxing boundaries, and production isolation roadmap.
- `streamix-extension-lab/docs/STREAMIX_INTEGRATION_SPEC.md`: Technical specification for future integration into Streamix Desktop.
- `streamix-extension-lab/tests/manifest-validation.test.ts`: Automated tests for manifest schema validation.
- `streamix-extension-lab/tests/api-compatibility.test.ts`: Automated tests for SemVer version compatibility checking.
- `streamix-extension-lab/tests/normalized-models.test.ts`: Automated tests for data normalization and invalid format rejections.
- `streamix-extension-lab/tests/error-and-timeout.test.ts`: Automated tests for timeouts, abort signals, and permission enforcement.
- `streamix-extension-lab/tests/packager-and-integrity.test.ts`: Automated tests for ZIP packaging, SHA-256 integrity, and tamper detection.
- `streamix-extension-lab/tests/repository-index.test.ts`: Automated tests for repository indexing and schema validation.

### Verification Performed
1. `npm run build:sdk` (inside `streamix-extension-lab/`) -> `tsc --noEmit` exited with code 0 (zero type errors).
2. `npm run validate:manifest` -> Verified `examples/sample-provider/manifest.json` against schema and host API v1.0.0.
3. `npm run package:sample` -> Generated `packages/org.streamix.provider.sample-1.0.0.streamix-ext` (3,734 bytes, SHA-256 `245d10f2de319701a29bc4be0999c5a049b5933671cf8009bd663d586b4cdfe6`).
4. `npm run build:repo` -> Built local repository index `repository/plugins.json` with verified SHA-256 and metadata.
5. `npm run harness` -> Development harness executed: initialized extension, searched ("bunny"), fetched details, resolved HLS streams and VTT subtitles, exercised error handling for missing item, and cleanly disposed.
6. `npm test` -> 35/35 automated unit and integration tests passed in 683ms.
7. `npm run test:client` (from repository root) -> 34/34 client tests passed.
8. `npm run build` (from repository root) -> Client Vite production build completed in 246ms.
9. **Zero Application Files Modified**: No application code in `packages/`, no root dependencies, and no existing providers were modified.

---

## CloudStream Provider Migration & Single-URL Repository

### Objective
Migrate all 5 CloudStream provider modules from the upstream CSX repository (`Bollyflix`, `CineStream`, `MoviesDrive`, `Moviesmod`, `VegaMovies`) into an isolated `cloudstream-compatible/` subproject in `streamix-extension-lab/`, verify `.cs3` package integrity, establish an automated GitHub Actions build workflow, and publish a single-URL CloudStream repository on the `builds` branch.

### Files Created/Updated
- `streamix-extension-lab/cloudstream-compatible/`: Dedicated subproject containing:
  - `Bollyflix/`: Gradle module, icon, manifest, and Kotlin provider code (`Bollyflix.kt`, `BollyflixProvider.kt`, `Extractors.kt`).
  - `CineStream/`: Gradle module, icon, manifest, and Kotlin provider code (`CineStreamProvider.kt`, `CineSimklProvider.kt`, `CineTmdbProvider.kt`, etc.).
  - `MoviesDrive/`: Gradle module, icon, manifest, and Kotlin provider code (`MoviesDrive.kt`, `MoviesDriveProvider.kt`, `Extractors.kt`).
  - `Moviesmod/`: Gradle module, icon, manifest, and Kotlin provider code (`Moviesmod.kt`, `MoviesmodProvider.kt`, `TopMoviesProvider.kt`).
  - `VegaMovies/`: Gradle module, icon, manifest, and Kotlin provider code (`VegaMovies.kt`, `VegaMoviesProvider.kt`, `RogmoviesProvider.kt`).
  - `build.gradle.kts`: Configures CloudStream gradle plugin, SDK compile target (36), JVM 1.8 target, and default repo URL (`https://github.com/Swagsaiiff/streamix-extension-lab`).
  - `settings.gradle.kts`: Includes all 5 provider modules.
  - `gradle.properties`: JVM arguments and Android flags.
  - `gradlew` & `gradlew.bat`: Official Gradle wrapper scripts.
  - `gradle/wrapper/gradle-wrapper.jar` & `properties`: Gradle distribution configuration.
  - `LICENSE`: Full GNU General Public License v3.0 (GPLv3) preserving upstream attribution to `megix` / Saurabh Kaperwan.
  - `README.md`: Upstream provenance, provider inventory, single-URL repository instructions, and build guide.
  - `builds/`: Staged distribution directory containing `repo.json`, `CS.json`, `plugins.json`, and all 5 `.cs3` packages.
  - `workflows/build-cloudstream.yml`: Automated CI/CD GitHub Actions workflow template.
  - `tools/verify-repository.ts`: Repository integrity verification tool.
  - `tools/test-providers.ts`: Live provider endpoint diagnostic and reachability audit tool.
- `streamix-extension-lab/package.json`: Added `verify:cloudstream` script.
- `streamix-extension-lab/README.md`: Added section detailing the CloudStream single repository URL.

### Single Repository URL Published
- **Manifest URL**: `https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/builds/repo.json`
- **Manifest Alias**: `https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/builds/CS.json`
- **Plugin List**: `https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/builds/plugins.json`

### Verification Performed
1. `node --experimental-strip-types cloudstream-compatible/tools/verify-repository.ts` -> Verified all 5 extensions:
   - `Bollyflix.cs3` (38,129 bytes, `sha256-507b486b195b98903b0cec0fca811c27fdff6cf200f6f94a662c64dd8abe0e59`)
   - `CineStream.cs3` (695,013 bytes, `sha256-30dc643628702d6b2fe139339e59996783c95a0c1d41efe0a31872ae4d10908b`)
   - `MoviesDrive.cs3` (47,290 bytes, `sha256-52758210caa1cf0a6dc929d0f73fec5919e0ab66e5eddf6386ed30f7c771980a`)
   - `Moviesmod.cs3` (44,518 bytes, `sha256-9433fd970480a53f52f3ec4b49d3213c7bda5a26b109dc80ef82cd2ec13a37a7`)
   - `VegaMovies.cs3` (41,565 bytes, `sha256-b78635ef4f2f66c134184552fe5e4956cc02ec1c5ce6d6811cccfd3747367883`)
   - All internal `manifest.json` files and `classes.dex` Dalvik bytecode inspected and verified.
2. `node --experimental-strip-types cloudstream-compatible/tools/test-providers.ts` -> Audited live provider endpoints and documented reachability.
3. Git Remote Synchronization:
   - `main` branch pushed to `https://github.com/Swagsaiiff/streamix-extension-lab` (source code, gradle, and documentation).
   - `builds` branch published to `https://github.com/Swagsaiiff/streamix-extension-lab` (`repo.json`, `plugins.json`, and all 5 `.cs3` files).
   - Tested HTTP GET on raw URLs -> all returned 200 OK.
4. `npm run check` (inside `streamix-extension-lab/`) -> 35/35 SDK tests passed, all 5 CloudStream extensions passed.
5. Zero application files in `packages/` were touched.

