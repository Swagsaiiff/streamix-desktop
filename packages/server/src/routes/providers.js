import { Router } from "express";
import { getProviderStatuses } from "../providers/index.js";

export function providersRouter({ fixtureFallback = false } = {}) {
  const router = Router();

  router.get("/providers/status", (_req, res) => {
    const providers = getProviderStatuses();
    const realPlaybackProviders = providers
      .filter((provider) => provider.verifiedRealPlayback)
      .map((provider) => provider.name);

    res.json({
      checkedAt: new Date().toISOString(),
      playback: {
        verifiedRealProviderPlayback: realPlaybackProviders.length > 0,
        realPlaybackProviders,
        fixtureFallbackEnabled: fixtureFallback,
        note:
          realPlaybackProviders.length > 0
            ? `Real stream resolution is implemented for: ${realPlaybackProviders.join(", ")}. Titles from other providers return an explicit 'unsupported' error unless fixture playback is enabled.`
            : "No provider extractor is implemented; Play returns an explicit error unless fixture playback is enabled."
      },
      providers
    });
  });

  return router;
}