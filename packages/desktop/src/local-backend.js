import { fork } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

export class LocalBackendService {
  constructor(options = {}) {
    this.port = options.port || 4000;
    this.apiUrl = `http://localhost:${this.port}`;
    this.healthUrl = `${this.apiUrl}/api/health`;
    this.process = null;
    this.serverScript = options.serverScript || null;
    this.isManaged = false;
  }

  locateServerScript(repoRoot, resourcesPath) {
    const candidates = [
      process.env.STREAMIX_SERVER_ENTRY,
      path.resolve(repoRoot, "packages/server/src/index.js"),
      path.resolve(resourcesPath || "", "app/packages/server/src/index.js"),
      path.resolve(resourcesPath || "", "server/index.js")
    ].filter(Boolean);

    for (const cand of candidates) {
      if (existsSync(cand)) return cand;
    }
    return null;
  }

  async isRunning() {
    try {
      const res = await fetch(this.healthUrl, { method: "GET" });
      if (res.ok) {
        const body = await res.json();
        return Boolean(body.ok);
      }
    } catch {
      // not responding
    }
    return false;
  }

  async waitForHealth(timeoutMs = 15000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isRunning()) {
        return true;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  async start(options = {}) {
    // 1. Check if an external or dev server instance is already running
    if (await this.isRunning()) {
      console.log(`[local-backend] Existing backend server detected at ${this.apiUrl}`);
      this.isManaged = false;
      return { ok: true, managed: false, apiUrl: this.apiUrl };
    }

    const scriptPath = this.serverScript || this.locateServerScript(options.repoRoot, options.resourcesPath);
    if (!scriptPath) {
      throw new Error(`[local-backend] Could not find server script entry point.`);
    }

    console.log(`[local-backend] Spawning managed local backend process: ${scriptPath}`);
    const env = {
      ...process.env,
      PORT: String(this.port),
      STREAMIX_TEMP_DIR: options.userDataPath ? path.join(options.userDataPath, "temp") : undefined,
      NODE_ENV: options.isDev ? "development" : "production"
    };

    this.process = fork(scriptPath, [], {
      env,
      silent: true,
      windowsHide: true
    });
    this.isManaged = true;

    this.process.stdout?.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[server stdout] ${msg}`);
    });

    this.process.stderr?.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[server stderr] ${msg}`);
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[local-backend] Server process exited with code=${code}, signal=${signal}`);
      this.process = null;
    });

    const ready = await this.waitForHealth(20000, 300);
    if (!ready) {
      this.stop();
      throw new Error(`[local-backend] Server started but failed /api/health check within 20s.`);
    }

    console.log(`[local-backend] Local backend successfully verified and ready at ${this.apiUrl}`);
    return { ok: true, managed: true, apiUrl: this.apiUrl };
  }

  stop() {
    if (this.process) {
      console.log(`[local-backend] Stopping managed local backend process...`);
      try {
        this.process.kill("SIGTERM");
      } catch {
        // already stopped
      }
      this.process = null;
    }
  }
}
