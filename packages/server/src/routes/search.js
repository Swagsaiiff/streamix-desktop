import { Router } from "express";
import { sendError } from "../errors.js";
import { logger } from "../logger.js";
import { listSearchProviders } from "../providers/index.js";

const CACHE_TTL_MS = 600000;
// Must exceed the provider's own per-request timeout (15s) so a slow provider returns
// partial results instead of being dropped wholesale during traffic spikes.
const PROVIDER_TIMEOUT_MS = 20000;

function validateQuery(value) {
  if (value == null) return { error: "Missing required query parameter 'q'." };
  const q = String(value).trim();
  if (q.length < 2) return { error: "Query 'q' must be at least 2 characters." };
  if (q.length > 100) return { error: "Query 'q' must be at most 100 characters." };
  if (/[\u0000-\u001f\u007f]/.test(q)) return { error: "Query 'q' contains invalid control characters." };
  return { q };
}

function dedupeKey(item) {
  const title = normalizeTitle(item.title);
  return `${item.type}:${title}:${item.year ?? ""}`;
}

export function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function relevanceScore(query, item) {
  const q = normalizeTitle(query);
  const t = normalizeTitle(item.title);
  if (!q || !t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(`${q} `)) return 800 - Math.min(80, t.length - q.length);
  if (t.startsWith(q)) return 750;
  if (new RegExp(`(?:^| )${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(t)) return 600;
  if (q.split(" ").every((token) => t.split(" ").includes(token))) return 450;
  if (t.includes(q)) return 350;

  const qTokens = q.split(" ").filter(Boolean);
  const tTokens = new Set(t.split(" ").filter(Boolean));
  const overlap = qTokens.filter((token) => tTokens.has(token)).length;
  return qTokens.length > 0 ? Math.round((overlap / qTokens.length) * 200) : 0;
}

export function rankSearchResults(items, query) {
  return items
    .map((item, index) => ({ item, index, score: relevanceScore(query, item) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const yearA = Number(a.item.year) || 0;
      const yearB = Number(b.item.year) || 0;
      if (yearB !== yearA) return yearB - yearA;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

export function mergeSearchResults(resultSets) {
  const seen = new Map();
  const merged = [];
  for (const { items } of resultSets) {
    for (const item of items) {
      const key = dedupeKey(item);
      if (seen.has(key)) continue;
      seen.set(key, true);
      merged.push(item);
    }
  }
  return merged;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function searchRouter({ provider, enricher, cache }) {
  const router = Router();

  router.get("/search", async (req, res) => {
    const validated = validateQuery(req.query.q);
    if (validated.error) {
      return res.status(400).json({ error: "validation_error", message: validated.error });
    }
    const q = validated.q;
    const cacheKey = `route:search:${q.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const searchProviders = listSearchProviders({ cache });
    const diagnostics = [];

    const settled = await Promise.all(
      searchProviders.map(async (sp) => {
        const name = sp.getName();
        const started = Date.now();
        try {
          const items = await withTimeout(sp.search(q), PROVIDER_TIMEOUT_MS, name);
          const ms = Date.now() - started;
          diagnostics.push({ provider: name, count: items.length, ms, error: null });
          logger.info("search.provider_result", { provider: name, query: q, count: items.length, ms });
          return { provider: name, items };
        } catch (err) {
          const ms = Date.now() - started;
          diagnostics.push({ provider: name, count: 0, ms, error: err.code ?? "error" });
          logger.warn("search.provider_error", { provider: name, query: q, code: err.code ?? "error", ms });
          return { provider: name, items: [] };
        }
      })
    );

    const successful = settled.filter((entry) => entry.items.length > 0);
    if (successful.length === 0) {
      const allFailed = diagnostics.every((d) => d.error !== null);
      logger.warn("search.no_results", { query: q, allFailed, diagnostics });
    }

    const items = rankSearchResults(mergeSearchResults(settled), q);
    const body = {
      query: q,
      count: items.length,
      providers: diagnostics,
      enrichment: enricher.isEnabled
        ? { status: "pending", reason: null, matched: null }
        : { status: "disabled", reason: "no_tmdb_key", matched: 0 },
      cached: false,
      stale: false,
      items
    };
    cache.set(cacheKey, body, CACHE_TTL_MS);

    if (enricher.isEnabled) {
      enricher
        .enrich(items)
        .then(({ items: enrichedItems, matched }) => {
          cache.set(
            cacheKey,
            { ...body, enrichment: { status: "enabled", reason: null, matched }, items: enrichedItems },
            CACHE_TTL_MS
          );
        })
        .catch(() => {});
    }

    return res.json(body);
  });

  return router;
}
