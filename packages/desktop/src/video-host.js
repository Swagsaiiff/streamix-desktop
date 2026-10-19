import { spawn, execSync } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

export class VideoHostManager {
  constructor() {
    this.proc = null;
    this.rl = null;
    this.currentHwnd = null;
    this.seq = 0;
    this.pending = new Map();
    this.onEvent = null;
    this.lastBounds = null;
    this.pendingBounds = null;
    this.inFlightBounds = false;
  }

  locateBinary() {
    const candidates = [
      process.env.STREAMIX_VIDEO_HOST_PATH,
      path.resolve(process.resourcesPath || "", "streamix-video-host.exe"),
      path.resolve(process.resourcesPath || "", "bin/streamix-video-host.exe"),
      path.resolve(__dirname, "../bin/streamix-video-host.exe"),
      path.resolve(rootDir, "packages/desktop/bin/streamix-video-host.exe")
    ].filter(Boolean);

    for (const cand of candidates) {
      if (path.isAbsolute(cand) && fs.existsSync(cand)) {
        return cand;
      }
    }
    return path.resolve(__dirname, "../bin/streamix-video-host.exe");
  }

  ensureProcess() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return;
    }

    let hostExe = this.locateBinary();
    if (!fs.existsSync(hostExe)) {
      const csPath = path.resolve(__dirname, "video-host.cs");
      if (fs.existsSync(csPath)) {
        try {
          fs.mkdirSync(path.dirname(hostExe), { recursive: true });
          const safeHostExe = hostExe.replace(/\//g, "\\");
          const safeCsPath = csPath.replace(/\//g, "\\");
          execSync(
            `C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe /platform:x64 /target:exe /out:"${safeHostExe}" "${safeCsPath}"`,
            { stdio: "ignore" }
          );
        } catch {}
      }
    }

    if (!fs.existsSync(hostExe)) {
      throw new Error(`Video host executable not found at ${hostExe}`);
    }

    this.proc = spawn(hostExe, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.event) {
          if (typeof this.onEvent === "function") {
            try {
              this.onEvent(parsed.event, parsed);
            } catch (evErr) {
              console.error("[VideoHost] Error in onEvent listener:", evErr);
            }
          }
          return;
        }

        const id = Number(parsed.id);
        if (id && this.pending.has(id)) {
          const entry = this.pending.get(id);
          this.pending.delete(id);
          if (entry.timer) clearTimeout(entry.timer);
          entry.resolve(parsed);
          return;
        }

        // Fallback for un-indexed responses
        const firstKey = this.pending.keys().next().value;
        if (firstKey !== undefined) {
          const entry = this.pending.get(firstKey);
          this.pending.delete(firstKey);
          if (entry.timer) clearTimeout(entry.timer);
          entry.resolve(parsed);
        }
      } catch (err) {
        console.error("[VideoHost] Failed to parse output line:", trimmed, err.message);
      }
    });

    this.proc.stderr.on("data", (d) => {
      console.warn(`[VideoHost stderr] ${d.toString().trim()}`);
    });

    this.proc.on("exit", (code, signal) => {
      console.log(`[VideoHost exit] code=${code} signal=${signal}`);
      this.currentHwnd = null;
      this.lastBounds = null;
      for (const [id, entry] of this.pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve({ ok: false, error: "Process exited" });
      }
      this.pending.clear();
    });
  }

  sendCommand(cmdName, ...args) {
    this.ensureProcess();
    const id = ++this.seq;
    const commandPayload = `${cmdName} ${id} ${args.join(" ")}`.trim();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          console.warn(`[VideoHost] Command timed out after 2000ms: ${cmdName} (id=${id})`);
          resolve({ ok: false, error: "Command timeout" });
        }
      }, 2000);

      this.pending.set(id, { resolve, timer });

      try {
        this.proc.stdin.write(commandPayload + "\n", (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending.delete(id);
            resolve({ ok: false, error: err.message });
          }
        });
      } catch (writeErr) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: writeErr.message });
      }
    });
  }

  async createHost(parentHwnd, bounds = { x: 0, y: 0, width: 800, height: 600 }) {
    if (!parentHwnd) {
      throw new Error("parentHwnd is required to create video surface");
    }
    const x = Math.max(0, Math.round(bounds.x || 0));
    const y = Math.max(0, Math.round(bounds.y || 0));
    const w = Math.max(1, Math.round(bounds.width || 800));
    const h = Math.max(1, Math.round(bounds.height || 600));

    const res = await this.sendCommand("CREATE", parentHwnd, x, y, w, h);
    if (res?.ok && res.hwnd) {
      this.currentHwnd = res.hwnd;
      this.lastBounds = { x, y, width: w, height: h };
      return res.hwnd;
    }
    throw new Error(res?.error || "Failed to create video host window");
  }

  async setBounds(bounds) {
    if (!this.currentHwnd || !bounds) return { ok: true };
    const x = Math.max(0, Math.round(bounds.x || 0));
    const y = Math.max(0, Math.round(bounds.y || 0));
    const w = Math.max(1, Math.round(bounds.width || 100));
    const h = Math.max(1, Math.round(bounds.height || 100));

    if (
      this.lastBounds &&
      this.lastBounds.x === x &&
      this.lastBounds.y === y &&
      this.lastBounds.width === w &&
      this.lastBounds.height === h
    ) {
      return { ok: true };
    }

    this.lastBounds = { x, y, width: w, height: h };

    if (this.inFlightBounds) {
      this.pendingBounds = { x, y, width: w, height: h };
      return { ok: true };
    }

    this.inFlightBounds = true;
    try {
      const res = await this.sendCommand("BOUNDS", x, y, w, h);
      return res;
    } finally {
      this.inFlightBounds = false;
      if (this.pendingBounds && this.currentHwnd) {
        const next = this.pendingBounds;
        this.pendingBounds = null;
        this.setBounds(next).catch(() => {});
      }
    }
  }

  async sync() {
    if (!this.currentHwnd) return { ok: true };
    return await this.sendCommand("SYNC");
  }

  async show() {
    if (!this.currentHwnd) return { ok: true };
    return await this.sendCommand("SHOW");
  }

  async hide() {
    if (!this.currentHwnd) return { ok: true };
    return await this.sendCommand("HIDE");
  }

  async destroy() {
    this.lastBounds = null;
    this.pendingBounds = null;
    if (this.currentHwnd) {
      try {
        await this.sendCommand("DESTROY");
      } catch {}
      this.currentHwnd = null;
    }
  }

  async stop() {
    await this.destroy();
    if (this.proc) {
      try {
        this.proc.stdin.write("QUIT 0\n");
      } catch {}
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
      this.rl = null;
    }
  }
}
