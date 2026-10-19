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
  retries = DEFAULT_RETRIES
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

      lastError = new ProviderError(
        `${candidate.getName()} stream resolution is not implemented`,
        "unsupported"
      );
      noExtractor.push(candidate.getName());
    }

    let bridgeAttempted = false;
    let bridgeError = null;
    if (resolvedDetail?.title) {
      for (const bridge of providers) {
        if (bridge.getName() === resolvedProviderName) continue;
        if (typeof bridge.resolveByTitle !== "function") continue;
        bridgeAttempted = true;
        try {
          logger.info("resolve.title_bridge", {
            requestedProvider: resolvedProviderName,
            bridgeProvider: bridge.getName(),
            type: validType,
            title: resolvedDetail.title,
            year: resolvedDetail.year ?? null
          });
          const source = await bridge.resolveByTitle({
            title: resolvedDetail.title,
            year: resolvedDetail.year ?? null,
            type: validType,
            season,
            episode,
            isNative
          });
          return {
            provider: { name: bridge.getName(), resolution: "provider_stream" },
            resolution: {
              status: "provider_stream",
              attemptedProviders,
              sourceType: source.sourceType ?? "provider",
              requestedProvider: resolvedProviderName,
              matchedBy: "title",
              matchScore: source.matchScore ?? null,
              quality: source.quality ?? null,
              variantCount: source.variants?.length ?? 1,
              matchesTried: source.attempts?.filter((attempt) => !attempt.ok).length ?? 0
            },
            sourceUrl: source.url,
            variants: source.variants ?? null,
            headers: source.headers ?? {},
            mediaType: source.mediaType ?? null,
            episode: source.episode ?? null,
            title: source.matchedTitle ?? resolvedDetail.title,
            year: source.matchedYear ?? resolvedDetail.year ?? null,
            note: source.note ?? null
          };
        } catch (err) {
          lastError = err;
          bridgeError = err;
          logger.warn("resolve.title_bridge_failed", {
            bridgeProvider: bridge.getName(),
            title: resolvedDetail.title,
            code: err.code ?? "error",
            reason: String(err.message ?? "").slice(0, 200)
          });
        }
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
        `No real stream source is available for this title (no supported extractor in: ${noExtractor.join(", ")}${
          bridgeAttempted ? `; title-based lookup failed: ${String(bridgeError?.message ?? "no playable match").slice(0, 160)}` : ""
        }).`,
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
