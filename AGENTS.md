# STREAMIX — Agent Rules (permanent)

STREAMIX is a responsive Netflix-style movie and series streaming website driven by real content from CloudStream/CSX provider implementations. Streams are resolved from real providers and played through FFmpeg-generated HLS with multi-audio switching and subtitle support where available.

## Non-negotiable rules

1. Never invent data. No fabricated movies, series, catalogs, search results, provider results, stream URLs, or playback claims. Every title, result, and stream shown must come from a real HTTP request to a real provider or (optionally, clearly attributed) TMDB.
2. Never claim a test passed unless it was actually executed and the output observed. Record the exact command and observed result in `PROGRESS.md` before marking any task complete.
3. Never commit secrets, API keys, tokens, or real credentials. Keys live only in `.env` (gitignored). `.env.example` contains placeholder keys only. A TMDB key is optional and must be supplied by the user, never generated or guessed.
4. The CSX manifest `https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/CS.json` is a plugin repository manifest (a JSON list locating provider extensions). It is NOT a playable video URL and must never be treated as one.
5. CloudStream `.cs3` extensions generally contain Kotlin/Android code and do NOT execute in Node.js. To support a provider: read its actual extension source in the CSX repo, then implement/port its search, detail, and extractor logic to server-side JavaScript, replicating the real endpoints, parameters, headers, and parsing. Do not fake a port without reading the source.
6. Provider requests must send the required headers (User-Agent, Referer, Origin, cookies) exactly as the CloudStream extension does. Missing headers are a leading cause of failed extraction. Never claim a provider works without observing a real successful request.
7. Small, verifiable tasks only. Do not generate the entire application in one operation. After every task, update `PROGRESS.md` (files changed, commands run with results, known issues, next task) before finishing.
8. Phase discipline. Work only the current phase: no provider scrapers before Phase 1, no full Netflix UI before Phase 2, no playback pipeline before Phase 3, no optimization work before Phase 4.
9. Honest capability reporting. If a feature is unimplemented, degraded, or fails, say so explicitly. Expose only content, audio tracks, and subtitles that actually exist.
10. Code style: JavaScript ESM everywhere, no TypeScript unless explicitly decided later, no comments unless asked, follow existing conventions, keep dependencies minimal.

## Testing requirements

- After any dependency, config, or code change, run the affected verification and observe the output:
  - dependencies changed → `npm install`
  - client touched → `npm run build` (and `npm run dev:client` smoke if dev wiring changed)
  - server touched → start the server and run `npm run health`
  - client↔server wiring touched → verify a real response end-to-end, not by assumption
  - desktop/client bug fixes or updates -> automatically rebuild the desktop setup installer (`npm run package:desktop`) to update `setup.exe`
- Record evidence (exact command + observed result summary) in `PROGRESS.md`. A task is not complete until its verification ran and passed.
- If lint or typecheck commands are added later, run them before declaring completion.
- Fix errors caused by the current task before moving on. Never mark a known-broken state as done.

## Protected architecture constraints

- Monorepo layout: `packages/client` (React + Vite, UI only) and `packages/server` (Node + Express, all provider/TMDB/stream logic). Do not restructure without a documented reason.
- The client never calls third-party providers or TMDB directly. All provider/TMDB traffic goes through the server under `/api/*`. Secrets and provider headers stay server-side; the client may use only `VITE_*` public variables.
- Health contract: `GET /api/health` returns 200 JSON with `ok: true`. Never remove or break it; it is the Phase 0 baseline check.
- Playback pipeline (fixed): real provider URL + required headers → server-side FFmpeg → HLS → hls.js in the browser. MKV and other non-native sources must pass through the FFmpeg HLS remux/transcode; do not point hls.js or a native player at raw provider URLs.
- Multi-audio is a core requirement: preserve audio-track mapping through FFmpeg (map every audio track, build an HLS master playlist with `#EXT-X-MEDIA` audio groups) and expose in the player only audio tracks actually present in the master playlist. Same honesty for subtitles.
- No hardcoded movie/series catalogs anywhere in the codebase.
- FFmpeg availability is a runtime capability check, not an assumption; playback endpoints must report a clear error when FFmpeg is missing.
- Git: create a checkpoint commit per completed task, stage only intended files, never rewrite existing history, never commit `node_modules`, `dist`, `.env`, or secrets.
