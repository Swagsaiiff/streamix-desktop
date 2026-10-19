import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, access, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEMP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "temp", "hls");
const HLS_TIME = 4;
const MASTER_PLAYLIST = "master.m3u8";
const VIDEO_PLAYLIST = "index_v0.m3u8";
const FIRST_VIDEO_SEGMENT = "seg_v0_000.ts";
const SEGMENT_NAME_RE = /^[A-Za-z0-9._-]+$/;
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const COPY_VIDEO_CODECS = new Set(["h264"]);
const COPY_AUDIO_CODECS = new Set(["aac"]);
const PLAYLIST_READY_TIMEOUT_MS = 45000;
const DEFAULT_SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_VARIANTS = 3;

const activeSessions = new Map();
const pendingQueue = [];
let activeTranscodes = 0;

export async function initHlsDir() {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
    // Sessions from a previous run cannot be referenced by any client, so purge them on boot.
    const entries = await readdir(TEMP_DIR, { withFileTypes: true });
    await Promise.allSettled(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => rm(join(TEMP_DIR, entry.name), { recursive: true, force: true }))
    );
  } catch {
    // Already exists
  }
}

function headerArgs(headers = {}, includeUserAgent = true) {
  const args = [];
  const entries = Object.entries(headers);
  if (entries.length === 0) return args;
  if (includeUserAgent) args.push("-user_agent", DEFAULT_UA);
  for (const [key, value] of entries) {
    args.push("-headers", `${key}: ${value}\r\n`);
  }
  return args;
}

export function pickStreamMode(video, audios) {
  const videoCodec = video?.codec_name ?? null;
  const audioCodecs = audios.map((a) => a.codec_name ?? null);
  const videoOk = videoCodec != null && COPY_VIDEO_CODECS.has(videoCodec);
  const audioOk = audioCodecs.length > 0 && audioCodecs.every((c) => c != null && COPY_AUDIO_CODECS.has(c));
  if (videoOk && audioOk) {
    return { mode: "remux", video: "copy", audio: "copy", reason: `copy (${videoCodec} + ${audioCodecs.join("/")})` };
  }
  const reasons = [];
  if (!videoOk) reasons.push(`video=${videoCodec ?? "none"}`);
  if (!audioOk) reasons.push(`audio=${audioCodecs.join("/") || "none"}`);
  return { mode: "transcode", video: "libx264", audio: "aac", reason: `transcode (${reasons.join(", ")})` };
}

function probeStreams(ffprobePath, sourceUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", ...headerArgs(headers), "-print_format", "json", "-show_streams", sourceUrl];
    const proc = spawn(ffprobePath, args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (data) => {
      out += data.toString();
    });
    proc.stderr.on("data", (data) => {
      err += data.toString();
    });
    proc.on("error", (e) => reject(new Error(`failed to spawn ffprobe: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${err.slice(0, 300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(out);
        const streams = parsed.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video") ?? null;
        const audios = streams.filter((s) => s.codec_type === "audio");
        resolve({ video, audios });
      } catch {
        reject(new Error("invalid ffprobe output"));
      }
    });
  });
}

export function buildAudioLayout(audios, preferredLanguage = null) {
  const parts = ["v:0,agroup:aud,name:v0"];
  const matchedIndex = preferredLanguage
    ? audios.findIndex((audio) => (audio.tags?.language ?? null) === preferredLanguage)
    : -1;
  const defaultIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const tracks = audios.map((audio, i) => {
    const tags = audio.tags ?? {};
    const language = tags.language || null;
    const name = tags.title || tags.language || `Audio ${i + 1}`;
    let rendition = `a:${i},agroup:aud,name:a${i},default:${i === defaultIndex ? "yes" : "no"}`;
    if (language) rendition += `,language:${language}`;
    parts.push(rendition);
    return { trackId: i, name, language, default: i === defaultIndex, codec: audio.codec_name || null };
  });
  return { layout: parts.join(" "), tracks, defaultTrackIndex: defaultIndex };
}

const VIDEO_CODEC_TAGS = {
  h264: "avc1.4d401f",
  hevc: "hvc1.1.6.L93.B0"
};
const AUDIO_CODEC_TAGS = {
  aac: "mp4a.40.2",
  mp3: "mp4a.40.34"
};

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildMasterPlaylist({ video, audios, tracks, mode = "remux" }) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];

  const seenNames = new Map();
  const uniqueName = (track, i) => {
    const hasLangInName = track.language && normalizeName(track.name).includes(normalizeName(track.language));
    let base = track.language && !hasLangInName ? `${track.name} (${track.language})` : track.name;
    const count = seenNames.get(base) ?? 0;
    seenNames.set(base, count + 1);
    if (count > 0) base = `${base} #${count + 1}`;
    return base;
  };

  tracks.forEach((track, i) => {
    const attrs = [
      `TYPE=AUDIO`,
      `GROUP-ID="group_aud"`,
      `NAME="${uniqueName(track, i)}"`,
      `DEFAULT=${track.default ? "YES" : "NO"}`,
      `AUTOSELECT=YES`
    ];
    if (track.language) attrs.push(`LANGUAGE="${track.language}"`);
    const channels = audios[i]?.channels;
    if (channels) attrs.push(`CHANNELS="${channels}"`);
    attrs.push(`URI="index_a${i}.m3u8"`);
    lines.push(`#EXT-X-MEDIA:${attrs.join(",")}`);
  });

  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const audioBitrate = audios.reduce((sum, a) => sum + (Number(a.bit_rate) || 128000), 0);
  const videoBitrate = Number(video?.bit_rate) || width * height * 3 || 1500000;
  const bandwidth = videoBitrate + audioBitrate;

  // CODECS must describe the OUTPUT, not the source: when we transcode, the HLS video is
  // H.264 and the audio is AAC regardless of what the source container used.
  const outVideoCodec = mode === "remux" ? video?.codec_name : "h264";
  const outAudioCodec = mode === "remux" ? audios[0]?.codec_name : "aac";

  const streamInf = [`BANDWIDTH=${bandwidth}`];
  if (width && height) streamInf.push(`RESOLUTION=${width}x${height}`);
  const codecs = [VIDEO_CODEC_TAGS[outVideoCodec], AUDIO_CODEC_TAGS[outAudioCodec]].filter(Boolean);
  if (codecs.length > 0) streamInf.push(`CODECS="${codecs.join(",")}"`);
  streamInf.push(`AUDIO="group_aud"`);

  lines.push(`#EXT-X-STREAM-INF:${streamInf.join(",")}`);
  lines.push("index_v0.m3u8");
  return `${lines.join("\n")}\n`;
}

// Master playlist for a genuine multi-quality session: one video variant per provider
// rendition plus the audio renditions shared across all variants (so audio switching works
// at every quality). Every entry is derived from real ffprobe data.
export function buildMultiVariantMasterPlaylist({ variants, audios, tracks, mode = "remux" }) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];

  const outAudioCodec = mode === "remux" ? audios[0]?.codec_name : "aac";
  const audioCodecTag = AUDIO_CODEC_TAGS[outAudioCodec] ?? AUDIO_CODEC_TAGS.aac;

  const seenNames = new Map();
  tracks.forEach((track, i) => {
    const hasLangInName = track.language && normalizeName(track.name).includes(normalizeName(track.language));
    let base = track.language && !hasLangInName ? `${track.name} (${track.language})` : track.name;
    const count = seenNames.get(base) ?? 0;
    seenNames.set(base, count + 1);
    if (count > 0) base = `${base} #${count + 1}`;

    const attrs = [
      `TYPE=AUDIO`,
      `GROUP-ID="aud"`,
      `NAME="${base}"`,
      `DEFAULT=${track.default ? "YES" : "NO"}`,
      `AUTOSELECT=YES`
    ];
    if (track.language) attrs.push(`LANGUAGE="${track.language}"`);
    if (audios[i]?.channels) attrs.push(`CHANNELS="${audios[i].channels}"`);
    attrs.push(`URI="index_a${i}.m3u8"`);
    lines.push(`#EXT-X-MEDIA:${attrs.join(",")}`);
  });

  const outVideoCodec = mode === "remux" ? variants[0]?.codecName : "h264";
  const videoCodecTag = VIDEO_CODEC_TAGS[outVideoCodec] ?? VIDEO_CODEC_TAGS.h264;
  const audioBitrate = audios.reduce((sum, a) => sum + (Number(a.bit_rate) || 128000), 0);

  variants.forEach((variant, index) => {
    const width = variant.width ?? 0;
    const height = variant.height ?? 0;
    const bandwidth = (Number(variant.bitrate) || width * height * 3 || 1500000) + audioBitrate;
    const streamInf = [`BANDWIDTH=${bandwidth}`];
    if (width && height) streamInf.push(`RESOLUTION=${width}x${height}`);
    streamInf.push(`CODECS="${[videoCodecTag, audioCodecTag].filter(Boolean).join(",")}"`);
    streamInf.push(`AUDIO="aud"`);
    lines.push(`#EXT-X-STREAM-INF:${streamInf.join(",")}`);
    lines.push(`index_v${index + 1}.m3u8`);
  });

  return `${lines.join("\n")}\n`;
}

export function createStreamManager({
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  maxConcurrent = 2,
  sessionMaxAgeMs = 1800000,
  reaperIntervalMs = 120000,
  playlistReadyTimeoutMs = PLAYLIST_READY_TIMEOUT_MS
} = {}) {
  let reaper = null;

  function pump() {
    while (activeTranscodes < maxConcurrent && pendingQueue.length > 0) {
      const job = pendingQueue.shift();
      activeTranscodes += 1;
      job.fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          activeTranscodes -= 1;
          pump();
        });
    }
  }

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      pendingQueue.push({ fn, resolve, reject });
      pump();
    });
  }

  async function cleanupSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    if (session.proc && session.proc.exitCode === null && !session.proc.killed) {
      try {
        session.proc.kill("SIGTERM");
      } catch {
        // Already gone
      }
    }
    try {
      await rm(session.hlsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    activeSessions.delete(sessionId);
  }

  async function cleanupExpiredSessions(now = Date.now()) {
    const expired = [];
    for (const [sessionId, session] of activeSessions) {
      if (now - session.createdAt > sessionMaxAgeMs) expired.push(sessionId);
    }
    await Promise.allSettled(expired.map((id) => cleanupSession(id)));
  }

  function ensureReaper() {
    if (reaper || reaperIntervalMs <= 0) return;
    reaper = setInterval(() => {
      cleanupExpiredSessions().catch(() => {});
    }, reaperIntervalMs);
    if (typeof reaper.unref === "function") reaper.unref();
  }

  async function waitForPlaylists(sessionDir, proc, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (proc.exitCode !== null && proc.exitCode !== 0) return "failed";

      const ready =
        existsSync(join(sessionDir, VIDEO_PLAYLIST)) && existsSync(join(sessionDir, FIRST_VIDEO_SEGMENT));
      if (ready) return "streaming";

      if (proc.exitCode === 0) return "ready";
      if (Date.now() > deadline) return "timeout";
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function waitForMultiPlaylists(sessionDir, proc, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (proc.exitCode !== null && proc.exitCode !== 0) return "failed";

      const ready =
        existsSync(join(sessionDir, "index_v1.m3u8")) && existsSync(join(sessionDir, "seg_v1_000.ts"));
      if (ready) return "streaming";

      if (proc.exitCode === 0) return "ready";
      if (Date.now() > deadline) return "timeout";
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // Builds one HLS session from several provider renditions (one video variant each) that share
  // the audio renditions of the primary source, so quality switching and audio switching both work.
  async function createMultiVariantSession({ session, sessionDir, ladder, headers, preferredLanguage, maxSeconds, timeoutMs }) {
    let stderr = "";
    const probes = [];
    for (const variant of ladder) {
      const probe = await probeStreams(ffprobePath, variant.url, headers);
      if (!probe.video) throw new Error(`variant ${variant.height ?? "?"}p has no video stream`);
      probes.push({ ...probe, url: variant.url, declared: variant.declared ?? null });
    }
    const primary = probes[0];
    const audios = primary.audios;
    if (audios.length === 0) throw new Error("no audio streams found in the primary variant");

    const { tracks } = buildAudioLayout(audios, preferredLanguage);
    session.audioTracks = tracks;
    session.availableQualities = probes.map((probe) => probe.video.height).filter(Boolean);

    const allCopy =
      probes.every((probe) => COPY_VIDEO_CODECS.has(probe.video.codec_name)) &&
      audios.every((audio) => COPY_AUDIO_CODECS.has(audio.codec_name));
    const videoCodec = allCopy ? "copy" : "libx264";
    const audioCodec = allCopy ? "copy" : "aac";
    session.mode = allCopy ? "remux" : "transcode";
    session.streamMode = {
      mode: session.mode,
      video: videoCodec,
      audio: audioCodec,
      reason: `${allCopy ? "copy" : "transcode"} (multi-quality ladder: ${probes
        .map((probe) => `${probe.video.height ?? "?"}p`)
        .join(", ")})`
    };

    const maps = [];
    probes.forEach((_probe, index) => maps.push("-map", `${index}:v:0`));
    audios.forEach((_audio, index) => maps.push("-map", `0:a:${index}`));

    const layoutParts = [];
    probes.forEach((_probe, index) => layoutParts.push(`v:${index},agroup:aud,name:v${index + 1}`));
    audios.forEach((_audio, index) => layoutParts.push(`a:${index},agroup:aud,name:a${index}`));

    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      ...headerArgs(headers),
      ...probes.flatMap((probe) => ["-i", probe.url]),
      ...(maxSeconds > 0 ? ["-t", String(maxSeconds)] : []),
      ...maps,
      "-c:v", videoCodec,
      "-c:a", audioCodec,
      "-f", "hls",
      "-hls_time", String(HLS_TIME),
      "-hls_list_size", "0",
      "-hls_playlist_type", "event",
      "-hls_flags", "independent_segments",
      "-var_stream_map", layoutParts.join(" "),
      "-hls_segment_filename", "seg_%v_%03d.ts",
      "index_%v.m3u8"
    ];

    session.status = "converting";
    const proc = spawn(ffmpegPath, args, { cwd: sessionDir, windowsHide: true });
    session.proc = proc;
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Already gone
      }
    }, timeoutMs);
    proc.stderr.on("data", (data) => {
      stderr = `${stderr}${data}`.slice(-4000);
      session.stderr = stderr;
    });
    proc.on("error", (err) => {
      session.error = `failed to spawn ffmpeg: ${err.message}`;
    });

    const readiness = await waitForMultiPlaylists(sessionDir, proc, playlistReadyTimeoutMs);
    clearTimeout(timer);

    if (readiness === "timeout") {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Already gone
      }
      throw new Error(`multi-quality ffmpeg did not produce playlists within ${playlistReadyTimeoutMs}ms${stderr ? `: ${stderr.slice(-300)}` : ""}`);
    }
    if (readiness === "failed") {
      throw new Error(`multi-quality ffmpeg exited with code ${proc.exitCode}${stderr ? `: ${stderr.slice(-300)}` : ""}`);
    }

    await writeFile(
      join(sessionDir, MASTER_PLAYLIST),
      buildMultiVariantMasterPlaylist({
        variants: probes.map((probe) => ({
          width: probe.video.width,
          height: probe.video.height,
          bitrate: probe.video.bit_rate,
          codecName: probe.video.codec_name
        })),
        audios,
        tracks,
        mode: session.mode
      }),
      "utf8"
    );

    session.status = readiness;
    return session;
  }

  async function createSession(sourceUrl, { timeoutMs = DEFAULT_SESSION_TIMEOUT_MS, preferredLanguage = null, maxSeconds = 0, headers = {}, variants = null } = {}) {
    // Only use a genuine multi-quality ladder when several real renditions are known.
    const ladder = Array.isArray(variants) && variants.length >= 2
      ? variants.filter((variant) => variant?.url).slice(0, MAX_VARIANTS)
      : null;
    const sessionId = createHash("sha256").update(`${sourceUrl}:${Date.now()}:${Math.random()}`).digest("hex");
    const sessionDir = join(TEMP_DIR, sessionId);
    await mkdir(sessionDir, { recursive: true });

    const session = {
      sessionId,
      sourceUrl,
      hlsDir: sessionDir,
      proc: null,
      status: "pending",
      createdAt: Date.now(),
      preferredLanguage,
      audioTracks: [],
      mode: null,
      streamMode: null,
      stderr: "",
      error: null
    };
    activeSessions.set(sessionId, session);
    ensureReaper();

    return enqueue(async () => {
      let stderr = "";
      try {
        session.status = "probing";
        if (ladder && ladder.length >= 2) {
          return await createMultiVariantSession({ session, sessionDir, ladder, headers, preferredLanguage, maxSeconds, timeoutMs });
        }
        const { video, audios } = await probeStreams(ffprobePath, sourceUrl, headers);
        if (!video) throw new Error("no video stream found in source");
        if (audios.length === 0) throw new Error("no audio streams found in source");

        const { layout, tracks } = buildAudioLayout(audios, preferredLanguage);
        session.audioTracks = tracks;
        const mode = pickStreamMode(video, audios);
        session.mode = mode.mode;
        session.streamMode = mode;

        const args = [
          "-y", "-hide_banner", "-loglevel", "error",
          ...headerArgs(headers),
          "-i", sourceUrl,
          ...(maxSeconds > 0 ? ["-t", String(maxSeconds)] : []),
          "-map", "0:v:0",
          ...audios.map((_, i) => ["-map", `0:a:${i}`]).flat(),
          "-c:v", mode.video,
          "-c:a", mode.audio,
          "-f", "hls",
          "-hls_time", String(HLS_TIME),
          "-hls_list_size", "0",
          "-hls_playlist_type", "event",
          "-hls_flags", "independent_segments",
          "-var_stream_map", layout,
          "-hls_segment_filename", "seg_%v_%03d.ts",
          "index_%v.m3u8"
        ];

        session.status = "converting";
        const proc = spawn(ffmpegPath, args, { cwd: sessionDir, windowsHide: true });
        session.proc = proc;

        const timer = setTimeout(() => {
          try {
            proc.kill("SIGTERM");
          } catch {
            // Already gone
          }
        }, timeoutMs);

        proc.stderr.on("data", (data) => {
          stderr = `${stderr}${data.toString()}`.slice(-4000);
          session.stderr = stderr;
        });
        proc.on("error", (err) => {
          session.error = `failed to spawn ffmpeg: ${err.message}`;
        });

        const readiness = await waitForPlaylists(sessionDir, proc, playlistReadyTimeoutMs);
        clearTimeout(timer);

        if (readiness === "timeout") {
          try {
            proc.kill("SIGTERM");
          } catch {
            // Already gone
          }
          throw new Error(`ffmpeg did not produce an HLS playlist within ${playlistReadyTimeoutMs}ms${stderr ? `: ${stderr.slice(-300)}` : ""}`);
        }
        if (readiness === "failed") {
          throw new Error(`ffmpeg exited with code ${proc.exitCode}${stderr ? `: ${stderr.slice(-300)}` : ""}`);
        }

        await writeFile(
          join(sessionDir, MASTER_PLAYLIST),
          buildMasterPlaylist({ video, audios, tracks, mode: mode.mode }),
          "utf8"
        );

        session.status = readiness;
        return session;
      } catch (err) {
        session.error = err.message;
        await cleanupSession(sessionId);
        throw err;
      }
    });
  }

  async function getSession(sessionId) {
    return activeSessions.get(sessionId) ?? null;
  }

  function isServable(session) {
    return session && (session.status === "ready" || session.status === "streaming");
  }

  async function getMasterPlaylist(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!isServable(session)) {
      throw new Error("Session not ready or not found");
    }
    const content = await readFile(join(session.hlsDir, MASTER_PLAYLIST), "utf8");
    return {
      content,
      audioTracks: session.audioTracks,
      mode: session.mode,
      status: session.status,
      playlistUrl: `/api/stream/${sessionId}/master.m3u8`,
      sessionId
    };
  }

  async function resolveFile(sessionId, filename) {
    const session = activeSessions.get(sessionId);
    if (!isServable(session)) {
      throw new Error("Session not ready or not found");
    }
    if (!SEGMENT_NAME_RE.test(filename)) {
      throw new Error("Invalid file name");
    }
    const full = join(session.hlsDir, filename);
    await access(full);
    return full;
  }

  return {
    initHlsDir,
    createSession,
    getSession,
    getMasterPlaylist,
    resolveFile,
    cleanupSession,
    cleanupExpiredSessions,
    getActiveSessionCount: () => activeSessions.size
  };
}
