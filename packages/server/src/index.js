import express from "express";
import { config } from "./config.js";
import { TtlCache } from "./cache.js";
import { createTmdbEnricher } from "./providers/tmdb.js";
import { listConfiguredProviders } from "./providers/index.js";
import { homeRouter } from "./routes/home.js";
import { searchRouter } from "./routes/search.js";
import { detailRouter } from "./routes/detail.js";
import { streamRouter } from "./routes/stream.js";
import { providersRouter } from "./routes/providers.js";
import { createResolver } from "./providers/extractor.js";
import { createStreamManager } from "./providers/stream.js";
import { logger } from "./logger.js";
import { extensionManager } from "./extensions/manager.js";
import { extensionsRouter } from "./extensions/routes.js";

const routeCache = new TtlCache({ ttlMs: 300000, maxEntries: 200 });
const providerCache = new TtlCache({ ttlMs: 300000, maxEntries: 200 });
const tmdbCache = new TtlCache({ ttlMs: 86400000, maxEntries: 2000 });
const providers = listConfiguredProviders({ cache: providerCache });
const tmdbProvider = providers.find((p) => p.getName() === "TMDB") || providers[0];
const provider = tmdbProvider;
const enricher = createTmdbEnricher({ apiKey: config.tmdbApiKey, cache: tmdbCache });
const streamManager = createStreamManager({
  ffmpegPath: config.ffmpegPath,
  ffprobePath: config.ffprobePath,
  maxConcurrent: config.maxConcurrentSessions,
  sessionMaxAgeMs: config.sessionMaxAgeMs,
  reaperIntervalMs: config.sessionReaperIntervalMs
});
const resolver = createResolver({
  providers,
  fixturePath: config.fixturePath,
  allowFixture: config.fixtureFallback,
  extensionManager
});

const app = express();
const PORT = config.port;
const VERSION = "0.3.0";

app.use(express.json({ limit: "16kb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "streamix-server",
    version: VERSION,
    service: "STREAMIX API (this is the backend; the web UI is served separately by Vite)",
    client: "http://localhost:5173",
    endpoints: [
      "GET  /api/health",
      "GET  /api/home/trending",
      "GET  /api/home/latest",
      "GET  /api/home/popular-series",
      "GET  /api/search?q=<query>",
      "GET  /api/detail/:type/:id?provider=<name>",
      "GET  /api/providers/status",
      "POST /api/stream/:type/:id?provider=<name>",
      "GET  /api/stream/:sessionId/master.m3u8"
    ]
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "streamix-server",
    version: VERSION,
    time: new Date().toISOString()
  });
});

app.use("/api/home", homeRouter({ tmdbProvider, provider, enricher, cache: routeCache }));
app.use("/api", searchRouter({ provider, tmdbProvider, enricher, cache: routeCache }));
app.use("/api", detailRouter({ provider, cache: routeCache, providerOptions: { cache: providerCache } }));
app.use("/api", extensionsRouter());
app.use(
  "/api",
  streamRouter({
    resolver,
    streamManager,
    defaultLanguage: config.preferredAudioLanguage,
    sessionMaxSeconds: config.sessionMaxSeconds
  })
);
app.use("/api", providersRouter({ fixtureFallback: config.fixtureFallback }));

app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `No route for ${req.method} ${req.originalUrl}`,
    hint: "API routes live under /api/*. See GET / for the endpoint list. The web UI runs on http://localhost:5173"
  });
});

app.listen(PORT, async () => {
  logger.info("server.start", { port: PORT, provider: provider.getName(), tmdbEnrichment: enricher.isEnabled ? "enabled" : "disabled" });
  try {
    await extensionManager.start();
    logger.info("extensions.ready", {});
  } catch (err) {
    logger.error("extensions.start_failed", { error: err.message });
  }
  try {
    await streamManager.initHlsDir();
    logger.info("hls.workspace_ready", {});
  } catch (err) {
    logger.error("hls.workspace_init_failed", { error: err.message });
  }
});
