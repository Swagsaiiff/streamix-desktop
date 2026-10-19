import { spawn } from "node:child_process";
import { rm, mkdir, readdir, readFile } from "node:fs/promises";

const base = "D:/saif/12341234/temp/spike";
const dir = (f) => `${base}/${f}`;

await rm(base, { recursive: true, force: true });
await mkdir(base, { recursive: true });

const args = [
  "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
  "-i", "D:/saif/12341234/temp/fixture/multi-audio-test.mkv",
  "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
  "-hls_segment_filename", dir("v0-%03d.ts"), dir("v0.m3u8"),
  "-map", "0:a:0", "-c:a", "aac", "-ac", "2", "-b:a", "128k",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
  "-hls_segment_filename", dir("a0-%03d.ts"), dir("a0.m3u8"),
  "-map", "0:a:1", "-c:a", "aac", "-ac", "2", "-b:a", "128k",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
  "-hls_segment_filename", dir("a1-%03d.ts"), dir("a1.m3u8"),
  "-map", "0:s:0", "-c:s", "webvtt",
  "-f", "webvtt", dir("subs0.vtt")
];

const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
proc.on("error", (err) => { console.error("spawn error:", err.message); process.exit(1); });
proc.on("close", async (code) => {
  console.log("ffmpeg exit code:", code);
  if (code !== 0) {
    console.log(stderr);
    process.exit(1);
  }
  const files = await readdir(base);
  console.log("files:", files.join(", "));
  for (const f of ["v0.m3u8", "a0.m3u8", "a1.m3u8"]) {
    const content = await readFile(dir(f), "utf8");
    console.log(`--- ${f} (${content.split("\n").length} lines) ---`);
    console.log(content.split("\n").slice(0, 12).join("\n"));
  }
});
