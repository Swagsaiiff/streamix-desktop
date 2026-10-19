import { TMDBProvider } from "./tmdb.js";
import { CineStreamProvider } from "./cinemeta.js";
import { VegaMoviesProvider } from "./vegamovies.js";
import { ProviderError } from "./base.js";

const registry = new Map([
  ["TMDB", TMDBProvider],
  ["CineStream", CineStreamProvider],
  ["VegaMovies", VegaMoviesProvider]
]);
const telemetry = new Map();

function recordOutcome(providerName, outcome) {
  const entry =
    telemetry.get(providerName) ?? {
      providerName,
      successes: 0,
      failures: 0,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorAt: null
    };
  if (outcome.ok) {
    entry.successes += 1;
    entry.lastSuccessAt = outcome.at;
  } else {
    entry.failures += 1;
    entry.lastErrorCode = outcome.code;
    entry.lastErrorAt = outcome.at;
  }
  telemetry.set(providerName, entry);
}

export function createProvider(name = "TMDB", options = {}) {
  const ProviderClass = registry.get(name);
  if (!ProviderClass) {
    throw new ProviderError(`unknown provider: ${name}`, "unsupported");
  }
  return new ProviderClass({ ...options, onOutcome: (outcome) => recordOutcome(name, outcome) });
}

export function listConfiguredProviders(options = {}) {
  return Array.from(registry.keys()).map((name) => createProvider(name, options));
}

export function listProviderNames() {
  return Array.from(registry.keys());
}

export function listSearchProviders(options = {}) {
  return listConfiguredProviders(options).filter(
    (provider) => provider.getCapabilities().supportsSearch === true
  );
}

export function getProviderByName(name, options = {}) {
  if (!name) return null;
  if (!registry.has(name)) return null;
  return createProvider(name, options);
}

export function getProviderStatuses() {
  return Array.from(registry.keys()).map((name) => {
    const ProviderClass = registry.get(name);
    const probe = new ProviderClass({});
    const capabilities = probe.getCapabilities();
    const t = telemetry.get(name);
    return {
      name,
      configured: true,
      verifiedRealPlayback: capabilities.supportsStreamResolution === true,
      capabilities,
      telemetry: t ?? {
        successes: 0,
        failures: 0,
        lastSuccessAt: null,
        lastErrorCode: null,
        lastErrorAt: null
      }
    };
  });
}