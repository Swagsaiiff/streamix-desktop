import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStreamManager, initHlsDir, buildAudioLayout, pickStreamMode } from "./stream.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixturePath = resolve(repoRoot, "temp", "fixtures", "multi-audio.mkv");

function ensureFixture() {
  if (!existsSync(fixturePath)) {
    const result = spawnSync(process.execPath, [resolve(repoRoot, "scripts", "make-test-fixture.mjs")], {
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status !== 0) {
      throw new Error(`fixture generation failed: ${result.stderr || result.error?.message}`);
    }
  }
}

test("probe and HLS session exposes two real audio tracks", { timeout: 60000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  const session = await manager.createSession(fixturePath);

  assert.ok(["ready", "streaming"].includes(session.status));
  assert.equal(session.mode, "remux");
  assert.equal(session.audioTracks.length, 2);
  assert.equal(session.audioTracks[0].default, true);
  assert.equal(session.audioTracks[1].default, false);

  const { content } = await manager.getMasterPlaylist(session.sessionId);
  assert.match(content, /#EXT-X-MEDIA:TYPE=AUDIO/);
  assert.equal((content.match(/#EXT-X-MEDIA:TYPE=AUDIO/g) ?? []).length, 2);
  assert.match(content, /#EXT-X-STREAM-INF:.*AUDIO="group_aud"/);

  const videoPlaylist = await manager.resolveFile(session.sessionId, "index_v0.m3u8");
  assert.ok(videoPlaylist.length > 0);
  await manager.cleanupSession(session.sessionId);
  assert.equal(await manager.getSession(session.sessionId), null);
});

test("rejects invalid file names", { timeout: 30000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  const session = await manager.createSession(fixturePath);
  await assert.rejects(() => manager.resolveFile(session.sessionId, "../secret.txt"));
  await assert.rejects(() => manager.resolveFile(session.sessionId, "a/b.ts"));
  await manager.cleanupSession(session.sessionId);
});

test("fails cleanly when the source cannot be opened", { timeout: 60000 }, async () => {
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  await assert.rejects(() => manager.createSession(resolve(repoRoot, "temp", "does-not-exist.mkv")));
  assert.equal(activeSessionCount(manager), 0);
});

test("selects the preferred audio track default using real track metadata", { timeout: 60000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  const session = await manager.createSession(fixturePath, { preferredLanguage: "es" });
  const defaults = session.audioTracks.filter((t) => t.default === true);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].language, "es");
  await manager.cleanupSession(session.sessionId);
});

test("buildAudioLayout never labels unknown tracks as a language", () => {
  const { tracks, defaultTrackIndex } = buildAudioLayout(
    [{ tags: {} }, { tags: {} }],
    "hi"
  );
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].language, null);
  assert.equal(tracks[1].language, null);
  assert.equal(tracks[0].name, "Audio 1");
  assert.equal(defaultTrackIndex, 0);
  assert.equal(tracks[0].default, true);
  assert.equal(tracks[1].default, false);
});

test("buildAudioLayout ignores preferred language when no track matches", () => {
  const { tracks, defaultTrackIndex } = buildAudioLayout(
    [{ tags: { language: "en" } }, { tags: { language: "es" } }],
    "hi"
  );
  assert.equal(defaultTrackIndex, 0);
  assert.equal(tracks[0].default, true);
});

test("pickStreamMode remuxes H.264 + AAC and transcodes anything else", () => {
  const remux = pickStreamMode({ codec_name: "h264" }, [{ codec_name: "aac" }, { codec_name: "aac" }]);
  assert.equal(remux.mode, "remux");
  assert.equal(remux.video, "copy");
  assert.equal(remux.audio, "copy");

  const transcodeVideo = pickStreamMode({ codec_name: "hevc" }, [{ codec_name: "aac" }]);
  assert.equal(transcodeVideo.mode, "transcode");

  const transcodeAudio = pickStreamMode({ codec_name: "h264" }, [{ codec_name: "ac3" }]);
  assert.equal(transcodeAudio.mode, "transcode");

  const mixed = pickStreamMode({ codec_name: "h264" }, [{ codec_name: "aac" }, { codec_name: "ac3" }]);
  assert.equal(mixed.mode, "transcode");
});

test("buildMasterPlaylist emits a video STREAM-INF and unique audio rendition names", async () => {
  const { buildMasterPlaylist } = await import("./stream.js");
  const audios = [{ channels: 2, bit_rate: "128000", codec_name: "aac" }, { channels: 2, bit_rate: "128000", codec_name: "aac" }];
  const tracks = [
    { trackId: 0, name: "Release.Group", language: "hin", default: true },
    { trackId: 1, name: "Release.Group", language: "eng", default: false }
  ];
  const master = buildMasterPlaylist({ video: { codec_name: "h264", width: 856, height: 356, bit_rate: "900000" }, audios, tracks });

  assert.match(master, /#EXT-X-STREAM-INF:.*AUDIO="group_aud"/);
  assert.match(master, /index_v0\.m3u8/);
  assert.equal((master.match(/#EXT-X-MEDIA:TYPE=AUDIO/g) ?? []).length, 2);

  const names = [...master.matchAll(/NAME="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length);
  assert.match(names[0], /hin/);
  assert.match(names[1], /eng/);
});

test("buildMasterPlaylist advertises output codecs, not source codecs, when transcoding", async () => {
  const { buildMasterPlaylist } = await import("./stream.js");
  const hevcSource = { codec_name: "hevc", width: 828, height: 378, bit_rate: "900000" };
  const ac3Audio = [{ channels: 2, bit_rate: "192000", codec_name: "ac3" }];
  const tracks = [{ trackId: 0, name: "Hindi", language: "hin", default: true }];

  const transcoded = buildMasterPlaylist({ video: hevcSource, audios: ac3Audio, tracks, mode: "transcode" });
  assert.match(transcoded, /CODECS="avc1\.4d401f,mp4a\.40\.2"/);
  assert.doesNotMatch(transcoded, /hvc1/);
  assert.doesNotMatch(transcoded, /ac-3/);

  const remuxed = buildMasterPlaylist({
    video: { codec_name: "h264", width: 1280, height: 720, bit_rate: "2000000" },
    audios: [{ channels: 2, bit_rate: "128000", codec_name: "aac" }],
    tracks,
    mode: "remux"
  });
  assert.match(remuxed, /CODECS="avc1\.4d401f,mp4a\.40\.2"/);
});

test("buildMasterPlaylist does not duplicate the language when the track name already contains it", async () => {
  const { buildMasterPlaylist } = await import("./stream.js");
  const master = buildMasterPlaylist({
    video: { codec_name: "h264", width: 1280, height: 720, bit_rate: "2000000" },
    audios: [
      { channels: 2, bit_rate: "128000", codec_name: "aac" },
      { channels: 2, bit_rate: "128000", codec_name: "aac" }
    ],
    tracks: [
      { trackId: 0, name: "hin", language: "hin", default: true },
      { trackId: 1, name: "Audio 2", language: "eng", default: false }
    ],
    mode: "remux"
  });
  const names = [...master.matchAll(/NAME="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names[0], "hin");
  assert.equal(names[1], "Audio 2 (eng)");
});

test("stream sessions are isolated from each other", { timeout: 60000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  const first = await manager.createSession(fixturePath);
  const second = await manager.createSession(fixturePath);

  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.hlsDir, second.hlsDir);

  await manager.cleanupSession(first.sessionId);
  assert.equal(await manager.getSession(first.sessionId), null);
  assert.ok(await manager.getSession(second.sessionId));
  await manager.cleanupSession(second.sessionId);
  assert.equal(await manager.getSession(second.sessionId), null);
});

test("expired sessions are reaped and cleaned up", { timeout: 60000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1, sessionMaxAgeMs: 100 });
  const session = await manager.createSession(fixturePath);
  assert.ok(await manager.getSession(session.sessionId));
  await new Promise((resolve) => setTimeout(resolve, 150));
  await manager.cleanupExpiredSessions();
  assert.equal(await manager.getSession(session.sessionId), null);
  assert.equal(await manager.getActiveSessionCount(), 0);
});

test("boot-time init purges orphaned session workspaces and a session dir is removed on cleanup", { timeout: 60000 }, async () => {
  ensureFixture();
  await initHlsDir();
  const manager = createStreamManager({ maxConcurrent: 1 });
  const session = await manager.createSession(fixturePath);
  assert.ok(existsSync(session.hlsDir));

  // Simulate a fresh server boot: orphaned dirs (not tracked in memory) are removed.
  const orphan = resolve(repoRoot, "temp", "hls", "orphan-session-dir");
  await mkdir(orphan, { recursive: true });
  await writeFile(join(orphan, "chunk.ts"), "x");
  await initHlsDir();
  assert.equal(existsSync(orphan), false);

  await manager.cleanupSession(session.sessionId);
  assert.equal(existsSync(session.hlsDir), false);
});

function activeSessionCount(manager) {
  return manager.getActiveSessionCount ? manager.getActiveSessionCount() : 0;
}
