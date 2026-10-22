import nodePath from "node:path";
import { unzipSync } from "fflate";
import { transform } from "sucrase";
import { diagnosticLogger } from "./diagnostics.js";
import {
  ExtensionError,
  ItemNotFoundError,
  SourceUnavailableError,
  ExtensionTimeoutError
} from "./errors.js";

export {
  ExtensionError,
  ItemNotFoundError,
  SourceUnavailableError,
  ExtensionTimeoutError
};

import { SDK } from "./sdk.js";

/**
 * Unpacks a .streamix-ext ZIP package buffer into manifest and files map.
 */
export function unpackExtensionPackage(arrayBufferOrBuffer) {
  const uint8 = Buffer.isBuffer(arrayBufferOrBuffer)
    ? new Uint8Array(arrayBufferOrBuffer.buffer, arrayBufferOrBuffer.byteOffset, arrayBufferOrBuffer.byteLength)
    : new Uint8Array(arrayBufferOrBuffer);

  let unzipped;
  try {
    unzipped = unzipSync(uint8);
  } catch (err) {
    throw new ExtensionError(`Corrupt extension archive: ${err.message}`, "INVALID_ARCHIVE");
  }

  const files = new Map();
  const decoder = new TextDecoder("utf-8");

  for (const [rawPath, contentBytes] of Object.entries(unzipped)) {
    const normalized = rawPath.replace(/\\/g, "/");
    files.set(normalized, decoder.decode(contentBytes));
  }

  const manifestStr = files.get("manifest.json") || files.get("/manifest.json");
  if (!manifestStr) {
    throw new ExtensionError("Package is missing required manifest.json", "MISSING_MANIFEST");
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestStr);
  } catch (err) {
    throw new ExtensionError(`Invalid manifest.json JSON: ${err.message}`, "INVALID_MANIFEST");
  }

  if (!manifest.id || !manifest.displayName || !manifest.version) {
    throw new ExtensionError("manifest.json must contain id, displayName, and version", "INVALID_MANIFEST_FIELDS");
  }

  return { manifest, files };
}

/**
 * Sandboxed Extension Runner for Server-Side Provider Execution
 */
export class SandboxedExtensionRunner {
  constructor(unpacked, { loggerOptions = {}, storageAdapter = null } = {}) {
    this.manifest = unpacked.manifest;
    this.files = unpacked.files;
    this.loggerOptions = loggerOptions;
    this.storageAdapter = storageAdapter || new Map();
    this.extensionInstance = null;
    this.moduleCache = new Map();
    this.isInitialized = false;
  }

  requireModule(path) {
    if (this.moduleCache.has(path)) {
      return this.moduleCache.get(path);
    }

    if (path.includes("sdk") || path === "@streamix/sdk" || path.endsWith("types.ts")) {
      return SDK;
    }

    let normalizedPath = path.replace(/^\.\//, "").replace(/\\/g, "/");
    if (!normalizedPath.startsWith("src/") && this.files.has(`src/${normalizedPath}`)) {
      normalizedPath = `src/${normalizedPath}`;
    }

    let fileContent = this.files.get(normalizedPath);
    if (!fileContent && !normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".js")) {
      fileContent = this.files.get(`${normalizedPath}.ts`) || this.files.get(`${normalizedPath}.js`);
      if (fileContent) {
        normalizedPath = this.files.has(`${normalizedPath}.ts`) ? `${normalizedPath}.ts` : `${normalizedPath}.js`;
      }
    }

    if (!fileContent) {
      throw new ExtensionError(
        `Cannot find module '${path}' in extension package. Available: ${Array.from(this.files.keys()).join(", ")}`,
        "MODULE_NOT_FOUND",
        this.manifest.id
      );
    }

    let transformedJs = fileContent;
    if (normalizedPath.endsWith(".ts")) {
      try {
        const result = transform(fileContent, {
          transforms: ["typescript", "imports"]
        });
        transformedJs = result.code;
      } catch (err) {
        throw new ExtensionError(
          `Failed to transpile TypeScript in '${normalizedPath}': ${err.message}`,
          "TRANSPILE_ERROR",
          this.manifest.id
        );
      }
    }

    const moduleExports = {};
    const moduleObj = { exports: moduleExports };

    const sandboxedRequire = (subpath) => {
      if (subpath.includes("sdk") || subpath === "@streamix/sdk" || subpath.endsWith("types.ts")) {
        return SDK;
      }
      const currentDir = normalizedPath.includes("/")
        ? normalizedPath.substring(0, normalizedPath.lastIndexOf("/"))
        : "";
      let resolvedTarget = subpath;
      if (subpath.startsWith(".")) {
        resolvedTarget = nodePath.posix.normalize(currentDir ? `${currentDir}/${subpath}` : subpath);
      }
      return this.requireModule(resolvedTarget);
    };

    const sandboxedConsole = {
      log: (...args) => diagnosticLogger.debug(this.manifest.id, "runner", args.map(String).join(" ")),
      info: (...args) => diagnosticLogger.info(this.manifest.id, "runner", args.map(String).join(" ")),
      warn: (...args) => diagnosticLogger.warn(this.manifest.id, "runner", args.map(String).join(" ")),
      error: (...args) => diagnosticLogger.error(this.manifest.id, "runner", args.map(String).join(" ")),
      debug: (...args) => diagnosticLogger.debug(this.manifest.id, "runner", args.map(String).join(" "))
    };

    try {
      const runnerFn = new Function(
        "exports",
        "require",
        "module",
        "console",
        "setTimeout",
        "clearTimeout",
        "fetch",
        "Buffer",
        `"use strict";\n${transformedJs}`
      );

      runnerFn(
        moduleExports,
        sandboxedRequire,
        moduleObj,
        sandboxedConsole,
        setTimeout,
        clearTimeout,
        fetch,
        Buffer
      );
    } catch (err) {
      throw new ExtensionError(
        `Runtime evaluation error in '${normalizedPath}': ${err.message}`,
        "EVAL_ERROR",
        this.manifest.id
      );
    }

    const finalExports = moduleObj.exports || moduleExports;
    this.moduleCache.set(path, finalExports);
    return finalExports;
  }

  async initialize(timeoutMs = 10000) {
    const entrypoint = this.manifest.entrypoint || this.manifest.main || "src/index.ts";
    diagnosticLogger.info("extension", "init", `Loading entrypoint '${entrypoint}' for ${this.manifest.displayName}`);

    const entryExports = this.requireModule(entrypoint);
    let instance;

    if (typeof entryExports.default === "function") {
      instance = entryExports.default();
    } else if (entryExports.SampleProviderExtension) {
      instance = new entryExports.SampleProviderExtension();
    } else if (entryExports.CineStreamExtension) {
      instance = new entryExports.CineStreamExtension();
    } else if (entryExports.BollyflixExtension) {
      instance = new entryExports.BollyflixExtension();
    } else if (entryExports.VegaMoviesExtension) {
      instance = new entryExports.VegaMoviesExtension();
    } else if (entryExports.MoviesDriveExtension) {
      instance = new entryExports.MoviesDriveExtension();
    } else if (entryExports.MoviesmodExtension) {
      instance = new entryExports.MoviesmodExtension();
    } else if (entryExports.default && typeof entryExports.default === "object") {
      instance = entryExports.default;
    } else if (typeof entryExports === "object" && (entryExports.search || entryExports.resolveSources)) {
      instance = entryExports;
    } else {
      throw new ExtensionError(
        `Entrypoint '${entrypoint}' does not export a recognized extension factory or class`,
        "INVALID_ENTRYPOINT",
        this.manifest.id
      );
    }

    if (typeof instance.initialize !== "function") {
      instance.initialize = async () => {};
    }

    if (
      typeof instance.search !== "function" ||
      typeof instance.resolveSources !== "function"
    ) {
      throw new ExtensionError(
        "Provider does not implement required interface (search, resolveSources)",
        "MISSING_REQUIRED_METHODS",
        this.manifest.id
      );
    }

    this.extensionInstance = instance;

    const context = {
      manifest: this.manifest,
      logger: {
        info: (msg, ...args) => diagnosticLogger.info(this.manifest.id, "extension", msg, args.length ? args : null),
        warn: (msg, ...args) => diagnosticLogger.warn(this.manifest.id, "extension", msg, args.length ? args : null),
        error: (msg, ...args) => diagnosticLogger.error(this.manifest.id, "extension", msg, args.length ? args : null),
        debug: (msg, ...args) => diagnosticLogger.debug(this.manifest.id, "extension", msg, args.length ? args : null)
      },
      storage: {
        get: async (key) => this.storageAdapter.get(`${this.manifest.id}:${key}`) ?? null,
        set: async (key, val) => this.storageAdapter.set(`${this.manifest.id}:${key}`, val),
        delete: async (key) => this.storageAdapter.delete(`${this.manifest.id}:${key}`)
      },
      fetch: async (url, options = {}) => {
        const start = performance.now();
        try {
          const res = await fetch(url, options);
          const dur = Math.round(performance.now() - start);
          diagnosticLogger.debug(this.manifest.id, "http", `HTTP ${res.status} ${url.substring(0, 80)} (${dur}ms)`);
          return res;
        } catch (err) {
          const dur = Math.round(performance.now() - start);
          diagnosticLogger.warn(this.manifest.id, "http", `HTTP fetch error for ${url.substring(0, 80)}: ${err.message} (${dur}ms)`);
          throw err;
        }
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await Promise.race([
        this.extensionInstance.initialize(context),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ExtensionTimeoutError("initialize", timeoutMs, this.manifest.id))
          );
        })
      ]);
      this.isInitialized = true;
      diagnosticLogger.info("extension", "init", `Successfully initialized ${this.manifest.displayName} (${this.manifest.id})`);
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query, options = {}) {
    if (!this.extensionInstance || !this.isInitialized) {
      throw new ExtensionError("Provider is not initialized", "NOT_INITIALIZED", this.manifest.id);
    }
    const timeoutMs = options.timeoutMs || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const results = await Promise.race([
        this.extensionInstance.search(query, { signal: controller.signal }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ExtensionTimeoutError("search", timeoutMs, this.manifest.id))
          );
        })
      ]);
      return results || [];
    } finally {
      clearTimeout(timer);
    }
  }

  async getDetails(id, options = {}) {
    if (!this.extensionInstance || !this.isInitialized) {
      throw new ExtensionError("Provider is not initialized", "NOT_INITIALIZED", this.manifest.id);
    }
    if (typeof this.extensionInstance.getDetails !== "function") {
      return null;
    }
    const timeoutMs = options.timeoutMs || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await Promise.race([
        this.extensionInstance.getDetails(id, { signal: controller.signal }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ExtensionTimeoutError("getDetails", timeoutMs, this.manifest.id))
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async getEpisodes(id, seasonNumber, options = {}) {
    if (!this.extensionInstance || !this.isInitialized) {
      throw new ExtensionError("Provider is not initialized", "NOT_INITIALIZED", this.manifest.id);
    }
    if (typeof this.extensionInstance.getEpisodes !== "function") {
      return null;
    }
    const timeoutMs = options.timeoutMs || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await Promise.race([
        this.extensionInstance.getEpisodes(id, seasonNumber, { signal: controller.signal }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ExtensionTimeoutError("getEpisodes", timeoutMs, this.manifest.id))
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async resolveSources(request, timeoutMs = 25000) {
    if (!this.extensionInstance || !this.isInitialized) {
      throw new ExtensionError("Provider is not initialized", "NOT_INITIALIZED", this.manifest.id);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        this.extensionInstance.resolveSources({
          ...request,
          signal: controller.signal
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ExtensionTimeoutError("resolveSources", timeoutMs, this.manifest.id))
          );
        })
      ]);
      return result || { sources: [], subtitles: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  async dispose() {
    if (this.extensionInstance && typeof this.extensionInstance.dispose === "function") {
      try {
        await this.extensionInstance.dispose();
      } catch {
        // Ignored
      }
    }
    this.moduleCache.clear();
    this.extensionInstance = null;
    this.isInitialized = false;
  }
}
