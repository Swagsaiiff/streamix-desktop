import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../../..");

const envPath = path.join(repoRoot, ".env");

try {
  process.loadEnvFile(envPath);
} catch {
  // no .env file at the repo root; exported environment variables are used as-is
}

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
