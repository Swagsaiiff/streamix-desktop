import { ProviderError, isRetryableError } from "./base.js";
import { logger } from "../logger.js";

const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 200;

function validateType(type) {
  return type === "movie" || type === "series" ? type : null;
}

function validateId(id) {
  if (id == null || typeof id !== "string") return null;
  if (id.length < 1 || id.length > 300) return null;
  if (/[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createResolver({
  providers = [],
  fixturePath = null,
  allowFixture = true,
  retries = DEFAULT_RETRIES,
  extensionManager = null
} = {}) {
  const inFlight = new Map();

  async function getDetailWithRetries(provider, type, id) {
    let attempt = 0;
    for (;;) {
      try {
        const detail = await provider.getDetails(type, id);
        if (!detail) {
          throw new ProviderError(`No detail found for ${type}/${id}`, "not_found");
        }
        return detail;
      } catch (err) {
        if (isRetryableError(err) && attempt < retries) {
          attempt += 1;
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw err;
      }
    }
  }

  function orderProviders(providerName) {
    if (!providerName) return providers;
    const named = providers.filter((p) => p.getName() === providerName);
    const rest = providers.filter((p) => p.getName() !== providerName);
    return [...named, ...rest];
  }

  async function doResolve(
    type,
    id,
    { preferredLanguage = null, provider = null, allowFixture: allowFixtureOverride, season = null, episode = null, isNative = false } = {}
  ) {
    const validType = validateType(type);
    if (!validType) {
      throw new ProviderError("Type must be 'movie' or 'series'", "validation");
    }
    const validId = validateId(id);
    if (!validId) {
      throw new ProviderError("Invalid id parameter", "validation");
    }

    const fixtureAllowed = allowFixtureOverride ?? allowFixture;
    const attemptedProviders = [];
    const noExtractor = [];
    let lastError = null;
    let resolvedDetail = null;
    let resolvedProviderName = null;

    for (const candidate of orderProviders(provider)) {
      attemptedProviders.push(candidate.getName());
      const isRequestedProvider = provider != null && candidate.getName() === provider;
      let detail = null;
      try {
        detail = await getDetailWithRetries(candidate, validType, validId);
      } catch (err) {
        if (!isRetryableError(err)) {
          if (isRequestedProvider) throw err;
          lastError = err;
          continue;
        }
        lastError = err;
        continue;
      }
      resolvedDetail = detail;
      resolvedProviderName = candidate.getName();

      const capabilities = candidate.getCapabilities();
      if (capabilities.supportsStreamResolution === true && typeof candidate.resolveStream === "function") {
        const source = await candidate.resolveStream(detail, { preferredLanguage, season, episode, isNative });
        return {
          provider: { name: candidate.getName(), resolution: "provider_stream" },
          resolution: {
            status: "provider_stream",
            attemptedProviders,
            sourceType: source.sourceType ?? "provider"
          },
          sourceUrl: source.url,
          headers: source.headers ?? {},
          mediaType: source.mediaType ?? null,
          episode: source.episode ?? null,
          title: detail.title,
          year: detail.year,
          note: source.note ?? null
        };
      }

      noExtractor.push(candidate.getName());
    }

    // Delegate stream resolution to installed & enabled Streamix extensions
    if (extensionManager && resolvedDetail?.title) {
      try {
        logger.info("resolve.extensions_query", {
          title: resolvedDetail.title,
          year: resolvedDetail.year ?? null,
          type: validType,
          season,
          episode
        });

        const extResult = await extensionManager.resolveSources({
          title: resolvedDetail.title,
          year: resolvedDetail.year ?? null,
          type: validType,
          season,
          episode,
          tmdbId: resolvedDetail.tmdbId || (resolvedDetail.provider === "TMDB" ? resolvedDetail.id : null),
          imdbId: resolvedDetail.imdbId || null
        });

        if (extResult && Array.isArray(extResult.sources) && extResult.sources.length > 0) {
          const primarySource = extResult.sources[0];
          return {
            provider: {
              name: extResult.provider.name,
              id: extResult.provider.id,
              version: extResult.provider.version,
              resolution: "extension_stream"
            },
            resolution: {
              status: "provider_stream",
              attemptedProviders: [extResult.provider.name],
              sourceType: primarySource.format || "stream",
              quality: primarySource.quality || null,
              variantCount: extResult.sources.length
            },
            sourceUrl: primarySource.url,
            candidates: extResult.sources.map((s) => ({
              url: s.url,
              quality: s.quality || (s.height ? `${s.height}p` : null),
              format: s.format,
              headers: s.headers || primarySource.headers || {}
            })),
            variants: extResult.sources.map((s) => ({
              url: s.url,
              quality: s.quality || (s.height ? `${s.height}p` : null),
              height: s.height || (s.quality ? parseInt(s.quality, 10) || null : null),
              format: s.format,
              headers: s.headers || primarySource.headers || {}
            })),
            subtitles: extResult.subtitles || [],
            headers: primarySource.headers || {},
            mediaType:
              primarySource.format === "hls" || primarySource.url?.includes(".m3u8")
                ? "hls"
                : (primarySource.format || "mp4"),
            episode,
            title: resolvedDetail.title,
            year: resolvedDetail.year ?? null,
            note: `Resolved via ${extResult.provider.name} extension`
          };
        }
      } catch (err) {
        lastError = err;
        logger.warn("resolve.extension_failed", {
          title: resolvedDetail.title,
          code: err.code ?? "error",
          reason: String(err.message ?? "").slice(0, 200)
        });
        throw new ProviderError(err.message, "not_found", err);
      }
    }

    if (fixtureAllowed && fixturePath) {
      return {
        provider: { name: resolvedProviderName ?? attemptedProviders[0] ?? null, resolution: "local_fixture" },
        resolution: {
          status: "fixture_fallback",
          attemptedProviders,
          note: "TEST MODE: no real provider source was used; playing the local test fixture"
        },
        sourceUrl: fixturePath,
        headers: {},
        sourceType: "local_fixture",
        mediaType: "mkv",
        title: resolvedDetail?.title ?? null,
        year: resolvedDetail?.year ?? null,
        note: "TEST MODE: no real provider source was used; playing the local test fixture"
      };
    }

    if (noExtractor.length > 0) {
      throw new ProviderError(
        `No real stream source is available for '${resolvedDetail?.title || validId}'. Please check Settings -> Extensions to ensure a compatible provider extension is installed and enabled.`,
        "unsupported"
      );
    }
    throw lastError ?? new ProviderError("no compatible provider configured", "unsupported");
  }

  function resolveStream(type, id, options) {
    const key = `${type}:${id}:${options?.provider ?? ""}:${options?.season ?? ""}:${options?.episode ?? ""}:${options?.isNative ? "native" : "web"}`;
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const promise = doResolve(type, id, options).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  return { resolveStream };
}
