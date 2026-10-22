import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diagnosticLogger } from "./diagnostics.js";
import { unpackExtensionPackage, SandboxedExtensionRunner } from "./runtime.js";

const DEFAULT_REPO_URL =
  "https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/main/repository/repository.json";

function resolveUrl(relativeOrAbsolute, baseUrl) {
  if (!relativeOrAbsolute) return "";
  if (
    relativeOrAbsolute.startsWith("http://") ||
    relativeOrAbsolute.startsWith("https://") ||
    relativeOrAbsolute.startsWith("file://")
  ) {
    return relativeOrAbsolute;
  }
  if (!baseUrl) return relativeOrAbsolute;
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    if (path.isAbsolute(baseUrl) || baseUrl.includes(":\\") || baseUrl.startsWith("/")) {
      const baseDir = fs.existsSync(baseUrl) && fs.statSync(baseUrl).isDirectory() ? baseUrl : path.dirname(baseUrl);
      return path.resolve(baseDir, relativeOrAbsolute);
    }
    const cleanBase = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
    return `${cleanBase}${relativeOrAbsolute.replace(/^\.\//, "")}`;
  }
}

export class ExtensionManager {
  constructor({ dataDir = null, storageDir = null, defaultRepoUrl = null } = {}) {
    const cwd = process.cwd();
    const defaultData = cwd.endsWith(path.join("packages", "server"))
      ? path.join(cwd, "data")
      : path.resolve(cwd, "packages/server/data");
    this.dataDir = dataDir || storageDir || defaultData;
    this.extensionsDir = path.join(this.dataDir, "extensions");
    this.configFile = path.join(this.dataDir, "extensions-config.json");

    this.repositoryUrl = defaultRepoUrl || DEFAULT_REPO_URL;
    this.repositoryManifest = null;
    this.catalog = [];
    this.installed = new Map(); // id -> { metadata, enabled, status, error, packagePath }
    this.runners = new Map(); // id -> SandboxedExtensionRunner
    this.isLoaded = false;
  }

  ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  loadConfig() {
    this.ensureDirectories();
    if (fs.existsSync(this.configFile)) {
      try {
        const raw = fs.readFileSync(this.configFile, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.repositoryUrl) {
          this.repositoryUrl = parsed.repositoryUrl;
        }
        if (Array.isArray(parsed.installed)) {
          for (const item of parsed.installed) {
            this.installed.set(item.id, {
              ...item,
              status: "INSTALLED",
              error: null
            });
          }
        }
      } catch (err) {
        diagnosticLogger.warn("repository", "config", `Could not read extensions-config.json: ${err.message}`);
      }
    }
  }

  saveConfig() {
    this.ensureDirectories();
    const configData = {
      repositoryUrl: this.repositoryUrl,
      updatedAt: new Date().toISOString(),
      installed: Array.from(this.installed.values()).map((item) => ({
        id: item.id,
        displayName: item.displayName,
        version: item.version,
        description: item.description,
        contentTypes: item.contentTypes || ["movie", "series"],
        languages: item.languages || ["en"],
        enabled: Boolean(item.enabled),
        packagePath: item.packagePath,
        installedAt: item.installedAt
      }))
    };
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(configData, null, 2), "utf8");
    } catch (err) {
      diagnosticLogger.error("repository", "config", `Failed to save extensions-config.json: ${err.message}`);
    }
  }

  /**
   * Initializes the manager on server startup, reloading installed extensions.
   */
  async start() {
    this.loadConfig();
    diagnosticLogger.info("extension-manager", "startup", `Initializing ExtensionManager (${this.installed.size} saved extensions)`);

    for (const [id, record] of this.installed.entries()) {
      if (record.packagePath && fs.existsSync(record.packagePath)) {
        try {
          const buffer = fs.readFileSync(record.packagePath);
          const unpacked = unpackExtensionPackage(buffer);
          const runner = new SandboxedExtensionRunner(unpacked);
          await runner.initialize();
          this.runners.set(id, runner);
          record.status = "READY";
          record.error = null;
          diagnosticLogger.info("extension-manager", "load", `Restored provider ${record.displayName} (${id}) [enabled: ${record.enabled}]`);
        } catch (err) {
          record.status = "FAILED";
          record.error = err.message;
          record.enabled = false;
          diagnosticLogger.error("extension-manager", "load", `Failed to restore provider ${id}: ${err.message}`);
        }
      }
    }

    this.saveConfig();
    this.isLoaded = true;

    // Connect to repository asynchronously in background
    this.connectRepository(this.repositoryUrl).catch(() => {});
  }

  /**
   * Connects to a Streamix extension repository and loads its plugin catalog.
   */
  async connectRepository(repoUrl = this.repositoryUrl) {
    const targetUrl = repoUrl.trim();
    if (!targetUrl) throw new Error("Repository URL is required");

    diagnosticLogger.info("repository", "connect", `Connecting to repository: ${targetUrl}`);
    const start = performance.now();

    try {
      const res = await fetch(targetUrl, {
        headers: { Accept: "application/json", "User-Agent": "StreamixDesktop/1.0" }
      });
      if (!res.ok) {
        throw new Error(`Repository manifest request returned HTTP ${res.status}`);
      }
      const manifest = await res.json();
      if (!manifest.id || !manifest.name) {
        throw new Error("Invalid repository.json structure (missing id or name)");
      }

      this.repositoryUrl = targetUrl;
      this.repositoryManifest = manifest;

      // Discover plugins.json URL
      let catalogUrl = null;
      if (Array.isArray(manifest.pluginLists) && manifest.pluginLists.length > 0) {
        catalogUrl = resolveUrl(manifest.pluginLists[0], targetUrl);
      } else if (manifest.pluginsUrl) {
        catalogUrl = resolveUrl(manifest.pluginsUrl, targetUrl);
      } else {
        catalogUrl = resolveUrl("plugins.json", targetUrl);
      }

      diagnosticLogger.info("repository", "catalog", `Fetching catalog from: ${catalogUrl}`);
      const catRes = await fetch(catalogUrl, {
        headers: { Accept: "application/json", "User-Agent": "StreamixDesktop/1.0" }
      });
      if (!catRes.ok) {
        throw new Error(`Catalog request returned HTTP ${catRes.status}`);
      }
      const catalogData = await catRes.json();
      const plugins = Array.isArray(catalogData)
        ? catalogData
        : Array.isArray(catalogData.extensions)
        ? catalogData.extensions
        : Array.isArray(catalogData.plugins)
        ? catalogData.plugins
        : [];

      // Normalize catalog entries
      this.catalog = plugins.map((p) => ({
        id: p.id,
        name: p.displayName || p.name || p.id,
        displayName: p.displayName || p.name || p.id,
        version: p.version || "1.0.0",
        description: p.description || "",
        contentTypes: p.contentTypes || ["movie", "series"],
        languages: p.languages || ["en"],
        packageUrl: resolveUrl(p.packageUrl, catalogUrl),
        packageSizeBytes: p.packageSizeBytes || p.sizeBytes || p.size || 0,
        sha256: p.packageSha256 || p.sha256 || null,
        streamixApiVersion: p.streamixApiVersion || "1.0.0"
      }));

      const dur = Math.round(performance.now() - start);
      diagnosticLogger.info("repository", "connected", `Repository '${manifest.name}' connected (${this.catalog.length} providers discovered in ${dur}ms)`);
      this.saveConfig();

      return {
        repository: this.repositoryManifest,
        catalog: this.getCatalog(),
        installed: this.getInstalled()
      };
    } catch (err) {
      diagnosticLogger.error("repository", "connect_failed", `Repository connection failed: ${err.message}`);
      throw err;
    }
  }

  getCatalog() {
    return this.catalog.map((entry) => {
      const installed = this.installed.get(entry.id);
      const isInstalled = Boolean(installed && installed.status !== "FAILED");
      const isFailed = Boolean(installed && installed.status === "FAILED");
      const isEnabled = Boolean(isInstalled && installed?.enabled);
      const hasUpdate = Boolean(isInstalled && installed.version !== entry.version);

      return {
        ...entry,
        isInstalled,
        isFailed,
        isEnabled,
        hasUpdate,
        installedVersion: isInstalled ? (installed?.version || null) : null,
        status: isInstalled ? (installed?.status || "INSTALLED") : (isFailed ? "FAILED" : "AVAILABLE"),
        error: installed?.error || null
      };
    });
  }

  getInstalled() {
    return Array.from(this.installed.values())
      .filter((record) => record.status !== "FAILED")
      .map((record) => {
        const runner = this.runners.get(record.id);
        return {
          ...record,
          isOperational: Boolean(runner?.isInitialized),
          status: record.status || (runner?.isInitialized ? "READY" : "STOPPED")
        };
      });
  }

  /**
   * Installs an extension from the catalog, verifies package integrity, initializes, and auto-enables.
   */
  async installExtension(providerId) {
    const entry = this.catalog.find((c) => c.id === providerId);
    if (!entry) {
      throw new Error(`Provider '${providerId}' not found in active repository catalog`);
    }

    diagnosticLogger.info("extension-manager", "install_start", `Installing ${entry.displayName} (${entry.id})...`);
    const start = performance.now();

    // 1. Download package
    diagnosticLogger.info("extension-manager", "download", `Downloading package from ${entry.packageUrl}...`);
    let buffer;
    if (entry.packageUrl.startsWith("file://")) {
      const parsedPath = new URL(entry.packageUrl).pathname;
      const cleanPath = process.platform === "win32" && parsedPath.startsWith("/") ? parsedPath.slice(1) : parsedPath;
      buffer = fs.readFileSync(cleanPath);
    } else if (path.isAbsolute(entry.packageUrl) || fs.existsSync(entry.packageUrl)) {
      buffer = fs.readFileSync(entry.packageUrl);
    } else {
      const res = await fetch(entry.packageUrl, {
        headers: { "User-Agent": "StreamixDesktop/1.0" }
      });
      if (!res.ok) {
        throw new Error(`Failed to download package: HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    if (!buffer || buffer.length === 0) {
      throw new Error("Downloaded package is empty (0 bytes)");
    }

    // 2. Validate Size
    if (entry.packageSizeBytes && entry.packageSizeBytes > 0 && buffer.length !== entry.packageSizeBytes) {
      const sizeErr = `Package size mismatch: expected ${entry.packageSizeBytes} bytes, got ${buffer.length}`;
      diagnosticLogger.error("extension-manager", "integrity", sizeErr);
      throw new Error(sizeErr);
    }

    // 3. Validate SHA-256 Hash
    if (entry.sha256) {
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (hash.toLowerCase() !== entry.sha256.toLowerCase()) {
        const hashErr = `Package SHA-256 hash mismatch: expected ${entry.sha256}, got ${hash}`;
        diagnosticLogger.error("extension-manager", "integrity", hashErr);
        throw new Error(hashErr);
      }
      diagnosticLogger.info("extension-manager", "integrity", `SHA-256 verified (${hash.substring(0, 16)}...)`);
    }

    // 4. Save package file to disk
    this.ensureDirectories();
    const safeFilename = `${entry.id}-${entry.version}.streamix-ext`;
    const targetFile = path.join(this.extensionsDir, safeFilename);
    fs.writeFileSync(targetFile, buffer);

    // 5. Unpack and Instantiate Runner
    let unpacked;
    let runner;
    try {
      unpacked = unpackExtensionPackage(buffer);
      runner = new SandboxedExtensionRunner(unpacked);
    } catch (unpackErr) {
      if (fs.existsSync(targetFile)) {
        try { fs.unlinkSync(targetFile); } catch {}
      }
      this.installed.delete(entry.id);
      this.runners.delete(entry.id);
      this.saveConfig();
      diagnosticLogger.error("extension-manager", "install_unpack_failed", `Unpack failed: ${unpackErr.message}`);
      throw unpackErr;
    }

    // 6. Initialize & Auto-Enable
    try {
      await runner.initialize();
      this.runners.set(entry.id, runner);

      const record = {
        id: entry.id,
        displayName: entry.displayName,
        version: entry.version,
        description: entry.description,
        contentTypes: entry.contentTypes,
        languages: entry.languages,
        enabled: true, // Automatically enable on successful install!
        packagePath: targetFile,
        installedAt: new Date().toISOString(),
        status: "READY",
        error: null
      };

      this.installed.set(entry.id, record);
      this.saveConfig();

      const dur = Math.round(performance.now() - start);
      diagnosticLogger.info(
        "extension-manager",
        "install_success",
        `Successfully installed and enabled ${entry.displayName} in ${dur}ms`
      );

      return record;
    } catch (initErr) {
      // Clean up package file if initialization failed to avoid leaving broken/corrupted files
      if (fs.existsSync(targetFile)) {
        try { fs.unlinkSync(targetFile); } catch {}
      }
      this.installed.delete(entry.id);
      this.runners.delete(entry.id);
      this.saveConfig();

      diagnosticLogger.error("extension-manager", "install_init_failed", `Initialization failed: ${initErr.message}`);
      throw initErr;
    }
  }

  /**
   * Enables or disables a provider.
   */
  async setEnabled(providerId, enabled) {
    const record = this.installed.get(providerId);
    if (!record) {
      throw new Error(`Provider '${providerId}' is not installed`);
    }

    record.enabled = Boolean(enabled);

    // If enabling and runner is not initialized, try to initialize it
    if (record.enabled) {
      let runner = this.runners.get(providerId);
      if (!runner && record.packagePath && fs.existsSync(record.packagePath)) {
        const buffer = fs.readFileSync(record.packagePath);
        const unpacked = unpackExtensionPackage(buffer);
        runner = new SandboxedExtensionRunner(unpacked);
        await runner.initialize();
        this.runners.set(providerId, runner);
        record.status = "READY";
        record.error = null;
      }
    }

    this.saveConfig();
    diagnosticLogger.info(
      "extension-manager",
      "toggle",
      `Provider ${record.displayName} is now ${record.enabled ? "ENABLED" : "DISABLED"}`
    );
    return record;
  }

  async enableAll() {
    for (const [id, record] of this.installed.entries()) {
      try {
        await this.setEnabled(id, true);
      } catch {
        // Ignored for individual failures
      }
    }
    return this.getInstalled();
  }

  async disableAll() {
    for (const record of this.installed.values()) {
      record.enabled = false;
    }
    this.saveConfig();
    diagnosticLogger.info("extension-manager", "disable_all", "Disabled all installed providers");
    return this.getInstalled();
  }

  /**
   * Safely uninstalls and deletes an extension.
   */
  async uninstallExtension(providerId) {
    const record = this.installed.get(providerId);
    if (!record) return { ok: true, id: providerId };

    const runner = this.runners.get(providerId);
    if (runner) {
      try {
        await runner.dispose();
      } catch (err) {
        diagnosticLogger.warn("extension-manager", "dispose", `Error disposing runner for ${providerId}: ${err.message}`);
      }
      this.runners.delete(providerId);
    }

    if (record.packagePath && fs.existsSync(record.packagePath)) {
      try {
        fs.unlinkSync(record.packagePath);
      } catch (err) {
        diagnosticLogger.error("extension-manager", "uninstall", `Could not delete file ${record.packagePath}: ${err.message}`);
        throw new Error(`Failed to delete extension file on disk: ${err.message}`);
      }
    }

    this.installed.delete(providerId);
    this.saveConfig();

    diagnosticLogger.info("extension-manager", "uninstalled", `Uninstalled provider ${record.displayName} (${providerId})`);
    return { ok: true, id: providerId };
  }

  /**
   * Resolves playable streams across all enabled extensions ONLY.
   */
  async resolveSources({ title, year, type = "movie", season = null, episode = null, tmdbId = null, imdbId = null }) {
    diagnosticLogger.info(
      "pipeline",
      "resolve_start",
      `Source extraction requested for '${title}' (${year || "N/A"}) [type: ${type}${
        season != null ? `, S${season}E${episode}` : ""
      }]`
    );

    const enabledEntries = Array.from(this.installed.values()).filter((item) => item.enabled);

    if (enabledEntries.length === 0) {
      const noExtMsg = "No enabled extensions installed. Please open Settings -> Extensions to install and enable a provider.";
      diagnosticLogger.warn("pipeline", "no_extensions", noExtMsg);
      throw new Error(noExtMsg);
    }

    diagnosticLogger.info(
      "pipeline",
      "providers_query",
      `Querying ${enabledEntries.length} enabled provider(s): ${enabledEntries.map((e) => e.displayName).join(", ")}`
    );

    const errors = [];
    const allSources = [];
    const allSubtitles = [];
    let winningProvider = null;

    for (const record of enabledEntries) {
      const runner = this.runners.get(record.id);
      if (!runner || !runner.isInitialized) {
        continue;
      }

      const provStart = performance.now();
      diagnosticLogger.info("pipeline", "provider_invoke", `Invoking provider '${record.displayName}' resolveSources...`);

      try {
        // Step 1: Query provider search to get provider's mediaId if needed
        let targetMediaId = imdbId || tmdbId || title;
        let candidateItems = [];

        try {
          candidateItems = await runner.search(title, { timeoutMs: 8000 });
        } catch (searchErr) {
          diagnosticLogger.warn(record.id, "search", `Search for '${title}' failed: ${searchErr.message}`);
        }

        if (candidateItems.length > 0) {
          // Find best title match
          const cleanTitle = title.toLowerCase().trim();
          const match =
            candidateItems.find((i) => i.title.toLowerCase().trim() === cleanTitle) || candidateItems[0];
          if (match && match.id) {
            targetMediaId = match.id;
          }
        }

        // Step 2: Query resolveSources
        const request = {
          mediaId: targetMediaId,
          title,
          year: Number(year) || undefined,
          seasonNumber: season != null ? Number(season) : undefined,
          episodeNumber: episode != null ? Number(episode) : undefined
        };

        const result = await runner.resolveSources(request, 15000);
        const dur = Math.round(performance.now() - provStart);

        if (result && Array.isArray(result.sources) && result.sources.length > 0) {
          diagnosticLogger.info(
            record.id,
            "extraction_success",
            `Provider '${record.displayName}' returned ${result.sources.length} stream(s) in ${dur}ms`
          );

          winningProvider = {
            id: record.id,
            name: record.displayName,
            version: record.version
          };

          for (const s of result.sources) {
            allSources.push({
              ...s,
              providerName: record.displayName,
              providerId: record.id
            });
          }

          if (Array.isArray(result.subtitles)) {
            allSubtitles.push(...result.subtitles);
          }

          // We have found valid sources!
          break;
        } else {
          diagnosticLogger.warn(
            record.id,
            "extraction_empty",
            `Provider '${record.displayName}' completed in ${dur}ms with 0 streams`
          );
        }
      } catch (err) {
        const dur = Math.round(performance.now() - provStart);
        diagnosticLogger.warn(
          record.id,
          "extraction_failed",
          `Provider '${record.displayName}' failed extraction (${dur}ms): ${err.message}`
        );
        errors.push({ provider: record.displayName, error: err.message });
      }
    }

    if (allSources.length === 0) {
      const errDetail = errors.length > 0 ? ` (Errors: ${errors.map((e) => `${e.provider}: ${e.error}`).join("; ")})` : "";
      const failureMsg = `No playable streams found across enabled extensions for '${title}'${errDetail}`;
      diagnosticLogger.error("pipeline", "resolve_failed", failureMsg);
      throw new Error(failureMsg);
    }

    return {
      provider: winningProvider,
      sources: allSources,
      subtitles: allSubtitles
    };
  }
}

export const extensionManager = new ExtensionManager();
