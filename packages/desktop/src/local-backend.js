import { fork } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      path.resolve(__dirname, "../server/src/index.js"),
      path.resolve(resourcesPath || "", "app.asar.unpacked/server/src/index.js"),
      path.resolve(resourcesPath || "", "app/server/src/index.js"),
      path.resolve(resourcesPath || "", "app/packages/server/src/index.js"),
      path.resolve(resourcesPath || "", "server/src/index.js"),
      path.resolve(resourcesPath || "", "server/index.js"),
      path.resolve(__dirname, "../../server/src/index.js"),
      repoRoot ? path.resolve(repoRoot, "packages/server/src/index.js") : null
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

    let userApiKey = null;
    if (options.userDataPath) {
      const userConfigPath = path.join(options.userDataPath, "config.json");
      if (existsSync(userConfigPath)) {
        try {
          const parsed = JSON.parse(readFileSync(userConfigPath, "utf8"));
          if (parsed.tmdbApiKey) userApiKey = parsed.tmdbApiKey;
        } catch {}
      }
    }

    console.log(`[local-backend] Starting local backend: ${scriptPath}`);
    const env = {
      ...process.env,
      PORT: String(this.port),
      STREAMIX_TEMP_DIR: options.userDataPath ? path.join(options.userDataPath, "temp") : undefined,
      STREAMIX_USER_DATA: options.userDataPath || undefined,
      TMDB_API_KEY: userApiKey || process.env.TMDB_API_KEY || "",
      NODE_ENV: options.isDev ? "development" : "production"
    };

    // Attempt fork if not packaged or if executable environment supports it
    let started = false;
    try {
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

      started = await this.waitForHealth(5000, 250);
    } catch (err) {
      console.warn(`[local-backend] Fork spawn failed: ${err.message}`);
    }

    // In-process fallback if fork did not become healthy
    if (!started) {
      console.log(`[local-backend] Fork not ready, starting local backend in-process...`);
      this.stop();
      process.env.PORT = String(this.port);
      if (options.userDataPath) {
        process.env.STREAMIX_TEMP_DIR = path.join(options.userDataPath, "temp");
        process.env.STREAMIX_USER_DATA = options.userDataPath;
      }
      if (userApiKey) {
        process.env.TMDB_API_KEY = userApiKey;
      }
      try {
        await import(pathToFileURL(scriptPath).href);
        this.isManaged = true;
        started = await this.waitForHealth(10000, 250);
      } catch (importErr) {
        console.error(`[local-backend] In-process start failed: ${importErr.message}`);
      }
    }

    if (!started) {
      this.stop();
      throw new Error(`[local-backend] Server started but failed /api/health check within timeout.`);
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
