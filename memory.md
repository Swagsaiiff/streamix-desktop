# STREAMIX — Project Memory

## Goal

Build a responsive Netflix-style movie and series streaming website using real content from CloudStream/CSX provider implementations. Resolve actual provider streams and play supported MKV sources through FFmpeg-generated HLS, with audio-track switching and subtitle support where available. Hindi and English content coverage is targeted via provider optimization in later phases. Nothing is faked: content, results, streams, and playback success are only ever reported from real observed requests.

## Hard technical facts

- CSX manifest: `https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/CS.json` — a plugin repository manifest used to discover provider extensions. It is NOT a playable video URL.
- CloudStream `.cs3` extensions generally contain Kotlin/Android code and cannot run directly in Node.js. A provider is supported by reading its real extension source and porting its search/detail/extractor logic to server-side JavaScript with real endpoints, parameters, and headers.
- Full rules live in `AGENTS.md`; they are permanent and override convenience.

## The five phases

- Phase 0 — Foundation: documentation, git, minimal React+Vite client and Node+Express server, health-check endpoint, verified dev setup. (complete)
- Phase 1 — Dynamic content engine: parse the CSX manifest, port real provider logic (search + discovery) from actual extension sources, make real HTTP requests with required headers, optional TMDB metadata enrichment. (complete)
- Phase 2 — Netflix-style responsive UI: homepage rows and a same-page movie/series details modal with seasons and episodes, rendered exclusively from real Phase 1 data.
- Phase 3 — Playback: FFmpeg → HLS pipeline, hls.js player, audio-track switching, seeking, fullscreen. (complete; provider extractor port remains)
- Phase 4 — Reliability: provider fallback, caching, Hindi/English provider optimization, responsive polish.
- Phase 5 — Final polish and production readiness: a11y/responsive fixes, session reaping, hls.js code-splitting, docs. (implemented; see PROGRESS.md)
- Phase 4 — Reliability: provider fallback, caching, Hindi/English provider optimization, responsive polish.

## Phase 1 delivery (implemented)

- Provider abstraction: `packages/server/src/providers/base.js` (`BaseProvider` with fetch/timeout/UA, `ProviderError` with codes `timeout`/`network`/`http`/`parse`/`unsupported`), `providers/index.js` registry.
- Implemented provider: CineStream — a faithful port of `CineStreamProvider.kt` (main API only, no extractors yet). Real endpoints:
  - Home catalogs: `https://cinemeta-catalogs.strem.io/top/catalog/{movie|series}/top/skip={n}[&genre={G}].json` (ranked by the provider's own popularity metric; `.json` goes at the very end)
  - Search: `https://v3-cinemeta.strem.io/catalog/{movie|series}/top/search={q}.json` + `https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-airing/search={q}.json`
  - Detail: `https://v3-cinemeta.strem.io/meta/{type}/{id}.json` (`getDetails` implemented in the provider layer, not yet routed)
  - Posters from `metahub.space`/`kitsu.` are proxied via `https://wsrv.nl/?url=`
  - Title = first truthy alias ?? name; type = movie/series; year parsed from `year` or `releaseInfo`; rating from `imdbRating` (empty → null)
- Normalized title schema: `{ id, title, type, poster, backdrop, overview, year, releaseInfo, genres, rating, popularity, source, sourceUrl }`; missing fields stay `null`, never invented.
- API routes (server-side provider traffic only; the client never calls providers directly):
  - `GET /api/home/trending` — top movie catalog (popularity-ranked)
  - `GET /api/home/latest` — top movie catalog sorted by release year descending (documented in the `ranking` field; the provider has no dedicated latest catalog)
  - `GET /api/home/popular-series` — top series catalog (popularity-ranked)
  - `GET /api/search?q=...` — validated (400 on short/missing/control-char queries)
  - All routes: 5-minute TTL in-memory cache, stale-cache fallback on upstream failure, provider errors mapped to 502/504, no internal details leaked.
- TMDB enrichment (`providers/tmdb.js`): optional, server-side, conservative title+year+type match (±1 year), cached 24h, disabled with `no_tmdb_key` when `TMDB_API_KEY` is absent. The key never leaves the server.
- The CineStream extension also registers CineSimkl (needs a SIMKL client ID compiled into the .cs3 — unavailable) and CineTmdb (key-based; superseded by our optional enrichment). Other CSX providers (Bollyflix, MoviesDrive, Moviesmod, VegaMovies) are Phase 4 work.
- Client: minimal dev view consuming `/api/home/*` and `/api/search` with loading/error/empty states (Phase 2 builds the full UI).

## Playback pipeline (Phase 3 — implemented against local fixture; provider extractor pending)

Phase 3 status: the pipeline is real and verified end-to-end, but only against a local multi-audio test fixture (`scripts/make-test-fixture.mjs` → `temp/fixtures/multi-audio.mkv`). Provider stream resolution is honestly reported as unimplemented; the resolver returns `local_fixture` and a note. Porting real extractors is the next step.

Implemented surface:
- `POST /api/stream/:type/:id` → creates an HLS session (probe → FFmpeg → master playlist) and returns `{ sessionId, audioTracks, playlistUrl, sourceType, title, year, note }`
- `GET /api/stream/:sessionId/master.m3u8`, `GET /api/stream/:sessionId/status`, `GET /api/stream/:sessionId/:file` (strict file-name allowlist), `DELETE /api/stream/:sessionId`
- FFmpeg HLS with `-var_stream_map` audio groups: `EXT-X-MEDIA:TYPE=AUDIO` per audio track (one `DEFAULT=YES`), one video variant with `AUDIO="group_aud"`; audio track names/languages come from ffprobe tags
- hls.js 1.7.3 player: play/pause, -10s/+10s, fullscreen, audio menu sourced only from `hls.audioTracks`, back to modal, HLS/session cleanup on close
- Security: session-id regex, file-name allowlist, abort/timeout on FFmpeg, concurrency cap, no arbitrary URLs (resolver only returns the server-controlled fixture path for now)

## Phase 4 delivery (implemented)

- Real-provider playback is NOT verified; this remains the project's primary unresolved blocker. `GET /api/providers/status` reports `verifiedRealProviderPlayback: false`; sessions report `resolution.status: fixture_fallback`.
- Provider registry (`providers/index.js`): typed interface, telemetry per provider (successes/failures/lastSuccessAt/lastErrorCode), `getProviderStatuses`.
- Resolver (`providers/extractor.js`): bounded retries (default 2) for retryable codes (timeout/network/http); permanent errors (validation/not_found/unsupported) are never retried and stop fallback; next-provider fallback only after retryable exhaustion; in-flight dedupe per `type:id`.
- Errors (`errors.js`): standardized status mapping and secret-safe client messages across home/search/detail/stream routes. Logging (`logger.js`): structured JSON, no credentials or full source URLs.
- Language: `PREFERRED_AUDIO_LANGUAGE` (default `en`), `?lang=` override on `POST /api/stream/:type/:id`; default HLS audio track chosen only via matching ffprobe language metadata; unknown tracks never labeled; client localStorage preference + manual track menu.
- Caching: TTL caches reviewed (5 min catalog/search/detail, 24 h TMDB, 500-entry bound); added `delete`/`clear`; stream results never cached (signed/expiring URLs excluded by design).

Flow: provider resolves a real media URL (mkv/mp4/m3u8) plus required headers → server fetches it and pipes through FFmpeg → FFmpeg emits HLS (segments + master playlist) → server streams it to the client → hls.js plays it.

- Remux first: `-c:v copy -c:a copy` to HLS when codecs are HLS-compatible (e.g. H.264/HEVC video, AAC audio). Transcode only when necessary (e.g. AC3/DTS audio, unsupported video), and never silently — report when transcoding occurs.
- MKV containers: FFmpeg demuxes MKV and remuxes to fMP4/MPEG-TS HLS segments. This is why MKV sources route through the pipeline instead of native playback.
- Multi-audio (core requirement): map the video once and every audio track (`-map 0:v:0 -map 0:a:0 -map 0:a:1 ...`), emit an HLS master playlist with `#EXT-X-MEDIA:TYPE=AUDIO` groups plus audio-only variant playlists so each track is a selectable rendition. The UI lists exactly the audio groups present in the master playlist; hls.js switches via `hls.audioTracks` / `hls.audioTrack = index`.
- Subtitles: use only subtitle tracks or URLs the provider actually exposes; serve external subs as WebVTT through the server proxy; use hls.js subtitle track selection when embedded in HLS. Expose only tracks that exist.
- hls.js: enable `enableWorker`; use `xhrSetup`/loader customization only if header passthrough is needed on segment requests; standard config otherwise.
- FFmpeg capability is checked at server boot and surfaced in logs; playback endpoints return a clear error when FFmpeg is missing. FFmpeg 9.0.2 is already installed on this machine (verified 2026-10-10 via `ffmpeg -version`).
- Security: only allowlisted provider hosts pass through the stream proxy; provider headers stay server-side; no arbitrary URL proxying.

## Environment

- Node v24.19.0, npm 11.17.0, Git installed (identity configured), FFmpeg 9.0.2 available.
- Ports: server `4000` (`PORT`), client Vite default `5173` with `/api` proxied to the server.
- Scripts (root): `npm run dev` (server + client together), `npm run dev:server`, `npm run dev:client`, `npm run build` (client production build), `npm start` (server), `npm run health` (health check against a running server).
- Env vars: see `.env.example` (placeholders only). `.env` is gitignored; real keys are never committed.

## Status

Phases 0-5 are implemented and verified (see `PROGRESS.md` for evidence). Real provider playback is still unresolved and is the only remaining major gap. Production startup and deployment instructions live in `PROGRESS.md`.
