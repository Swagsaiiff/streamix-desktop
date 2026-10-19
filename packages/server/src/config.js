import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../../..");

function loadEnvSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      process.loadEnvFile(filePath);
    }
  } catch {}
}

function findUpEnv(startDir, maxLevels = 5) {
  let cur = startDir;
  for (let i = 0; i < maxLevels; i++) {
    const candidate = path.join(cur, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

// 1. Explicit env file path
if (process.env.STREAMIX_ENV_FILE) {
  loadEnvSafe(process.env.STREAMIX_ENV_FILE);
}

// 2. Packaged desktop app user data directory
if (process.env.STREAMIX_USER_DATA) {
  loadEnvSafe(path.join(process.env.STREAMIX_USER_DATA, ".env"));
  const userJsonPath = path.join(process.env.STREAMIX_USER_DATA, "config.json");
  if (fs.existsSync(userJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(userJsonPath, "utf8"));
      if (parsed.tmdbApiKey && !process.env.TMDB_API_KEY) {
        process.env.TMDB_API_KEY = parsed.tmdbApiKey;
      }
    } catch {}
  }
}

// 3. Bundled configuration in packaged desktop app
const bundledCandidates = [
  path.join(configDir, "../default-config.json"),
  path.join(configDir, "default-config.json"),
  path.join(configDir, "../.env"),
  path.join(configDir, ".env")
];
for (const cand of bundledCandidates) {
  if (cand.endsWith(".json") && fs.existsSync(cand)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cand, "utf8"));
      if (parsed.tmdbApiKey && !process.env.TMDB_API_KEY) {
        process.env.TMDB_API_KEY = parsed.tmdbApiKey;
      }
    } catch {}
  } else if (cand.endsWith(".env") && fs.existsSync(cand)) {
    loadEnvSafe(cand);
  }
}

// 4. Search upward for .env from configDir and cwd
loadEnvSafe(findUpEnv(configDir));
loadEnvSafe(findUpEnv(process.cwd()));
loadEnvSafe(path.join(repoRoot, ".env"));

export const config = {
  port: Number(process.env.PORT) || 4000,
  tmdbApiKey: process.env.TMDB_API_KEY || "",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  fixturePath: process.env.STREAMIX_FIXTURE || path.join(repoRoot, "temp", "fixtures", "multi-audio.mkv"),
  fixtureFallback: process.env.STREAMIX_FIXTURE_FALLBACK === "true",
  sessionMaxSeconds: Number(process.env.STREAMIX_SESSION_MAX_SECONDS) || 0,
  maxConcurrentSessions: Number(process.env.MAX_CONCURRENT_SESSIONS) || 2,
  sessionMaxAgeMs: Number(process.env.STREAMIX_SESSION_MAX_AGE_MS) || 1800000,
  sessionReaperIntervalMs: Number(process.env.STREAMIX_REAPER_INTERVAL_MS) || 120000,
  preferredAudioLanguage: process.env.PREFERRED_AUDIO_LANGUAGE || "en",
  isProduction: process.env.NODE_ENV === "production"
};
