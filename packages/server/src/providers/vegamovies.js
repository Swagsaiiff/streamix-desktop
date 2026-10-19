import { BaseProvider, ProviderError } from "./base.js";
import { logger } from "../logger.js";

const URLS_JSON = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
const FALLBACK_BASE = "https://new1.vegamovies.lease";
const CINEMETA = "https://v3-cinemeta.strem.io";
const HOST_PATTERN = /(nexdrive\.|vcloud\.|hubcloud\.|fastdl\.|filebee\.|vegadrive\.|pixeldrain\.|gofile\.|gdflix\.|hubdrive\.|driveseed\.|driveleech\.|drivebot\.)/i;
const NOISE_LINK_PATTERN = /(xmlrpc\.php|wp-json|wp-content|wp-includes|wp-admin|\/feed\/?|comments\/feed|\/comments\/?|\/tag\/|\/category\/|\/page\/\d|\/author\/|\.(css|js|png|jpe?g|svg|ico|webp|gif)(\?|$)|\/wp-login)/i;
const MEDIA_URL_PATTERN = /https?:\/\/[^\s"'<>\\]+?\.(?:mkv|mp4|m3u8|webm)(?:\?[^\s"'<>\\]*)?/gi;
const DIRECT_HOST_PATTERN = /(r2\.dev\/|cloudflarestorage\.com\/|pixeldrain\.|hubcloud\.|gpdl\d*\.)/i;
const SERIES_HINT = /web-?series|season\s*\d|series/i;
const PLACEHOLDER_PATTERN = /(unpkg\.com|site\.webm|placeholder|sample\.(?:mp4|webm|mkv))/i;

export function isPlaceholderMedia(url) {
  return PLACEHOLDER_PATTERN.test(url);
}

export function candidateRank(url) {
  if (/\.(mkv|mp4)(\?|$)/i.test(url)) return 0;
  if (/\.m3u8(\?|$)/i.test(url)) return 1;
  if (/\.webm(\?|$)/i.test(url)) return 2;
  return 3;
}

export function episodeFromUrl(url) {
  const match = String(url ?? "").match(/s(\d{1,2})[\s._-]*e(\d{1,3})/i);
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

export function pickCandidateForEpisode(candidates, { season = null, episode = null } = {}) {
  if (season == null || episode == null) return { url: candidates[0] ?? null, matched: false, total: candidates.length };
  const withEpisodes = candidates.map((url) => ({ url, ep: episodeFromUrl(url) }));
  const exact = withEpisodes.find((entry) => entry.ep && entry.ep.season === Number(season) && entry.ep.episode === Number(episode));
  if (exact) return { url: exact.url, matched: true, total: candidates.length, episode: exact.ep };
  return { url: null, matched: false, total: candidates.length, available: withEpisodes.filter((e) => e.ep).map((e) => e.ep) };
}

// Series pages list one host link per episode in document order without a season/episode
// tag in the page markup, so the Nth host link belongs to episode N (1-based).
export function hostLinkIndexForEpisode(season, episode) {
  if (season == null || episode == null) return null;
  return Math.max(0, Number(episode) - 1);
}

export function selectMediaCandidates(urls) {
  return Array.from(new Set(urls))
    .filter((url) => !isPlaceholderMedia(url))
    .sort((a, b) => candidateRank(a) - candidateRank(b));
}

export function cleanVegaTitle(raw) {
  if (!raw) return { title: "", year: null };
  let value = String(raw).replace(/^download\s+/i, "").trim();
  const yearMatch = value.match(/\((\d{4})\)/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (yearMatch) {
    value = value.slice(0, yearMatch.index).trim();
  } else {
    value = value.replace(/\b(?:web-?dl|bluray|blu-ray|hdrip|dvdrip|webrip|dual audio|hindi|english|org|x264|x265|hevc|10bit|480p|720p|1080p|2160p|4k|esubs?|subtitles?)\b.*/i, "").trim();
  }
  value = value.replace(/[\[{].*$/s, "").replace(/[\s|,-]+$/, "").trim();
  return { title: value || String(raw).trim(), year };
}

export function decodeDoubleAtob(value) {
  try {
    const once = Buffer.from(value, "base64").toString("utf8");
    return Buffer.from(once, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function extractDoubleAtobValue(html) {
  const match = html.match(/atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/i);
  return match ? decodeDoubleAtob(match[1]) : null;
}

export function extractImdbId(html) {
  const match = html.match(/imdb\.com\/title\/(tt\d+)/i);
  return match ? match[1] : null;
}

export function extractHostLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const href = match[1];
    if (!HOST_PATTERN.test(href)) continue;
    if (NOISE_LINK_PATTERN.test(href)) continue;
    links.add(href);
  }
  return Array.from(links);
}

export function extractLinkPages(html, baseUrl) {
  const ordered = new Map();
  let heading = null;
  const combined = /(<h[3-5][^>]*>[\s\S]*?<\/h[3-5]>)|(<a\s+([^>]*)>([\s\S]*?)<\/a>)/gi;
  for (const match of html.matchAll(combined)) {
    if (match[1]) {
      heading = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
      continue;
    }
    const attrs = match[3] ?? "";
    const inner = match[4] ?? "";
    const href = (attrs.match(/href="([^"]+)"/i) || [])[1];
    if (!href) continue;
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const absolute = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    if (NOISE_LINK_PATTERN.test(absolute)) continue;
    const isDownloadButton = /dwd-button/i.test(inner);
    const isHostLink = HOST_PATTERN.test(absolute);
    if (!isDownloadButton && !isHostLink) continue;
    if (!ordered.has(absolute)) {
      ordered.set(absolute, {
        url: absolute,
        label: label.slice(0, 60),
        kind: isDownloadButton ? "download" : "host",
        heading
      });
    }
  }
  return Array.from(ordered.values());
}

// Quality declared by the page section heading, e.g. "… 1080p WEB-DL x264 [850MB/E]".
export function declaredQuality(heading) {
  const match = String(heading ?? "").match(/(\d{3,4})\s*p/i);
  return match ? Number(match[1]) : null;
}

export function sortVariantsByQuality(variants) {
  const byHeight = new Map();
  for (const variant of variants) {
    if (!variant?.url) continue;
    const height = Number(variant.height) || 0;
    const current = byHeight.get(height);
    if (!current) {
      byHeight.set(height, variant);
      continue;
    }
    // Same resolution: keep the one from the more reliable direct host (signed CDN over mirror).
    const reliable = (u) => (/r2\.dev|cloudflarestorage\.com/i.test(u) ? 2 : /pixeldrain/i.test(u) ? 0 : 1);
    if (reliable(variant.url) > reliable(current.url)) byHeight.set(height, variant);
  }
  return Array.from(byHeight.values()).sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0));
}

export function extractDownloadPageLinks(html, baseUrl) {
  const links = new Set();
  for (const match of html.matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/dwd-button/i.test(match[2])) continue;
    const href = (match[1].match(/href="([^"]+)"/i) || [])[1];
    if (!href) continue;
    links.add(href.startsWith("http") ? href : new URL(href, baseUrl).href);
  }
  return Array.from(links);
}

export function extractDirectMediaUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(MEDIA_URL_PATTERN)) {
    urls.add(match[0]);
  }
  return Array.from(urls);
}

export function pixelDrainApiUrl(url) {
  const match = String(url ?? "").match(/pixeldrain\.(?:dev|com)\/(?:u|file|api\/file)\/([\w-]+)/i);
  if (!match) return null;
  return `https://pixeldrain.com/api/file/${match[1]}?download`;
}

// Token pages often expose media as plain anchors without a file extension
// (e.g. signed R2 bucket links) or as pixeldrain/hubcloud links, so collect every
// non-static anchor in addition to the extension-matched URLs.
export function mediaCandidatesFromHtml(html) {
  const out = new Set();
  for (const url of extractDirectMediaUrls(html)) out.add(url);

  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    if (NOISE_LINK_PATTERN.test(href)) continue;
    const pixeldrain = pixelDrainApiUrl(href);
    if (pixeldrain) {
      out.add(pixeldrain);
      continue;
    }
    if (DIRECT_HOST_PATTERN.test(href) && !/\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(href)) {
      out.add(href);
    }
  }

  const pxl = extractPixelDrainUrl(html);
  const pxlApi = pixelDrainApiUrl(pxl ?? "");
  if (pxlApi) out.add(pxlApi);

  return Array.from(out);
}

export function redactUrl(url) {
  return String(url ?? "").replace(
    /([?&](?:token|access_token|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|signature|sig|expires|expire|key|hash)=)[^&]*/gi,
    "$1<redacted>"
  );
}

export function isRetryableMediaError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/invalid data found|no such file|404|not found|410|gone|unsupported|codec/i.test(message)) return false;
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network|5\d\d|gateway|temporar|503|502|500/i.test(message);
}

export async function withRetry(fn, { retries = 2, delayMs = 400, isRetryable = isRetryableMediaError, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      attempt += 1;
      onRetry?.(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

export function extractPixelDrainUrl(html) {
  const match = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : null;
}

export function extractServerButtons(html) {
  const buttons = [];
  for (const match of html.matchAll(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    buttons.push({ href: match[1], label: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return buttons;
}

export function parseVegaSearch(json) {
  const hits = json?.hits ?? [];
  return hits
    .map((hit) => {
      const doc = hit?.document ?? {};
      const permalink = doc.permalink ?? null;
      if (!permalink) return null;
      const { title, year } = cleanVegaTitle(doc.post_title);
      const type = SERIES_HINT.test(`${doc.post_title ?? ""} ${permalink}`) ? "series" : "movie";
      return {
        id: permalink,
        title,
        type,
        poster: doc.post_thumbnail ?? null,
        backdrop: null,
        overview: null,
        year,
        releaseInfo: null,
        genres: null,
        rating: null,
        popularity: null,
        source: "VegaMovies",
        provider: "VegaMovies",
        sourceUrl: permalink
      };
    })
    .filter(Boolean);
}

export function normalizeForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreTitleMatch(query, candidateTitle, candidateYear, wantedYear) {
  const q = normalizeForMatch(query);
  const t = normalizeForMatch(candidateTitle);
  if (!q || !t) return 0;

  let score;
  if (t === q) score = 1000;
  else if (t.startsWith(`${q} `)) score = 700 - Math.min(100, t.length - q.length);
  else if (t.startsWith(q)) score = 650;
  else if (new RegExp(`(?:^| )${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(t)) score = 500;
  else if (q.split(" ").every((token) => t.split(" ").includes(token))) score = 400;
  else if (t.includes(q)) score = 300;
  else {
    const qTokens = q.split(" ").filter(Boolean);
    const tTokens = new Set(t.split(" ").filter(Boolean));
    const overlap = qTokens.filter((token) => tTokens.has(token)).length;
    score = qTokens.length > 0 ? Math.round((overlap / qTokens.length) * 200) : 0;
  }

  if (wantedYear && candidateYear) {
    const diff = Math.abs(Number(candidateYear) - Number(wantedYear));
    if (diff === 0) score += 120;
    else if (diff === 1) score += 60;
    else if (diff > 3) score -= 80;
  }
  return score;
}

export function pickBestMatch(items, { title, year, minScore = 400 } = {}) {
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const score = scoreTitleMatch(title, item.title, item.year, year);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= minScore ? { item: best, score: bestScore } : null;
}

export function rankTitleCandidates(items, { title, year = null, type = null, minScore = 400, limit = 5 } = {}) {
  const scored = [];
  for (const item of items) {
    let score = scoreTitleMatch(title, item.title, item.year, year);
    if (score <= 0) continue;
    if (type && item.type) {
      score += item.type === type ? 90 : -120;
    }
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (Number(b.item.year) || 0) - (Number(a.item.year) || 0);
  });

  const seen = new Set();
  const unique = [];
  for (const entry of scored) {
    const key = entry.item.id ?? `${entry.item.title}:${entry.item.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function absoluteUrl(base, value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, base).href;
}

export class VegaMoviesProvider extends BaseProvider {
  constructor(options = {}) {
    super({ name: "VegaMovies", timeoutMs: 15000, ...options });
    this.cache = options.cache ?? null;
    this.ffprobePath = options.ffprobePath ?? "ffprobe";
  }

  getName() {
    return "VegaMovies";
  }

  getCapabilities() {
    return {
      supportsHomePage: false,
      supportsSearch: true,
      supportsDetail: true,
      supportsStreamResolution: true,
      rankingMethod: "VegaMovies search.php JSON index (provider-side relevance ordering)",
      homeCatalogTypes: []
    };
  }

  async validateSearchHost(origin) {
    try {
      const cleanOrigin = origin.replace(/\/+$/, "");
      const testUrl = `${cleanOrigin}/search.php?q=test&page=1`;
      const res = await fetch(testUrl, {
        headers: {
          "User-Agent": this.getUserAgent(),
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) return false;
      const data = await res.json();
      return Array.isArray(data?.hits);
    } catch {
      return false;
    }
  }

  async resolveGatewayTarget(candidate) {
    try {
      const cleanCandidate = candidate.replace(/\/+$/, "");
      const gatewayUrl = `${cleanCandidate}/?re=vg&t=2`;
      const res = await fetch(gatewayUrl, {
        headers: { "User-Agent": this.getUserAgent() },
        redirect: "follow",
        signal: AbortSignal.timeout(6000)
      });
      if (res.url) {
        return new URL(res.url).origin;
      }
    } catch {
      // gateway traversal failed
    }
    return null;
  }

  async getBaseUrl({ forceFresh = false } = {}) {
    const cacheKey = "vega:base";
    if (!forceFresh) {
      const cached = this.cache?.get(cacheKey);
      if (cached) return cached;
    }

    const candidateOrigins = [];
    try {
      const data = await this.fetchJson(URLS_JSON, { timeoutMs: 6000 });
      if (data && typeof data.vegamovies === "string" && data.vegamovies.startsWith("http")) {
        candidateOrigins.push(data.vegamovies);
      }
    } catch {
      // dynamic urls.json fetch failed; rely on verified fallbacks
    }
    candidateOrigins.push(FALLBACK_BASE);
    candidateOrigins.push("https://1vegamovies.pics");

    let chosenBase = null;

    for (const candidate of candidateOrigins) {
      if (!candidate) continue;
      // 1. Direct validation: does candidate host have a working search endpoint?
      if (await this.validateSearchHost(candidate)) {
        chosenBase = candidate.replace(/\/+$/, "");
        break;
      }

      // 2. Gateway redirection check: follow ?re=vg&t=2
      const gatewayTarget = await this.resolveGatewayTarget(candidate);
      if (gatewayTarget && (await this.validateSearchHost(gatewayTarget))) {
        chosenBase = gatewayTarget.replace(/\/+$/, "");
        break;
      }
    }

    if (!chosenBase) {
      chosenBase = FALLBACK_BASE;
    }

    this.cache?.set(cacheKey, chosenBase, 1800000); // 30 minutes cache for verified base
    return chosenBase;
  }

  async search(query) {
    const base = await this.getBaseUrl();
    const url = `${base}/search.php?q=${encodeURIComponent(query)}&page=1`;
    try {
      const json = await this.fetchJson(url, { timeoutMs: 12000 });
      return parseVegaSearch(json);
    } catch (err) {
      if (err instanceof ProviderError && (err.code === "http" || err.code === "parse")) {
        // Current or cached base failed; invalidate cache and re-resolve dynamically
        this.cache?.delete("vega:base");
        const freshBase = await this.getBaseUrl({ forceFresh: true });
        if (freshBase && freshBase !== base) {
          const retryUrl = `${freshBase}/search.php?q=${encodeURIComponent(query)}&page=1`;
          const retryJson = await this.fetchJson(retryUrl, { timeoutMs: 12000 });
          return parseVegaSearch(retryJson);
        }
      }
      throw err;
    }
  }

  async getDetails(type, id) {
    if (/^tt\d+$/i.test(id) || /kitsu/i.test(id) || /^mal[:\-]/i.test(id)) {
      throw new ProviderError("id does not belong to VegaMovies", "unsupported");
    }
    const base = await this.getBaseUrl();
    const pageUrl = absoluteUrl(base, id);
    if (!pageUrl) throw new ProviderError("invalid VegaMovies id", "validation");
    const html = await this.fetchText(pageUrl, {
      headers: { Referer: `${base}/` }
    });

    const titleTag = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] ?? "";
    let title = titleTag.replace(/^download\s+/i, "").replace(/\s*\|\s*vegamovies[^|]*$/i, "").trim();
    let poster = (html.match(/<p[^>]*>\s*<img[^>]+src="([^"]+)"/i) || [])[1]
      ?? (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || [])[1]
      ?? null;
    const overview = (html.match(/<h3[^>]*>[\s\S]*?synopsis[\s\S]*?<\/h3>\s*(?:<p>)?([\s\S]*?)<\/(?:p|div)>/i) || [])[1]?.replace(/<[^>]+>/g, " ").trim() ?? null;
    const imdbId = extractImdbId(html);
    const isSeries =
      /series-?synopsis|series info/i.test(html) || SERIES_HINT.test(`${titleTag} ${pageUrl}`);

    const { title: cleanedTitle, year } = cleanVegaTitle(title);
    let item = {
      id,
      title: cleanedTitle || title,
      type: isSeries ? "series" : "movie",
      poster,
      backdrop: null,
      overview,
      year,
      releaseInfo: null,
      genres: null,
      rating: null,
      popularity: null,
      source: "VegaMovies",
      provider: "VegaMovies",
      sourceUrl: pageUrl,
      episodes: isSeries ? [] : null
    };

    if (imdbId) {
      try {
        const meta = await this.fetchJson(`${CINEMETA}/meta/${isSeries ? "series" : "movie"}/${imdbId}.json`);
        const m = meta?.meta;
        if (m) {
          item = {
            ...item,
            title: m.name ?? item.title,
            poster: m.poster ?? item.poster,
            backdrop: m.background ?? item.backdrop,
            overview: m.description ?? item.overview,
            year: Number(String(m.year ?? "").match(/\d{4}/)?.[0]) || item.year,
            genres: m.genre ?? m.genres ?? item.genres,
            rating: Number.parseFloat(m.imdbRating) || item.rating,
            episodes: isSeries
              ? (m.videos ?? [])
                  .filter((ep) => ep.season != null && ep.season !== 0)
                  .map((ep) => ({
                    id: ep.id ?? null,
                    season: ep.season ?? null,
                    episode: ep.episode ?? ep.number ?? null,
                    name: ep.name ?? ep.title ?? null,
                    overview: ep.overview ?? ep.description ?? null,
                    thumbnail: ep.thumbnail ?? null,
                    firstAired: ep.firstAired ?? ep.released ?? null,
                    rating: Number.parseFloat(ep.rating) || null
                  }))
                  .sort((a, b) => a.season - b.season || a.episode - b.episode)
              : null
          };
        }
      } catch {
        // cinemeta enrichment is best-effort; keep provider-page metadata
      }
    }

    return item;
  }

  async resolveByTitle({ title, year = null, type = "movie", season = null, episode = null } = {}) {
    if (!title) {
      throw new ProviderError("title is required for title-based resolution", "validation");
    }
    const items = await this.search(title);
    logger.info("vega.title_search", { query: title, year, type, results: items.length });

    const ranked = rankTitleCandidates(items, { title, year, type });
    if (ranked.length === 0) {
      logger.warn("vega.title_no_match", {
        query: title,
        year,
        type,
        sample: items.slice(0, 5).map((item) => `${item.title} (${item.year ?? "?"})`)
      });
      throw new ProviderError(
        `VegaMovies has no close match for "${title}"${year ? ` (${year})` : ""} among ${items.length} result(s)`,
        "not_found"
      );
    }

    logger.info("vega.title_candidates", {
      query: title,
      candidates: ranked.map(({ item, score }) => `${item.title} (${item.year ?? "?"}) [${item.type}] score=${score}`)
    });

    const attempts = [];
    for (const [index, { item, score }] of ranked.entries()) {
      try {
        const detail = await this.getDetails(item.type, item.id);
        const source = await this.resolveStream(detail, { season, episode });
        logger.info("vega.resolved", {
          query: title,
          matched: item.title,
          matchedYear: item.year ?? null,
          score,
          attempt: index + 1,
          candidatesTried: attempts.length + 1,
          mediaType: source.mediaType ?? null,
          host: hostOf(source.url)
        });
        return {
          ...source,
          note: `Resolved via VegaMovies title match: "${item.title}"${item.year ? ` (${item.year})` : ""}, score ${score} (candidate ${index + 1} of ${ranked.length})${
            source.quality ? `, quality ${source.quality}` : ""
          }${source.variants?.length > 1 ? ` (${source.variants.length} qualities available)` : ""}`,
          matchedTitle: item.title,
          matchedYear: item.year ?? null,
          matchScore: score,
          pageUrl: detail.sourceUrl,
          attempts: attempts.concat([{ title: item.title, id: item.id, score, ok: true }])
        };
      } catch (err) {
        attempts.push({ title: item.title, id: item.id, score, ok: false, error: err.message });
        logger.warn("vega.candidate_failed", {
          query: title,
          candidate: item.title,
          candidateYear: item.year ?? null,
          score,
          attempt: index + 1,
          code: err.code ?? "error",
          reason: String(err.message ?? "").slice(0, 200)
        });
      }
    }

    throw new ProviderError(
      `VegaMovies matched ${ranked.length} candidate(s) for "${title}"${year ? ` (${year})` : ""} but none yielded a validated playable source: ${attempts
        .map((a) => `${a.title}${a.error ? ` (${String(a.error).slice(0, 60)})` : ""}`)
        .join("; ")}`,
      "unsupported"
    );
  }

  async resolveStream(detail, { season = null, episode = null } = {}) {
    const base = await this.getBaseUrl();
    const pageUrl = detail?.sourceUrl && /^https?:\/\//i.test(detail.sourceUrl)
      ? detail.sourceUrl
      : absoluteUrl(base, detail?.id);
    if (!pageUrl) throw new ProviderError("VegaMovies detail page unavailable for resolution", "unsupported");

    const html = await this.fetchText(pageUrl, { headers: { Referer: `${base}/` } });
    const candidates = new Set();
    let chosenLabel = null;

    for (const mediaUrl of extractDirectMediaUrls(html)) candidates.add(mediaUrl);

    // Movies expose `dwd-button` anchors; series pages link straight to host pages
    // (e.g. nexdrive) from quality sections. Handle both.
    // Series/movie pages list one link page per quality tier (480p/720p/1080p × mirrors), so
    // inspect them all — capping this previously dropped the higher-quality tiers entirely.
    const linkPages = extractLinkPages(html, pageUrl).slice(0, 12);
    logger.info("vega.link_pages", {
      page: hostOf(pageUrl),
      count: linkPages.length,
      kinds: [...new Set(linkPages.map((p) => p.kind))],
      labels: linkPages.map((p) => p.label).slice(0, 6)
    });

    const episodeRequested = season != null && episode != null;
    const wantedIndex = episodeRequested ? hostLinkIndexForEpisode(season, episode) : null;
    // Inspect every link page: each is a per-quality tier that repeats the same episode range,
    // and the resolvable episode links (vcloud) can live on a different page than the
    // unresolvable mirrors (fastdl/filebee), so gather them all before choosing.
    const pageInfos = [];
    for (const linkPage of linkPages) {
      let probeHtml;
      try {
        probeHtml = await this.fetchText(linkPage.url, { headers: { Referer: pageUrl }, timeoutMs: 12000 });
      } catch {
        logger.warn("vega.link_page_failed", { host: hostOf(linkPage.url), label: linkPage.label });
        continue;
      }
      const hostLinks = extractHostLinks(probeHtml);
      pageInfos.push({
        url: linkPage.url,
        label: linkPage.label,
        heading: linkPage.heading ?? null,
        declared: declaredQuality(linkPage.heading),
        hostLinks,
        vcloud: hostLinks.filter((href) => /vcloud\./i.test(href)),
        usable: hostLinks.filter((href) => !/fastdl\.|filebee\./i.test(href))
      });
    }
    // Prefer higher declared-quality tiers first when several cover the same episode.
    pageInfos.sort((a, b) => (b.declared ?? 0) - (a.declared ?? 0));
    logger.info("vega.link_page_tiers", {
      page: hostOf(pageUrl),
      tiers: pageInfos.map((p) => `${p.declared ?? "?"}p "${p.label}" hosts=${p.hostLinks.length} vcloud=${p.vcloud.length}`)
    });

    let orderedHostLinks = [];
    let orderedHostReferer = pageUrl;
    if (!episodeRequested) {
      const first = pageInfos[0];
      if (first) {
        orderedHostLinks = first.vcloud.length > 0 ? first.vcloud : first.hostLinks;
        orderedHostReferer = first.url;
        chosenLabel = first.label;
      }
    } else {
      // Prefer a page whose resolvable (vcloud) list covers the requested episode.
      const vcloudCovering = pageInfos.find((p) => p.vcloud.length > wantedIndex);
      const usableCovering = pageInfos.find((p) => p.usable.length > wantedIndex);
      const largest = [...pageInfos].sort((a, b) => b.hostLinks.length - a.hostLinks.length)[0] ?? null;
      const chosen = vcloudCovering ?? usableCovering ?? largest;
      if (chosen) {
        orderedHostLinks = chosen.vcloud.length > 0 ? chosen.vcloud : chosen.hostLinks;
        orderedHostReferer = chosen.url;
        chosenLabel = chosen.label;
        // Cross-tier fallbacks: the same episode index on the other vcloud pages.
        for (const info of pageInfos) {
          if (info === chosen || info.vcloud.length <= wantedIndex) continue;
          const alternate = info.vcloud[wantedIndex];
          if (alternate && !orderedHostLinks.includes(alternate)) orderedHostLinks.push(alternate);
        }
        logger.info("vega.episode_tier_selected", {
          requested: `S${season}E${episode}`,
          tier: chosen.label,
          covered: chosen.vcloud.length > wantedIndex,
          links: orderedHostLinks.length
        });
      }
    }

    if (episodeRequested && orderedHostLinks.length > 0) {
      const order = [];
      if (wantedIndex != null && wantedIndex < orderedHostLinks.length) order.push(wantedIndex);
      for (let i = 0; i < orderedHostLinks.length; i += 1) {
        if (!order.includes(i)) order.push(i);
      }
      logger.info("vega.episode_link_candidates", {
        requested: `S${season}E${episode}`,
        hostLinks: orderedHostLinks.length,
        wantedIndex,
        target: redactUrl(orderedHostLinks[wantedIndex] ?? null)
      });

      // Resolve the same episode from each quality tier and keep the real resolutions, so the
      // best rendition can be preferred (and lower ones offered as genuine variants).
      const collected = [];
      for (const info of pageInfos) {
        const list = info.vcloud.length > 0 ? info.vcloud : info.usable;
        if (list.length === 0) continue;
        const index = wantedIndex != null && wantedIndex < list.length ? wantedIndex : 0;
        const variants = await this.mediaVariantsFromHost(list[index], info.url, { maxProbes: 2 });
        for (const variant of variants) {
          if (!collected.some((v) => v.url === variant.url)) {
            collected.push({ ...variant, declared: info.declared, label: info.label });
          }
        }
      }

      const episodeTagOk = (variant) => {
        const tag = episodeFromUrl(variant.url);
        return !tag || (tag.season === Number(season) && tag.episode === Number(episode));
      };
      const valid = sortVariantsByQuality(collected.filter(episodeTagOk));
      if (valid.length > 0) {
        const chosen = valid[0];
        logger.info("vega.media_validated", {
          requested: `S${season}E${episode}`,
          best: `${chosen.height}p`,
          variants: valid.map((v) => `${v.height}p`),
          url: redactUrl(chosen.url)
        });
        return {
          url: chosen.url,
          variants: valid.slice(0, 3),
          headers: { Referer: `${base}/` },
          mediaType: chosen.url.includes(".m3u8") ? "hls" : "mkv",
          sourceType: "provider",
          episode: episodeFromUrl(chosen.url) ?? { season: Number(season), episode: Number(episode) },
          quality: `${chosen.height}p`,
          note: `Resolved from VegaMovies (real provider source; ${chosenLabel ? `section "${chosenLabel}", ` : ""}episode S${season}E${episode}, best quality ${chosen.height}p of ${valid.length} available)`
        };
      }

      throw new ProviderError(
        `VegaMovies exposes ${orderedHostLinks.length} episode link(s) for this tier but none resolved to a valid media file for S${season}E${episode}`,
        "unsupported"
      );
    }

    for (const linkPage of linkPages) {
      if (selectMediaCandidates(candidates).length >= 3) break;
      let linkHtml;
      try {
        linkHtml = await this.fetchText(linkPage.url, {
          headers: { Referer: pageUrl },
          timeoutMs: 12000
        });
      } catch {
        logger.warn("vega.link_page_failed", { host: hostOf(linkPage.url) });
        continue;
      }
      for (const mediaUrl of extractDirectMediaUrls(linkHtml)) candidates.add(mediaUrl);

      for (const hostLink of extractHostLinks(linkHtml).slice(0, 6)) {
        if (selectMediaCandidates(candidates).length >= 3) break;
        try {
          const hostHtml = await this.fetchText(hostLink, {
            headers: { Referer: linkPage.url },
            timeoutMs: 12000
          });
          for (const mediaUrl of extractDirectMediaUrls(hostHtml)) candidates.add(mediaUrl);

          const vcloudToken = extractDoubleAtobValue(hostHtml);
          if (vcloudToken && /^https?:\/\//i.test(vcloudToken)) {
            const tokenHtml = await this.fetchText(vcloudToken, {
              headers: { Referer: hostLink },
              timeoutMs: 12000
            });
            for (const mediaUrl of extractDirectMediaUrls(tokenHtml)) candidates.add(mediaUrl);
            const pxl = extractPixelDrainUrl(tokenHtml);
            if (pxl) {
              const pxId = pxl.split("/").filter(Boolean).pop();
              if (pxId) candidates.add(`https://pixeldrain.com/api/file/${pxId}?download`);
            }
          }
        } catch {
          // individual host failures must not abort resolution
        }
      }
      if (selectMediaCandidates(candidates).length > 0 && !chosenLabel) {
        chosenLabel = linkPage.label;
      }
    }

    // Movie path: gather genuine quality variants across the per-quality link pages as well,
    // so a 480p mirror is never the only rendition offered when 720p/1080p exist.
    const movieVariants = [];
    for (const info of pageInfos) {
      const list = info.vcloud.length > 0 ? info.vcloud : info.usable.length > 0 ? info.usable : info.hostLinks;
      if (list.length === 0) continue;
      const found = await this.mediaVariantsFromHost(list[0], info.url, { maxProbes: 2 });
      for (const variant of found) {
        if (!movieVariants.some((v) => v.url === variant.url)) {
          movieVariants.push({ ...variant, declared: info.declared, label: info.label });
        }
      }
    }

    const ranked = selectMediaCandidates(candidates);
    const selection = pickCandidateForEpisode(ranked, { season, episode });
    logger.info("vega.extraction_candidates", {
      page: hostOf(pageUrl),
      total: ranked.length,
      hosts: [...new Set(ranked.map((url) => hostOf(url)).filter(Boolean))],
      requestedEpisode: season != null && episode != null ? `S${season}E${episode}` : null,
      matchedEpisode: selection.matched
    });

    if (season != null && episode != null && !selection.matched) {
      logger.warn("vega.episode_not_found", {
        requested: `S${season}E${episode}`,
        available: (selection.available ?? []).slice(0, 8).map((ep) => `S${ep.season}E${ep.episode}`)
      });
      throw new ProviderError(
        `VegaMovies links for this title do not include episode S${season}E${episode}${
          selection.available?.length ? ` (available: ${selection.available.slice(0, 6).map((ep) => `S${ep.season}E${ep.episode}`).join(", ")})` : ""
        }`,
        "not_found"
      );
    }

    // Prefer the highest real resolution discovered across the quality tiers.
    const bestVariants = sortVariantsByQuality(movieVariants);
    const ordered = bestVariants.length > 0
      ? [
          ...bestVariants.map((v) => v.url),
          ...(selection.url ? [selection.url] : []),
          ...ranked.filter((url) => !bestVariants.some((v) => v.url === url))
        ]
      : selection.url
        ? [selection.url, ...ranked.filter((url) => url !== selection.url)]
        : ranked;

    for (const candidate of ordered) {
      const playable = await withRetry(
        async () => {
          const ok = await this.isPlayableMedia(candidate, pageUrl);
          if (!ok) throw new Error("ffprobe rejected the candidate media URL (404/invalid data/unsupported)");
          return true;
        },
        {
          retries: 1,
          delayMs: 400,
          onRetry: (error, attempt) =>
            logger.warn("vega.media_retry", { host: hostOf(candidate), attempt, reason: String(error.message).slice(0, 80) })
        }
      ).catch(() => false);
      logger.info("vega.ffprobe_check", { host: hostOf(candidate), playable, url: redactUrl(candidate) });
      if (playable) {
        logger.info("vega.media_validated", { host: hostOf(candidate), mediaType: candidate.includes(".m3u8") ? "hls" : "mkv" });
        const height = bestVariants.find((v) => v.url === candidate)?.height ?? null;
        return {
          url: candidate,
          variants: bestVariants.length > 1 ? bestVariants.slice(0, 3) : undefined,
          headers: { Referer: `${base}/` },
          mediaType: candidate.includes(".m3u8") ? "hls" : "mkv",
          sourceType: "provider",
          episode: episodeFromUrl(candidate),
          quality: height ? `${height}p` : null,
          note: `Resolved from VegaMovies (real provider source${chosenLabel ? `; section "${chosenLabel}"` : ""}${height ? `, best quality ${height}p` : ""}${
            bestVariants.length > 1 ? ` of ${bestVariants.length} available` : ""
          })`
        };
      }
    }

    logger.warn("vega.extraction_failed", {
      page: hostOf(pageUrl),
      candidates: ranked.length,
      sampleHosts: [...new Set(ranked.map((url) => hostOf(url)).filter(Boolean))].slice(0, 5)
    });
    throw new ProviderError(
      `VegaMovies detail page was fetched but none of ${ranked.length} candidate media URL(s) passed ffprobe validation`,
      "unsupported"
    );
  }

  // Resolves a single host link (vcloud/fastdl/...) down to a direct media URL.
  async mediaFromHost(hostLink, referer, base) {
    const collections = await this.mediaCandidatesForHost(hostLink, referer);
    for (const candidate of collections) {
      const playable = await withRetry(
        async () => {
          const ok = await this.isPlayableMedia(candidate, referer);
          if (!ok) throw new Error("ffprobe rejected the candidate media URL (404/invalid data/unsupported)");
          return true;
        },
        {
          retries: 1,
          delayMs: 400,
          onRetry: (error, attempt) =>
            logger.warn("vega.media_retry", {
              host: hostOf(candidate),
              attempt,
              reason: String(error.message).slice(0, 80)
            })
        }
      ).catch(() => false);
      if (playable) return candidate;
    }
    return null;
  }

  // Like mediaFromHost, but returns every playable candidate with its real (ffprobe) height,
  // so the caller can offer genuine quality variants without trusting page labels.
  async mediaVariantsFromHost(hostLink, referer, { maxProbes = 3 } = {}) {
    const collections = await this.mediaCandidatesForHost(hostLink, referer);
    const variants = [];
    for (const candidate of collections.slice(0, maxProbes)) {
      // Retry only transient probing failures; the same candidate is retried, never another episode.
      const height = await withRetry(
        async () => {
          const value = await this.probeHeight(candidate, referer);
          if (!value) throw new Error("ffprobe rejected the candidate media URL (404/invalid data/unsupported)");
          return value;
        },
        {
          retries: 1,
          delayMs: 300,
          onRetry: (error, attempt) =>
            logger.warn("vega.media_retry", { host: hostOf(candidate), attempt, reason: String(error.message).slice(0, 80) })
        }
      ).catch(() => null);
      if (height) variants.push({ url: candidate, height });
    }
    return variants;
  }

  async probeHeight(url, referer) {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      if (isPlaceholderMedia(url)) {
        resolve(null);
        return;
      }
      let settled = false;
      let out = "";
      const proc = spawn(
        this.ffprobePath,
        ["-v", "error", "-headers", `Referer: ${referer}\r\n`, "-show_entries", "stream=codec_type,height", "-of", "json", url],
        { windowsHide: true }
      );
      proc.stdout?.on("data", (data) => {
        out += data.toString();
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            proc.kill("SIGTERM");
          } catch {
            // already gone
          }
          resolve(null);
        }
      }, 20000);
      proc.on("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(out);
          const video = (parsed.streams ?? []).find((s) => s.codec_type === "video");
          resolve(Number(video?.height) || null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  // Returns the ordered media candidates reachable from one host link page.
  async mediaCandidatesForHost(hostLink, referer) {
    let hostHtml;
    try {
      hostHtml = await this.fetchText(hostLink, { headers: { Referer: referer }, timeoutMs: 12000 });
    } catch {
      logger.warn("vega.host_page_failed", { host: hostOf(hostLink) });
      return [];
    }

    const direct = new Set(mediaCandidatesFromHtml(hostHtml));

    const vcloudToken = extractDoubleAtobValue(hostHtml);
    if (vcloudToken && /^https?:\/\//i.test(vcloudToken)) {
      try {
        const tokenHtml = await this.fetchText(vcloudToken, { headers: { Referer: hostLink }, timeoutMs: 12000 });
        for (const url of mediaCandidatesFromHtml(tokenHtml)) direct.add(url);
      } catch {
        logger.warn("vega.token_page_failed", { host: hostOf(hostLink) });
      }
    }

    const ranked = selectMediaCandidates([...direct]);
    if (ranked.length > 0) {
      logger.info("vega.host_media_candidates", {
        host: hostOf(hostLink),
        count: ranked.length,
        hosts: [...new Set(ranked.map((url) => hostOf(url)).filter(Boolean))]
      });
    }
    return ranked;
  }

  async isPlayableMedia(url, referer) {
    if (isPlaceholderMedia(url)) return false;
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      let settled = false;
      let output = "";
      const proc = spawn(
        this.ffprobePath,
        [
          "-v", "error",
          "-headers", `Referer: ${referer}\r\n`,
          "-show_entries", "stream=codec_type",
          "-of", "json",
          url
        ],
        { windowsHide: true }
      );
      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            proc.kill("SIGTERM");
          } catch {
            // already gone
          }
          resolve(false);
        }
      }, 20000);
      proc.on("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(code === 0 && /"codec_type"\s*:\s*"video"/.test(output));
        }
      });
    });
  }
}
