import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "temp", "fixtures");
const outFile = resolve(outDir, "multi-audio.mkv");

if (existsSync(outFile)) {
  console.log(`Fixture already exists: ${outFile}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  "ffmpeg",
  [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=5",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-map", "0:v", "-map", "1:a", "-map", "2:a",
    "-metadata:s:a:0", "title=Audio Track 1",
    "-metadata:s:a:1", "title=Audio Track 2",
    "-metadata:s:a:0", "language=en",
    "-metadata:s:a:1", "language=es",
    outFile
  ],
  { encoding: "utf8" }
);

if (result.status !== 0) {
  console.error(`ffmpeg failed (${result.status}): ${result.stderr || result.error?.message}`);
  process.exit(1);
}

console.log(`Fixture written: ${outFile}`);