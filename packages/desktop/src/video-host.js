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
    this.pendingResolvers = [];
    this.onEvent = null;
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
        const resolver = this.pendingResolvers.shift();
        if (resolver) resolver(parsed);
      } catch (err) {
        console.error("[VideoHost] Failed to parse output:", trimmed, err);
      }
    });

    this.proc.stderr.on("data", (d) => {
      console.warn(`[VideoHost stderr] ${d.toString().trim()}`);
    });

    this.proc.on("exit", (code, signal) => {
      console.log(`[VideoHost exit] code=${code} signal=${signal}`);
      this.currentHwnd = null;
      while (this.pendingResolvers.length > 0) {
        const res = this.pendingResolvers.shift();
        res({ ok: false, error: "Process exited" });
      }
    });
  }

  sendCommand(cmd) {
    this.ensureProcess();
    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
      this.proc.stdin.write(cmd + "\n");
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

    const res = await this.sendCommand(`CREATE ${parentHwnd} ${x} ${y} ${w} ${h}`);
    if (res?.ok && res.hwnd) {
      this.currentHwnd = res.hwnd;
      return res.hwnd;
    }
    throw new Error(res?.error || "Failed to create video host window");
  }

  async setBounds(bounds) {
    if (!this.currentHwnd) return;
    const x = Math.max(0, Math.round(bounds.x || 0));
    const y = Math.max(0, Math.round(bounds.y || 0));
    const w = Math.max(1, Math.round(bounds.width || 100));
    const h = Math.max(1, Math.round(bounds.height || 100));
    return await this.sendCommand(`BOUNDS ${x} ${y} ${w} ${h}`);
  }

  async sync() {
    if (!this.currentHwnd) return;
    return await this.sendCommand("SYNC");
  }

  async show() {
    if (!this.currentHwnd) return;
    return await this.sendCommand("SHOW");
  }

  async hide() {
    if (!this.currentHwnd) return;
    return await this.sendCommand("HIDE");
  }

  async destroy() {
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
        this.proc.stdin.write("QUIT\n");
      } catch {}
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
      this.rl = null;
    }
  }
}
