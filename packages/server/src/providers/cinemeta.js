import { BaseProvider, ProviderError } from "./base.js";

const CINEMETA_CATALOGS = "https://cinemeta-catalogs.strem.io";
const CINEMETA = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";
const IMAGE_PROXY = "https://wsrv.nl/?url=";
const CATALOG_PAGE_SIZE = 49;

function getPosterUrl(url) {
  if (!url) return null;
  if (url.includes("kitsu.")) return IMAGE_PROXY + url;
  return url;
}

function parseYear(raw, releaseInfo) {
  const source = raw ?? releaseInfo ?? "";
  const match = String(source).match(/(\d{4})/);
  if (!match) return null;
  return Number(match[1]);
}

function toType(type) {
  return type === "movie" ? "movie" : "series";
}

export function normalizeMeta(meta) {
  const type = toType(meta.type);
  return {
    id: meta.id ?? null,
    title: meta.aliases?.find(Boolean) ?? meta.name ?? "",
    type,
    poster: getPosterUrl(meta.poster),
    backdrop: getPosterUrl(meta.background),
    overview: meta.description ?? null,
    year: parseYear(meta.year, meta.releaseInfo),
    releaseInfo: meta.releaseInfo ?? null,
    genres: meta.genre ?? meta.genres ?? null,
    rating: Number.parseFloat(meta.imdbRating) || null,
    popularity: typeof meta.popularity === "number" ? meta.popularity : null,
    source: "CineStream",
    provider: "CineStream",
    sourceUrl: `${CINEMETA}/meta/${type}/${meta.id}.json`
  };
}

export function normalizeDetail(meta) {
  const base = normalizeMeta(meta);
  const shared = {
    runtime: meta.runtime ?? null,
    cast: Array.isArray(meta.cast) ? meta.cast.slice(0, 12) : null,
    director: Array.isArray(meta.director) ? meta.director.slice(0, 4) : null,
    writer: Array.isArray(meta.writer) ? meta.writer.slice(0, 4) : null,
    country: meta.country ?? null,
    language: meta.language ?? null,
    awards: meta.awards ?? null,
    released: meta.released ?? null,
    status: meta.status ?? null
  };
  if (base.type === "movie") {
    return { ...base, ...shared, episodes: null };
  }
  const episodes = (meta.videos ?? [])
    .filter((ep) => ep.season != null && ep.season !== 0)
    .map((ep) => ({
      id: ep.id ?? null,
      season: ep.season ?? null,
      episode: ep.episode ?? ep.number ?? null,
      name: ep.name ?? ep.title ?? null,
      overview: ep.overview ?? ep.description ?? null,
      thumbnail: getPosterUrl(ep.thumbnail),
      firstAired: ep.firstAired ?? ep.released ?? null,
      rating: Number.parseFloat(ep.rating) || null,
      runtime: ep.runtime ?? null
    }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  return { ...base, ...shared, episodes };
}

export class CineStreamProvider extends BaseProvider {
  constructor(options = {}) {
    super({ name: "CineStream", timeoutMs: 15000, ...options });
    this.cache = options.cache ?? null;
  }

  getName() {
    return "CineStream";
  }

  getCapabilities() {
    return {
      supportsHomePage: true,
      supportsSearch: true,
      supportsDetail: true,
      supportsStreamResolution: false,
      rankingMethod: "CineStream top catalog, ordered by the provider's own popularity metric",
      homeCatalogTypes: ["movie", "series"]
    };
  }

  async fetchCatalog(type, skip, { genre } = {}) {
    let url = `${CINEMETA_CATALOGS}/top/catalog/${type}/top/skip=${skip}`;
    if (genre) url += `&genre=${encodeURIComponent(genre)}`;
    url += ".json";
    const cacheKey = this.cache ? `cinemeta:catalog:${url}` : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    const data = await this.fetchJson(url);
    const items = (data.metas ?? []).map(normalizeMeta);
    if (cacheKey) this.cache.set(cacheKey, items, 300000);
    return items;
  }

  dedupe(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  async getTopMovies(pages = 3, startSkip = 0) {
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        this.fetchCatalog("movie", startSkip + i * CATALOG_PAGE_SIZE)
      )
    );
    return this.dedupe(batches.flat());
  }

  async getTopSeries(pages = 3, startSkip = 0) {
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        this.fetchCatalog("series", startSkip + i * CATALOG_PAGE_SIZE)
      )
    );
    return this.dedupe(batches.flat());
  }

  async getCatalogByGenre(type, genre, pages = 2, startSkip = 0) {
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        this.fetchCatalog(type, startSkip + i * CATALOG_PAGE_SIZE, { genre })
      )
    );
    return this.dedupe(batches.flat());
  }

  async getKitsuCatalog(catalogId, pages = 2) {
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) => this.fetchKitsuCatalogPage(catalogId, i * CATALOG_PAGE_SIZE))
    );
    return this.dedupe(batches.flat());
  }

  async fetchKitsuCatalogPage(catalogId, skip) {
    const url = `${KITSU}/catalog/anime/${catalogId}/skip=${skip}.json`;
    const cacheKey = this.cache ? `kitsu:catalog:${url}` : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    const data = await this.fetchJson(url);
    const items = (data.metas ?? []).map(normalizeMeta);
    if (cacheKey) this.cache.set(cacheKey, items, 300000);
    return items;
  }

  async search(query) {
    const endpoints = [
      `${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(query)}.json`,
      `${CINEMETA}/catalog/series/top/search=${encodeURIComponent(query)}.json`,
      `${KITSU}/catalog/anime/kitsu-anime-airing/search=${encodeURIComponent(query)}.json`
    ];
    const results = await Promise.allSettled(endpoints.map((url) => this.fetchJson(url)));
    const items = results
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => (result.value.metas ?? []).map(normalizeMeta));
    return this.dedupe(items);
  }

  async getDetails(type, id) {
    const isKitsu = id.includes("kitsu") || id.includes("mal");
    const base = isKitsu ? KITSU : CINEMETA;
    const rawId = isKitsu ? id.replace(":", "%3A") : id;
    const data = await this.fetchJson(`${base}/meta/${toType(type)}/${rawId}.json`);
    const meta = data?.meta;
    if (!meta) throw new ProviderError(`no meta found for ${type}/${id}`, "parse");
    return normalizeDetail(meta);
  }
}
