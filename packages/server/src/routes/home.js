import { Router } from "express";
import { sendError } from "../errors.js";
import { logger } from "../logger.js";

const ROW_LIMIT = 24;
const CACHE_TTL_MS = 300000;

function buildRows(tmdbProvider) {
  return [
    {
      key: "trending",
      title: "Trending Movies",
      ranking: "TMDB trending movies of the week",
      fetch: () => tmdbProvider.getTrendingMovies(ROW_LIMIT)
    },
    {
      key: "popular-movies",
      title: "Popular Movies",
      ranking: "TMDB popular movies",
      fetch: () => tmdbProvider.getPopularMovies(ROW_LIMIT)
    },
    {
      key: "new-releases",
      title: "New Releases",
      ranking: "TMDB movies currently in theatres and on release",
      fetch: () => tmdbProvider.getNewReleases(ROW_LIMIT)
    },
    {
      key: "top-rated",
      title: "Top Rated Movies",
      ranking: "TMDB highest-rated movies of all time",
      fetch: () => tmdbProvider.getTopRatedMovies(ROW_LIMIT)
    },
    {
      key: "action",
      title: "Action Movies",
      ranking: "TMDB Action movies catalog",
      fetch: () => tmdbProvider.getActionMovies(ROW_LIMIT)
    },
    {
      key: "comedy",
      title: "Comedy Movies",
      ranking: "TMDB Comedy movies catalog",
      fetch: () => tmdbProvider.getComedyMovies(ROW_LIMIT)
    },
    {
      key: "horror",
      title: "Horror Movies",
      ranking: "TMDB Horror movies catalog",
      fetch: () => tmdbProvider.getHorrorMovies(ROW_LIMIT)
    },
    {
      key: "popular-series",
      title: "Popular Series",
      ranking: "TMDB popular TV series",
      fetch: () => tmdbProvider.getPopularSeries(ROW_LIMIT)
    },
    {
      key: "action-series",
      title: "Action Series",
      ranking: "TMDB Action & Adventure TV series catalog",
      fetch: () => tmdbProvider.getActionSeries(ROW_LIMIT)
    },
    {
      key: "anime-airing",
      title: "Airing Anime",
      ranking: "TMDB Japanese animation currently airing or recent",
      fetch: () => tmdbProvider.getAnimeAiring(ROW_LIMIT)
    },
    {
      key: "anime-trending",
      title: "Trending Anime",
      ranking: "TMDB popular Japanese animation",
      fetch: () => tmdbProvider.getAnimeTrending(ROW_LIMIT)
    }
  ];
}

async function loadRow(row) {
  const items = await row.fetch();
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const dedupeKey = `${item.type}:${item.tmdbId ?? item.id}`;
    if (!item.id || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push({
      ...item,
      provider: "TMDB",
      source: "TMDB"
    });
    if (unique.length >= ROW_LIMIT) break;
  }
  return {
    key: row.key,
    title: row.title,
    ranking: row.ranking,
    provider: "TMDB",
    count: unique.length,
    items: unique
  };
}

export function homeRouter({ tmdbProvider, provider, cache }) {
  const router = Router();
  const activeProvider = tmdbProvider ?? (provider?.getName() === "TMDB" ? provider : null);

  async function serveRows(requestedKeys, res, cacheKey) {
    if (!activeProvider || !activeProvider.isConfigured?.()) {
      return res.status(503).json({
        error: "configuration_error",
        code: "missing_tmdb_api_key",
        message: "TMDB API key is not configured. Configure TMDB_API_KEY in .env or application settings.",
        hint: "Get a free API key from https://www.themoviedb.org/settings/api and add TMDB_API_KEY=<your_key> to .env or desktop config."
      });
    }

    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const rows = buildRows(activeProvider);
    const selected = requestedKeys ? rows.filter((row) => requestedKeys.includes(row.key)) : rows;
    const results = await Promise.allSettled(selected.map((row) => loadRow(row)));
    const loaded = [];
    const failures = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        loaded.push(result.value);
      } else {
        const reason = result.reason;
        const code = reason?.code ?? "error";
        failures.push({
          key: selected[index].key,
          code,
          message: reason?.message ?? "failed"
        });
        logger.warn("home.row_failed", { key: selected[index].key, code, message: reason?.message });
      }
    });

    if (loaded.length === 0) {
      const unauthorizedFailure = failures.find(
        (f) => f.code === "unauthorized" || (f.message && f.message.includes("401"))
      );
      if (unauthorizedFailure) {
        return res.status(401).json({
          error: "configuration_error",
          code: "invalid_tmdb_api_key",
          message: "TMDB API key is invalid or unauthorized (HTTP 401). Please verify your TMDB_API_KEY.",
          hint: "Check your TMDB_API_KEY in .env or desktop config."
        });
      }

      const stale = cache.get(cacheKey);
      if (stale) return res.json({ ...stale, cached: true, stale: true });
      return sendError(res, new Error("all home rows failed: " + (failures[0]?.message ?? "TMDB request failed")));
    }

    const body = {
      rows: loaded,
      failures,
      cached: false,
      stale: false,
      generatedAt: new Date().toISOString()
    };
    cache.set(cacheKey, body, CACHE_TTL_MS);
    return res.json(body);
  }

  router.get("/", async (_req, res) => {
    try {
      return await serveRows(null, res, "route:home:all");
    } catch (err) {
      return sendError(res, err);
    }
  });

  const singleRoutes = [
    ["trending", "route:home:trending"],
    ["popular-movies", "route:home:popular-movies"],
    ["new-releases", "route:home:new-releases"],
    ["top-rated", "route:home:top-rated"],
    ["action", "route:home:action"],
    ["comedy", "route:home:comedy"],
    ["horror", "route:home:horror"],
    ["popular-series", "route:home:popular-series"],
    ["action-series", "route:home:action-series"],
    ["anime-airing", "route:home:anime-airing"],
    ["anime-trending", "route:home:anime-trending"]
  ];

  for (const [key, cacheKey] of singleRoutes) {
    router.get(`/${key}`, async (_req, res) => {
      try {
        return await serveRows([key], res, cacheKey);
      } catch (err) {
        return sendError(res, err);
      }
    });
  }

  // Backwards-compatible alias: "latest" -> "new-releases"
  router.get("/latest", async (_req, res) => {
    try {
      return await serveRows(["new-releases"], res, "route:home:new-releases");
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
}
