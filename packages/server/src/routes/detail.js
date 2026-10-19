import { Router } from "express";
import { sendError } from "../errors.js";
import { getProviderByName } from "../providers/index.js";

const CACHE_TTL_MS = 300000;

function validateType(value) {
  return value === "movie" || value === "series" ? value : null;
}

function validateId(value) {
  if (value == null) return null;
  const id = String(value).trim();
  if (id.length < 1 || id.length > 300) return null;
  if (/[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

export function detailRouter({ provider, cache, providerOptions = {} }) {
  const router = Router();

  router.get("/detail/:type/:id", async (req, res) => {
    const type = validateType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "validation_error", message: "Type must be 'movie' or 'series'." });
    }
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "validation_error", message: "Invalid or missing id." });
    }

    const providerName = req.query.provider ? String(req.query.provider) : provider.getName();
    const adapter = getProviderByName(providerName, providerOptions) ?? provider;

    const cacheKey = `route:detail:${adapter.getName()}:${type}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    try {
      const item = await adapter.getDetails(type, id);
      const body = { item, cached: false, stale: false };
      cache.set(cacheKey, body, CACHE_TTL_MS);
      return res.json(body);
    } catch (err) {
      const stale = cache.get(cacheKey);
      if (stale) {
        return res.json({ ...stale, cached: true, stale: true });
      }
      return sendError(res, err);
    }
  });

  return router;
}