import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "temp", "fixture");
const fixturePath = join(outDir, "multi-audio-test.mkv");
const srtPath = join(outDir, "subs.srt");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

const srt = `1
00:00:01,000 --> 00:00:05,000
Hello from the STREAMIX test fixture.

2
00:00:06,000 --> 00:00:10,000
This synthetic clip carries two audio tracks.

3
00:00:11,000 --> 00:00:15,000
Audio 1 is a 440 Hz tone. Audio 2 is a 550 Hz tone.

4
00:00:16,000 --> 00:00:45,000
If you can read this, subtitle delivery over HLS works.
`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(srtPath, srt, "utf8");

const args = [
  "-y",
  "-hide_banner",
  "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=45",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=45",
  "-f", "lavfi", "-i", "sine=frequency=550:duration=45",
  "-i", srtPath,
  "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-map", "3:s:0",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "64k", "-ac", "2",
  "-c:s", "srt",
  "-metadata:s:a:0", "language=eng",
  "-metadata:s:a:0", "title=Audio Track 1 (English)",
  "-metadata:s:a:1", "language=spa",
  "-metadata:s:a:1", "title=Audio Track 2 (Spanish)",
  "-metadata:s:s:0", "language=eng",
  "-metadata:s:s:0", "title=English Subtitles",
  fixturePath
];

const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
proc.on("close", (code) => {
  if (code !== 0) {
    console.error(stderr);
    process.exit(1);
  }
  console.log(`fixture written: ${fixturePath}`);
});
proc.on("error", (err) => {
  console.error(`ffmpeg spawn failed: ${err.message}`);
  process.exit(1);
});
