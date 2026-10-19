import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

export class MpvManager {
  constructor() {
    this.proc = null;
    this.socket = null;
    this.reqId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.pipeName = null;
    this.onEvent = null;
    this.pollTimer = null;
    this.cachedTracks = [];
    this.cachedSubtitles = [];
    this.activeAid = null;
    this.activeSid = null;
  }

  locateBinary() {
    const candidates = [
      process.env.STREAMIX_MPV_PATH,
      path.resolve(process.resourcesPath || "", "mpv/mpv.exe"),
      path.resolve(process.resourcesPath || "", "bin/mpv.exe"),
      path.resolve(__dirname, "../bin/mpv/mpv.exe"),
      path.resolve(rootDir, "packages/desktop/bin/mpv/mpv.exe"),
      path.resolve(rootDir, "packages/desktop/bin/mpv.exe"),
      path.resolve(rootDir, "temp/mpv-bin/mpv.exe"),
      path.resolve(rootDir, "temp/mpv-bin/mpv.com"),
      "mpv.exe",
      "mpv"
    ].filter(Boolean);
    for (const cand of candidates) {
      if (path.isAbsolute(cand) && fs.existsSync(cand)) {
        return cand;
      }
    }
    return "mpv.exe";
  }

  async start(sourceUrl, options = {}) {
    await this.stop();

    const mpvExe = this.locateBinary();
    this.pipeName = `\\\\.\\pipe\\streamix-mpv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const mpvArgs = [
      "--idle=yes",
      `--input-ipc-server=${this.pipeName}`,
      "--audio-client-name=STREAMIX-Desktop",
      "--no-terminal",
      "--keep-open=yes",
      "--force-window=yes",
      "--osc=no",
      "--osd-level=0",
      `--volume=${Math.round((options.volume ?? 1) * 100)}`
    ];

    if (options.headers && typeof options.headers === "object") {
      const headerPairs = [];
      for (const [key, val] of Object.entries(options.headers)) {
        if (!val) continue;
        const lower = key.toLowerCase();
        if (lower === "user-agent") {
          mpvArgs.push(`--user-agent=${val}`);
        } else if (lower === "referer") {
          mpvArgs.push(`--referrer=${val}`);
        } else {
          headerPairs.push(`${key}: ${val}`);
        }
      }
      if (headerPairs.length > 0) {
        mpvArgs.push(`--http-header-fields=${headerPairs.join(",")}`);
      }
    }

    if (options.wid) {
      mpvArgs.push(`--wid=${options.wid}`);
    } else {
      mpvArgs.push("--title=STREAMIX Native Player");
    }

    this.proc = spawn(mpvExe, mpvArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: false
    });

    this.proc.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[mpv stderr] ${msg}`);
    });

    this.proc.on("exit", (code, signal) => {
      console.log(`[mpv exit] code=${code} signal=${signal}`);
      this.cleanup();
      this.emit("ended", { code, signal });
    });

    // Connect to named pipe
    this.socket = await this.connectWithRetry(this.pipeName, 40, 150);
    this.setupSocket();

    // Register property observers or poll
    await this.command("observe_property", 1, "time-pos");
    await this.command("observe_property", 2, "pause");
    await this.command("observe_property", 3, "duration");
    await this.command("observe_property", 4, "track-list");
    await this.command("observe_property", 5, "aid");
    await this.command("observe_property", 6, "sid");
    await this.command("observe_property", 7, "speed");
    await this.command("observe_property", 8, "volume");
    await this.command("observe_property", 9, "mute");
    await this.command("observe_property", 10, "paused-for-cache");
    await this.command("observe_property", 11, "core-idle");

    // Load media
    await this.command("loadfile", sourceUrl, "replace");

    if (options.startTime && Number(options.startTime) > 0) {
      await this.command("seek", Number(options.startTime), "absolute");
    }

    this.startPolling();
    return { ok: true, pipeName: this.pipeName };
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (!this.socket || !this.proc) return;
      try {
        const [pos, dur, paused, aid, sid, spd, vol, muted] = await Promise.all([
          this.getProperty("time-pos").catch(() => null),
          this.getProperty("duration").catch(() => null),
          this.getProperty("pause").catch(() => null),
          this.getProperty("aid").catch(() => null),
          this.getProperty("sid").catch(() => null),
          this.getProperty("speed").catch(() => null),
          this.getProperty("volume").catch(() => null),
          this.getProperty("mute").catch(() => null)
        ]);

        if (pos !== null) this.emit("time-pos", pos);
        if (dur !== null) this.emit("duration", dur);
        if (paused !== null) this.emit("pause", paused);
        if (aid !== null && aid !== this.activeAid) {
          this.activeAid = aid;
          this.emit("aid", aid);
        }
        if (sid !== null && sid !== this.activeSid) {
          this.activeSid = sid;
          this.emit("sid", sid);
        }
        if (spd !== null) this.emit("speed", spd);
        if (vol !== null) this.emit("volume", vol / 100);
        if (muted !== null) this.emit("mute", muted);
      } catch {
        // ignore polling error
      }
    }, 500);
  }

  async connectWithRetry(pipe, retries = 40, delayMs = 150) {
    for (let i = 0; i < retries; i++) {
      try {
        const client = await new Promise((resolve, reject) => {
          const sock = net.connect(pipe, () => resolve(sock));
          sock.on("error", (err) => reject(err));
        });
        return client;
      } catch {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error(`Failed to connect to MPV IPC socket at ${pipe}`);
  }

  setupSocket() {
    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.request_id && this.pending.has(parsed.request_id)) {
            const { resolve, reject } = this.pending.get(parsed.request_id);
            this.pending.delete(parsed.request_id);
            if (parsed.error && parsed.error !== "success") {
              reject(new Error(`MPV error (${parsed.error}) for req ${parsed.request_id}`));
            } else {
              resolve(parsed.data);
            }
          } else if (parsed.event) {
            this.handleEvent(parsed);
          }
        } catch (e) {
          console.error("[MpvManager] Error parsing IPC JSON line:", e);
        }
      }
    });

    this.socket.on("error", (err) => {
      console.error("[MpvManager] Socket error:", err.message);
    });
  }

  handleEvent(eventObj) {
    const { event, name, data } = eventObj;
    if (event === "property-change") {
      if (name === "track-list") {
        this.updateTracks(data);
      } else if (name === "aid") {
        this.activeAid = data;
        this.emit("aid", data);
      } else if (name === "sid") {
        this.activeSid = data;
        this.emit("sid", data);
      } else {
        this.emit(name, data);
      }
    } else if (event === "playback-restart" || event === "file-loaded") {
      this.emit("ready", {});
      this.syncTracks();
    } else if (event === "end-file") {
      const reason = data?.reason;
      if (reason === "error") {
        const errorText = data?.file_error || "Unknown playback error";
        this.emit("error", { reason: "error", error: errorText });
      } else {
        this.emit("ended", data);
      }
    }
  }

  async syncTracks() {
    try {
      const tracks = await this.getProperty("track-list");
      this.updateTracks(tracks);
    } catch {
      // ignore
    }
  }

  updateTracks(tracks) {
    if (!Array.isArray(tracks)) return;
    const audios = tracks.filter((t) => t.type === "audio");
    const subs = tracks.filter((t) => t.type === "sub");
    this.cachedTracks = audios;
    this.cachedSubtitles = subs;
    this.emit("audio-tracks", audios);
    this.emit("subtitle-tracks", subs);
  }

  emit(type, payload) {
    if (typeof this.onEvent === "function") {
      try {
        this.onEvent(type, payload);
      } catch (err) {
        console.error(`[MpvManager] Error in onEvent listener:`, err);
      }
    }
  }

  command(...args) {
    if (!this.socket) {
      return Promise.reject(new Error("MPV IPC socket not connected"));
    }
    const id = this.reqId++;
    const payload = JSON.stringify({ command: args, request_id: id }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(payload, "utf8", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  getProperty(name) {
    return this.command("get_property", name);
  }

  setProperty(name, value) {
    return this.command("set_property", name, value);
  }

  async play() {
    return this.setProperty("pause", false);
  }

  async pause() {
    return this.setProperty("pause", true);
  }

  async seek(seconds, mode = "absolute") {
    return this.command("seek", Number(seconds), mode);
  }

  async setVolume(val) {
    // 0 to 1 -> 0 to 100
    const clamped = Math.max(0, Math.min(100, Math.round(Number(val) * 100)));
    return this.setProperty("volume", clamped);
  }

  async setMute(muted) {
    return this.setProperty("mute", Boolean(muted));
  }

  async setSpeed(speed) {
    return this.setProperty("speed", Number(speed));
  }

  async setAudioTrack(aid) {
    const parsed = Number(aid);
    await this.setProperty("aid", parsed);
    this.activeAid = parsed;
    return parsed;
  }

  async setSubtitleTrack(sid) {
    const val = sid === "no" || sid === null || sid === false ? "no" : Number(sid);
    await this.setProperty("sid", val);
    this.activeSid = val;
    return val;
  }

  cleanup() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this.pending.clear();
    this.buffer = "";
  }

  async stop() {
    this.cleanup();
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}
