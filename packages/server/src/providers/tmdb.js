const TMDB_API = "https://api.themoviedb.org/3";
const SEARCH_TIMEOUT_MS = 4000;
const ENRICH_CONCURRENCY = 4;

function normalizeYear(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const match = String(value).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function matchesYear(a, b, tolerance = 1) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function createTmdbEnricher({ apiKey, cache }) {
  const enabled = Boolean(apiKey);

  async function search(type, query, year) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const url = `${TMDB_API}/search/${type}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US${year ? `&year=${year}` : ""}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results ?? [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async function enrichItem(item) {
    if (!item.title || !item.year) return null;
    const type = item.type === "series" ? "tv" : "movie";
    const cacheKey = `tmdb:${type}:${item.title.toLowerCase()}:${item.year}`;
    const cached = cache?.get(cacheKey);
    if (cached !== undefined) return cached === "none" ? null : cached;

    const results = await search(type, item.title, item.year);
    const hit = results.find((r) => matchesYear(normalizeYear(r.release_date ?? r.first_air_date), item.year));
    if (!hit) {
      cache?.set(cacheKey, "none", 86400000);
      return null;
    }
    const enriched = {
      tmdbId: hit.id,
      title: hit.title ?? hit.name,
      year: normalizeYear(hit.release_date ?? hit.first_air_date) ?? item.year,
      poster: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : null,
      backdrop: hit.backdrop_path ? `https://image.tmdb.org/t/p/original${hit.backdrop_path}` : null,
      overview: hit.overview || null,
      rating: typeof hit.vote_average === "number" ? Math.round(hit.vote_average * 10) / 10 : null,
      source: "TMDB"
    };
    cache?.set(cacheKey, enriched, 86400000);
    return enriched;
  }

  async function enrich(items) {
    if (!enabled) {
      return { items, status: "disabled", reason: "no_tmdb_key", matched: 0 };
    }
    let matched = 0;
    const enrichedItems = await mapWithConcurrency(items, ENRICH_CONCURRENCY, async (item) => {
      const enriched = await enrichItem(item);
      if (enriched) {
        matched += 1;
        return { ...item, enriched };
      }
      return item;
    });
    return { items: enrichedItems, status: "enabled", reason: null, matched };
  }

  return { enrich, isEnabled: enabled };
}