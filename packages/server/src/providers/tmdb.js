import { BaseProvider, ProviderError } from "./base.js";
import { config } from "../config.js";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w500";
const BACKDROP_SIZE = "original";
const SEARCH_TIMEOUT_MS = 4000;
const ENRICH_CONCURRENCY = 4;
const DEFAULT_PAGE_LIMIT = 24;

export function normalizeYear(value) {
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

export function getTmdbImageUrl(path, size = POSTER_SIZE) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${TMDB_IMAGE_BASE}/${size}${path.startsWith("/") ? "" : "/"}${path}`;
}

export class TMDBProvider extends BaseProvider {
  constructor(options = {}) {
    super({ name: "TMDB", timeoutMs: options.timeoutMs ?? 15000, ...options });
    this.apiKey = options.apiKey !== undefined ? options.apiKey : config.tmdbApiKey;
    this.cache = options.cache ?? null;
    this.genreMaps = new Map();
  }

  getName() {
    return "TMDB";
  }

  isConfigured() {
    return Boolean(this.apiKey && String(this.apiKey).trim().length > 0);
  }

  getCapabilities() {
    return {
      supportsHomePage: true,
      supportsSearch: true,
      supportsDetail: true,
      supportsStreamResolution: false,
      rankingMethod: "TMDB official catalog & discovery endpoints",
      homeCatalogTypes: ["movie", "series"]
    };
  }

  async request(endpoint, queryParams = {}) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "TMDB API key is missing. Configure TMDB_API_KEY in .env or application settings.",
        "unauthorized"
      );
    }
    const params = new URLSearchParams({
      api_key: String(this.apiKey).trim(),
      language: "en-US",
      ...queryParams
    });
    const url = `${TMDB_API}${endpoint}?${params.toString()}`;
    const cacheKey = this.cache ? `tmdb:http:${endpoint}:${params.toString()}` : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    try {
      const data = await this.fetchJson(url);
      if (cacheKey) {
        this.cache.set(cacheKey, data, 300000);
      }
      return data;
    } catch (err) {
      if (err.message && err.message.includes("401")) {
        throw new ProviderError("TMDB API key is invalid or unauthorized (HTTP 401).", "unauthorized", err);
      }
      if (err.message && err.message.includes("404")) {
        throw new ProviderError("Requested TMDB item was not found (HTTP 404).", "not_found", err);
      }
      if (err.message && err.message.includes("429")) {
        throw new ProviderError("TMDB rate limit exceeded (HTTP 429).", "rate_limit", err);
      }
      throw err;
    }
  }

  async getGenreMap(mediaType = "movie") {
    const key = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
    if (this.genreMaps.has(key)) {
      return this.genreMaps.get(key);
    }
    const cacheKey = this.cache ? `tmdb:genres:${key}` : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.genreMaps.set(key, cached);
        return cached;
      }
    }
    try {
      const data = await this.request(`/genre/${key}/list`);
      const map = new Map((data.genres ?? []).map((g) => [g.id, g.name]));
      this.genreMaps.set(key, map);
      if (cacheKey) this.cache.set(cacheKey, map, 86400000);
      return map;
    } catch {
      return new Map();
    }
  }

  normalizeItem(raw, defaultType = "movie", genreMap = null) {
    if (!raw || !raw.id) return null;
    const isTv =
      raw.media_type === "tv" ||
      defaultType === "series" ||
      defaultType === "tv" ||
      raw.first_air_date !== undefined ||
      Boolean(raw.name && !raw.title);
    const type = isTv ? "series" : "movie";
    const title = raw.title || raw.name || "Untitled";
    const year = normalizeYear(raw.release_date ?? raw.first_air_date);

    let genres = null;
    if (Array.isArray(raw.genres) && raw.genres.length > 0) {
      genres = raw.genres.map((g) => (typeof g === "string" ? g : g.name)).filter(Boolean);
    } else if (Array.isArray(raw.genre_ids) && raw.genre_ids.length > 0 && genreMap) {
      genres = raw.genre_ids.map((id) => genreMap.get(id)).filter(Boolean);
    }

    return {
      id: String(raw.id),
      tmdbId: Number(raw.id),
      type,
      provider: "TMDB",
      source: "TMDB",
      title,
      year,
      poster: getTmdbImageUrl(raw.poster_path, POSTER_SIZE),
      backdrop: getTmdbImageUrl(raw.backdrop_path, BACKDROP_SIZE),
      overview: raw.overview || null,
      rating: typeof raw.vote_average === "number" ? Math.round(raw.vote_average * 10) / 10 : null,
      popularity: typeof raw.popularity === "number" ? Math.round(raw.popularity * 10) / 10 : null,
      genres: genres && genres.length > 0 ? genres : null,
      originalMediaType: raw.media_type || (isTv ? "tv" : "movie")
    };
  }

  async fetchCatalogPage(endpoint, queryParams = {}, defaultType = "movie") {
    const data = await this.request(endpoint, queryParams);
    const mediaType = defaultType === "series" ? "tv" : defaultType;
    const genreMap = await this.getGenreMap(mediaType);
    return (data.results ?? []).map((raw) => this.normalizeItem(raw, defaultType, genreMap)).filter(Boolean);
  }

  async getTrendingMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage("/trending/movie/week", { page: "1" }, "movie");
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage("/trending/movie/week", { page: "2" }, "movie");
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getPopularMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage("/movie/popular", { page: "1" }, "movie");
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage("/movie/popular", { page: "2" }, "movie");
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getNewReleases(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage("/movie/now_playing", { page: "1" }, "movie");
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage("/movie/now_playing", { page: "2" }, "movie");
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getTopRatedMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage("/movie/top_rated", { page: "1" }, "movie");
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage("/movie/top_rated", { page: "2" }, "movie");
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getActionMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage(
      "/discover/movie",
      { with_genres: "28", sort_by: "popularity.desc", page: "1" },
      "movie"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/movie",
        { with_genres: "28", sort_by: "popularity.desc", page: "2" },
        "movie"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getComedyMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage(
      "/discover/movie",
      { with_genres: "35", sort_by: "popularity.desc", page: "1" },
      "movie"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/movie",
        { with_genres: "35", sort_by: "popularity.desc", page: "2" },
        "movie"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getHorrorMovies(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage(
      "/discover/movie",
      { with_genres: "27", sort_by: "popularity.desc", page: "1" },
      "movie"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/movie",
        { with_genres: "27", sort_by: "popularity.desc", page: "2" },
        "movie"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getPopularSeries(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage("/tv/popular", { page: "1" }, "series");
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage("/tv/popular", { page: "2" }, "series");
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getActionSeries(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage(
      "/discover/tv",
      { with_genres: "10759", sort_by: "popularity.desc", page: "1" },
      "series"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/tv",
        { with_genres: "10759", sort_by: "popularity.desc", page: "2" },
        "series"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getAnimeAiring(limit = DEFAULT_PAGE_LIMIT) {
    const now = Date.now();
    const gte = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    const lte = new Date(now + 14 * 86400000).toISOString().slice(0, 10);
    const items = await this.fetchCatalogPage(
      "/discover/tv",
      {
        with_genres: "16",
        with_origin_country: "JP",
        "air_date.gte": gte,
        "air_date.lte": lte,
        sort_by: "popularity.desc",
        page: "1"
      },
      "series"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/tv",
        {
          with_genres: "16",
          with_origin_country: "JP",
          "air_date.gte": gte,
          "air_date.lte": lte,
          sort_by: "popularity.desc",
          page: "2"
        },
        "series"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async getAnimeTrending(limit = DEFAULT_PAGE_LIMIT) {
    const items = await this.fetchCatalogPage(
      "/discover/tv",
      {
        with_genres: "16",
        with_origin_country: "JP",
        sort_by: "popularity.desc",
        page: "1"
      },
      "series"
    );
    if (items.length < limit) {
      const page2 = await this.fetchCatalogPage(
        "/discover/tv",
        {
          with_genres: "16",
          with_origin_country: "JP",
          sort_by: "popularity.desc",
          page: "2"
        },
        "series"
      );
      return [...items, ...page2].slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async search(query) {
    if (!query || String(query).trim().length === 0) return [];
    const data = await this.request("/search/multi", {
      query: String(query).trim(),
      include_adult: "false",
      page: "1"
    });
    const results = data.results ?? [];
    const movieGenreMap = await this.getGenreMap("movie");
    const tvGenreMap = await this.getGenreMap("tv");

    const items = [];
    for (const raw of results) {
      if (raw.media_type !== "movie" && raw.media_type !== "tv") continue;
      const isTv = raw.media_type === "tv";
      const normalized = this.normalizeItem(raw, isTv ? "series" : "movie", isTv ? tvGenreMap : movieGenreMap);
      if (normalized) items.push(normalized);
    }
    return items;
  }

  async getDetails(type, id) {
    const isTv = type === "series" || type === "tv";
    const endpoint = isTv ? `/tv/${encodeURIComponent(id)}` : `/movie/${encodeURIComponent(id)}`;
    const data = await this.request(endpoint, {
      append_to_response: "credits,external_ids"
    });

    const base = this.normalizeItem(data, isTv ? "series" : "movie");

    if (!isTv) {
      return {
        ...base,
        runtime: data.runtime ? `${data.runtime} min` : null,
        cast: Array.isArray(data.credits?.cast)
          ? data.credits.cast.map((c) => c.name).filter(Boolean).slice(0, 12)
          : null,
        director: Array.isArray(data.credits?.crew)
          ? data.credits.crew.filter((c) => c.job === "Director").map((c) => c.name).slice(0, 4)
          : null,
        writer: Array.isArray(data.credits?.crew)
          ? data.credits.crew.filter((c) => c.job === "Writer" || c.job === "Screenplay").map((c) => c.name).slice(0, 4)
          : null,
        country: data.production_countries?.[0]?.name ?? null,
        language: data.spoken_languages?.[0]?.english_name ?? data.original_language ?? null,
        awards: null,
        released: data.release_date ?? null,
        status: data.status ?? null,
        imdbId: data.external_ids?.imdb_id ?? null,
        episodes: null
      };
    }

    const regularSeasons = (data.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number);

    const seasonsToLoad = regularSeasons.slice(0, 10);
    const seasonBatches = await mapWithConcurrency(seasonsToLoad, 4, async (season) => {
      try {
        const sData = await this.request(`/tv/${encodeURIComponent(id)}/season/${season.season_number}`);
        return (sData.episodes ?? []).map((ep) => ({
          id: ep.id ? String(ep.id) : `${season.season_number}-${ep.episode_number}`,
          season: ep.season_number,
          episode: ep.episode_number,
          name: ep.name || `Episode ${ep.episode_number}`,
          overview: ep.overview || null,
          thumbnail: getTmdbImageUrl(ep.still_path, POSTER_SIZE),
          firstAired: ep.air_date || null,
          rating: typeof ep.vote_average === "number" ? Math.round(ep.vote_average * 10) / 10 : null,
          runtime: ep.runtime ? `${ep.runtime} min` : null
        }));
      } catch {
        return [];
      }
    });

    const episodes = seasonBatches.flat().sort((a, b) => a.season - b.season || a.episode - b.episode);

    return {
      ...base,
      runtime: data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min` : null,
      cast: Array.isArray(data.credits?.cast)
        ? data.credits.cast.map((c) => c.name).filter(Boolean).slice(0, 12)
        : null,
      director: Array.isArray(data.created_by)
        ? data.created_by.map((c) => c.name).filter(Boolean).slice(0, 4)
        : null,
      writer: null,
      country: data.origin_country?.[0] ?? null,
      language: data.spoken_languages?.[0]?.english_name ?? data.original_language ?? null,
      awards: null,
      released: data.first_air_date ?? null,
      status: data.status ?? null,
      imdbId: data.external_ids?.imdb_id ?? null,
      episodes: episodes.length > 0 ? episodes : null
    };
  }
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
      poster: getTmdbImageUrl(hit.poster_path, POSTER_SIZE),
      backdrop: getTmdbImageUrl(hit.backdrop_path, BACKDROP_SIZE),
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