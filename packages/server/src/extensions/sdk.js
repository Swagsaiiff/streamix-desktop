import {
  ExtensionError,
  ItemNotFoundError,
  SourceUnavailableError,
  ExtensionTimeoutError
} from "./errors.js";

export const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io";

export const DEFAULT_FALLBACK_URLS = {
  bollyflix: "https://bollyflix.co.za",
  moviesdrive: "https://new3.moviesdrive.beer",
  moviesmod: "https://moviesmod.uk.com",
  vegamovies: "https://1vegamovies.pics",
  gdflix: "https://new6.gdflix.io",
  hubcloud: "https://hubcloud.ist",
  vcloud: "https://vcloud.fit",
  cinemeta: "https://v3-cinemeta.strem.io"
};

let cachedUrls = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getLatestDynamicUrls(customFetch = fetch) {
  const now = Date.now();
  if (cachedUrls && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedUrls;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await customFetch(
      "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json",
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      cachedUrls = { ...DEFAULT_FALLBACK_URLS, ...data };
      lastFetchTime = now;
      return cachedUrls;
    }
  } catch {
    // fallback
  }
  return cachedUrls || DEFAULT_FALLBACK_URLS;
}

export function extractBaseUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export async function getProviderBaseUrl(key, defaultUrl, customFetch = fetch) {
  const urls = await getLatestDynamicUrls(customFetch);
  const resolved = urls[key.toLowerCase()];
  if (resolved && resolved.startsWith("http")) {
    return resolved.replace(/\/+$/, "");
  }
  return defaultUrl.replace(/\/+$/, "");
}

export function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtmlTags(html) {
  if (!html) return "";
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function extractTagContent(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(html);
  return match ? match[1].trim() : null;
}

export function extractMetaContent(html, propertyOrName) {
  const regex1 = new RegExp(`<meta\\s+[^>]*property=["']${propertyOrName}["'][^>]*content=["']([^"']*)["']`, "i");
  const match1 = regex1.exec(html);
  if (match1) return decodeHtmlEntities(match1[1]);

  const regex2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*property=["']${propertyOrName}["']`, "i");
  const match2 = regex2.exec(html);
  if (match2) return decodeHtmlEntities(match2[1]);

  const regex3 = new RegExp(`<meta\\s+[^>]*name=["']${propertyOrName}["'][^>]*content=["']([^"']*)["']`, "i");
  const match3 = regex3.exec(html);
  if (match3) return decodeHtmlEntities(match3[1]);

  return null;
}

export function extractAttribute(tagHtml, attrName) {
  const regex = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const match = regex.exec(tagHtml);
  return match ? decodeHtmlEntities(match[1]) : null;
}

export function extractImdbId(text) {
  if (!text) return null;
  const match = /tt\d{7,10}/i.exec(text);
  return match ? match[0] : null;
}

export function parseVideoQuality(text) {
  if (!text) return "unknown";
  const clean = text.toLowerCase();
  if (clean.includes("2160p") || clean.includes("4k") || clean.includes("uhd")) return "2160p";
  if (clean.includes("1080p") || clean.includes("fhd")) return "1080p";
  if (clean.includes("720p") || clean.includes("hd")) return "720p";
  if (clean.includes("480p") || clean.includes("sd")) return "480p";
  if (clean.includes("360p")) return "360p";
  return "unknown";
}

export async function fetchCinemetaMeta(type, imdbId, customFetch = fetch) {
  if (!imdbId) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `${CINEMETA_BASE_URL}/meta/${type}/${imdbId}.json`;
    const res = await customFetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.meta;
    if (!meta) return null;

    const episodes = [];
    if (meta.videos && Array.isArray(meta.videos)) {
      for (const v of meta.videos) {
        const epNum = v.number ?? v.episode ?? 1;
        episodes.push({
          id: v.id || `${imdbId}:${v.season}:${epNum}`,
          seasonNumber: v.season,
          episodeNumber: epNum,
          title: v.name || v.title || `Episode ${epNum}`,
          description: v.overview || v.description,
          thumbnail: v.thumbnail,
          releaseDate: v.released
        });
      }
    }

    const yearNum = typeof meta.year === "number" ? meta.year : meta.year ? parseInt(String(meta.year), 10) : undefined;
    return {
      title: meta.name,
      description: meta.description,
      posterUrl: meta.poster,
      bannerUrl: meta.background,
      releaseYear: isNaN(yearNum) ? undefined : yearNum,
      genres: meta.genres || meta.genre || [],
      episodes: episodes.length > 0 ? episodes : undefined
    };
  } catch {
    return null;
  }
}

export async function searchCinemeta(query, type = "movie", customFetch = fetch) {
  if (!query || !query.trim()) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const encoded = encodeURIComponent(query.trim());
    const url = `${CINEMETA_BASE_URL}/catalog/${type}/top/search=${encoded}.json`;
    const res = await customFetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.metas || !Array.isArray(data.metas)) return [];

    return data.metas.map((m) => {
      const year = m.year ? parseInt(String(m.year), 10) : undefined;
      return {
        id: m.id,
        title: m.name,
        type: m.type === "series" ? "series" : "movie",
        posterUrl: m.poster,
        releaseYear: isNaN(year) ? undefined : year,
        languages: ["en"],
        providerContext: {
          imdbId: m.id,
          rating: m.imdbRating
        }
      };
    });
  } catch {
    return [];
  }
}

export function extractDoubleAtob(str) {
  try {
    const match = /var\s+url\s*=\s*atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/i.exec(str);
    if (!match) return null;
    const first = Buffer.from(match[1], "base64").toString("utf-8");
    return Buffer.from(first, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export function extractPxlUrl(html) {
  const match = /var\s+pxl\s*=\s*["']([^"']+)["']/i.exec(html);
  return match ? match[1] : null;
}

export async function extractHubCloudSources(initialUrl, customFetch = fetch) {
  const sources = [];
  try {
    let currentUrl = initialUrl;
    const isVcloud = initialUrl.includes("vcloud");
    const sourceKey = isVcloud ? "vcloud" : "hubcloud";
    const latestBase = await getProviderBaseUrl(sourceKey, extractBaseUrl(initialUrl), customFetch);
    const origBase = extractBaseUrl(initialUrl);
    if (origBase && latestBase && origBase !== latestBase) {
      currentUrl = currentUrl.replace(origBase, latestBase);
    }

    const res1 = await customFetch(currentUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!res1.ok) return sources;
    const html1 = await res1.text();

    let targetLink = "";
    if (currentUrl.includes("/video/")) {
      const match = /<div class="vd"[^>]*>[\s\S]*?<center>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i.exec(html1);
      targetLink = match ? match[1] : "";
    } else {
      if (isVcloud) {
        targetLink = extractDoubleAtob(html1) || "";
      }
      if (!targetLink) {
        const match = /var\s+url\s*=\s*['"]([^'"]*)['"]/i.exec(html1);
        targetLink = match ? match[1] : "";
      }
    }

    if (!targetLink) {
      targetLink = currentUrl;
    } else if (!targetLink.startsWith("http")) {
      targetLink = `${extractBaseUrl(currentUrl)}/${targetLink.replace(/^\/+/, "")}`;
    }

    const pxlMatch1 = extractPxlUrl(html1);
    if (pxlMatch1) {
      const pxlId = pxlMatch1.split("/").pop()?.replace(/\?.*$/, "");
      if (pxlId) {
        sources.push({
          url: `https://pixeldrain.com/api/file/${pxlId}?download`,
          quality: "1080p",
          format: "mp4",
          headers: { "User-Agent": "Mozilla/5.0" }
        });
      }
    }

    const directMatch1 = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv)[^\s"'<>]*/i.exec(html1);
    if (directMatch1) {
      sources.push({
        url: directMatch1[0],
        quality: "1080p",
        format: directMatch1[0].includes(".m3u8") ? "hls" : "mp4",
        headers: { "User-Agent": "Mozilla/5.0", Referer: currentUrl }
      });
    }

    // Step 2: Fetch targetLink if available and sources not yet found
    if (sources.length === 0 && targetLink && targetLink !== currentUrl) {
      try {
        const res2 = await customFetch(targetLink, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: currentUrl
          }
        });
        if (res2.ok) {
          const html2 = await res2.text();
          const pxlMatch2 = extractPxlUrl(html2);
          if (pxlMatch2) {
            const pxlId = pxlMatch2.split("/").pop()?.replace(/\?.*$/, "");
            if (pxlId) {
              sources.push({
                url: `https://pixeldrain.com/api/file/${pxlId}?download`,
                quality: "1080p",
                format: "mp4",
                headers: { "User-Agent": "Mozilla/5.0" }
              });
            }
          }

          const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let aMatch;
          while ((aMatch = anchorRegex.exec(html2)) !== null) {
            const href = aMatch[1];
            if (href.includes("pixeldra")) {
              const pxlId = href.split("/").pop()?.replace(/\?.*$/, "");
              if (pxlId && !sources.some((s) => s.url.includes(pxlId))) {
                sources.push({
                  url: `https://pixeldrain.com/api/file/${pxlId}?download`,
                  quality: "1080p",
                  format: "mp4",
                  headers: { "User-Agent": "Mozilla/5.0" }
                });
              }
            } else if (href.match(/\.(m3u8|mp4|mkv)(\?.*)?$/i)) {
              if (!sources.some((s) => s.url === href)) {
                sources.push({
                  url: href,
                  quality: "1080p",
                  format: href.includes(".m3u8") ? "hls" : "mp4",
                  headers: { "User-Agent": "Mozilla/5.0", Referer: targetLink }
                });
              }
            }
          }

          const directMatch2 = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv)[^\s"'<>]*/i.exec(html2);
          if (directMatch2 && !sources.some((s) => s.url === directMatch2[0])) {
            sources.push({
              url: directMatch2[0],
              quality: "1080p",
              format: directMatch2[0].includes(".m3u8") ? "hls" : "mp4",
              headers: { "User-Agent": "Mozilla/5.0", Referer: targetLink }
            });
          }
        }
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return sources;
}

export async function bypassSidexfee(id, customFetch = fetch) {
  try {
    const url = `https://web.sidexfee.com/?id=${id}`;
    const res = await customFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = /link["']?\s*:\s*["']([^"']+)["']/i.exec(text);
    if (!match) return null;
    const clean = match[1].replace(/\\\//g, "/");
    return Buffer.from(clean, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function extractGdflixSources(initialUrl, customFetch = fetch) {
  const sources = [];
  try {
    let currentUrl = initialUrl;
    const isGdHost = initialUrl.includes("gdflix") || initialUrl.includes("gdlink");
    if (isGdHost) {
      const latestBase = await getProviderBaseUrl("gdflix", extractBaseUrl(initialUrl), customFetch);
      const origBase = extractBaseUrl(initialUrl);
      if (origBase && latestBase && origBase !== latestBase) {
        currentUrl = currentUrl.replace(origBase, latestBase);
      }
    }
    const res = await customFetch(currentUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!res.ok) return sources;
    const html = await res.text();
    const nameMatch = /Name\s*:\s*([^<]+)/i.exec(html);
    const fileName = nameMatch ? nameMatch[1].trim() : "";
    const quality = parseVideoQuality(fileName);

    const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html)) !== null) {
      const link = match[1];
      if (link.includes("pixeldra")) {
        const pxlId = link.split("/").pop()?.replace(/\?.*$/, "");
        if (pxlId && !sources.some((s) => s.url.includes(pxlId))) {
          sources.push({
            url: `https://pixeldrain.com/api/file/${pxlId}?download`,
            quality,
            format: "mp4",
            headers: { "User-Agent": "Mozilla/5.0" }
          });
        }
      }
    }
  } catch {
    // ignore
  }
  return sources;
}

export function decodeUrlParam(urlWithParam) {
  try {
    if (urlWithParam.includes("url=")) {
      const b64 = urlWithParam.substring(urlWithParam.indexOf("url=") + 4);
      return Buffer.from(b64, "base64").toString("utf-8");
    }
    return urlWithParam;
  } catch {
    return null;
  }
}

export async function extractDriveleechSources(initialUrl, customFetch = fetch) {
  const sources = [];
  try {
    const res = await customFetch(initialUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!res.ok) return sources;
    const html = await res.text();
    const nameMatch = /Name\s*:\s*([^<]+)/i.exec(html);
    const fileName = nameMatch ? nameMatch[1].trim() : "";
    const quality = parseVideoQuality(fileName);

    const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html)) !== null) {
      const link = match[1];
      const text = match[2];
      if (text.includes("Cloud Download") || text.includes("Direct Links") || text.includes("Instant Download")) {
        if (link.startsWith("http")) {
          sources.push({
            url: link,
            quality,
            format: link.includes(".m3u8") ? "hls" : "mp4",
            headers: { "User-Agent": "Mozilla/5.0" }
          });
        }
      }
    }
  } catch {
    // ignore
  }
  return sources;
}

export function isVideoStreamUrl(url) {
  if (!url || typeof url !== "string") return false;
  const clean = url.toLowerCase().split("?")[0];
  if (
    clean.includes("/embed/") ||
    clean.includes("/video/") ||
    clean.endsWith(".html") ||
    clean.endsWith(".htm") ||
    clean.endsWith(".php")
  ) {
    return false;
  }
  return (
    clean.endsWith(".m3u8") ||
    clean.endsWith(".mp4") ||
    clean.endsWith(".mkv") ||
    clean.endsWith(".webm") ||
    url.includes("pixeldrain.com/api/file/")
  );
}

export const SDK = {
  ExtensionError,
  ItemNotFoundError,
  SourceUnavailableError,
  ExtensionTimeoutError,
  CINEMETA_BASE_URL,
  DEFAULT_FALLBACK_URLS,
  getLatestDynamicUrls,
  getProviderBaseUrl,
  extractBaseUrl,
  decodeHtmlEntities,
  stripHtmlTags,
  extractTagContent,
  extractMetaContent,
  extractAttribute,
  extractImdbId,
  parseVideoQuality,
  fetchCinemetaMeta,
  searchCinemeta,
  extractDoubleAtob,
  extractPxlUrl,
  extractHubCloudSources,
  bypassSidexfee,
  extractGdflixSources,
  decodeUrlParam,
  extractDriveleechSources,
  isVideoStreamUrl
};
