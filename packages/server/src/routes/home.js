import { Router } from "express";
import { sendError } from "../errors.js";
import { logger } from "../logger.js";

const ROW_LIMIT = 24;
const CACHE_TTL_MS = 300000;
const PROVIDER_RANKING = "CineStream top catalog";

function sortByRating(items) {
  return [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

function sortByYear(items) {
  return [...items].filter((item) => item.year != null).sort((a, b) => b.year - a.year);
}

function sortByPopularity(items) {
  return [...items].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

function buildRows(provider) {
  return [
    {
      key: "trending",
      title: "Trending Movies",
      ranking: `${PROVIDER_RANKING}, ordered by the provider's own popularity metric`,
      fetch: () => provider.getTopMovies(3)
    },
    {
      key: "popular-movies",
      title: "Popular Movies",
      ranking: `${PROVIDER_RANKING} (next popularity band, pages 3-6)`,
      fetch: async () => sortByPopularity(await provider.getTopMovies(4, 147))
    },
    {
      key: "new-releases",
      title: "New Releases",
      ranking: `${PROVIDER_RANKING}, newest-first by release year (provider exposes no dedicated latest feed)`,
      fetch: async () => sortByYear(await provider.getTopMovies(4, 343))
    },
    {
      key: "top-rated",
      title: "Top Rated Movies",
      ranking: `${PROVIDER_RANKING}, sorted by industry rating (IMDb) descending`,
      fetch: async () => sortByRating(await provider.getTopMovies(4, 539))
    },
    {
      key: "action",
      title: "Action Movies",
      ranking: `${PROVIDER_RANKING} filtered by the provider's Action genre`,
      fetch: () => provider.getCatalogByGenre("movie", "Action", 2)
    },
    {
      key: "comedy",
      title: "Comedy Movies",
      ranking: `${PROVIDER_RANKING} filtered by the provider's Comedy genre`,
      fetch: () => provider.getCatalogByGenre("movie", "Comedy", 2)
    },
    {
      key: "horror",
      title: "Horror Movies",
      ranking: `${PROVIDER_RANKING} filtered by the provider's Horror genre`,
      fetch: () => provider.getCatalogByGenre("movie", "Horror", 2)
    },
    {
      key: "popular-series",
      title: "Popular Series",
      ranking: `${PROVIDER_RANKING}, series catalog ordered by the provider's own popularity metric`,
      fetch: () => provider.getTopSeries(3)
    },
    {
      key: "action-series",
      title: "Action Series",
      ranking: `${PROVIDER_RANKING}, series catalog filtered by the provider's Action genre`,
      fetch: () => provider.getCatalogByGenre("series", "Action", 2)
    },
    {
      key: "anime-airing",
      title: "Airing Anime",
      ranking: "Kitsu anime catalog (kitsu-anime-airing) served by the provider",
      fetch: () => provider.getKitsuCatalog("kitsu-anime-airing", 2)
    },
    {
      key: "anime-trending",
      title: "Trending Anime",
      ranking: "Kitsu anime catalog (kitsu-anime-trending) served by the provider",
      fetch: () => provider.getKitsuCatalog("kitsu-anime-trending", 2)
    }
  ];
}

async function loadRow(row, seen) {
  const items = await row.fetch();
  const unique = [];
  for (const item of items) {
    const dedupeKey = `${item.type}:${String(item.title ?? "").toLowerCase()}:${item.year ?? ""}`;
    if (!item.id || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push(item);
    if (unique.length >= ROW_LIMIT) break;
  }
  return {
    key: row.key,
    title: row.title,
    ranking: row.ranking,
    provider: "CineStream",
    count: unique.length,
    items: unique
  };
}

export function homeRouter({ provider, enricher, cache }) {
  const router = Router();
  const rows = buildRows(provider);

  async function serveRows(requestedKeys, res, cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const selected = requestedKeys ? rows.filter((row) => requestedKeys.includes(row.key)) : rows;
    const seen = new Set();
    const results = await Promise.allSettled(selected.map((row) => loadRow(row, seen)));
    const loaded = [];
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") loaded.push(result.value);
      else {
        failures.push({ key: selected[index].key, message: result.reason?.message ?? "failed" });
        logger.warn("home.row_failed", { key: selected[index].key, code: result.reason?.code ?? "error" });
      }
    });

    if (loaded.length === 0) {
      const stale = cache.get(cacheKey);
      if (stale) return res.json({ ...stale, cached: true, stale: true });
      return sendError(res, new Error("all home rows failed"));
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

  // Backwards-compatible alias: the old "latest" row is now "New Releases".
  router.get("/latest", async (_req, res) => {
    try {
      return await serveRows(["new-releases"], res, "route:home:new-releases");
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
}
