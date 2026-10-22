import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diagnosticLogger, DiagnosticBuffer } from "./diagnostics.js";
import { ExtensionManager } from "./manager.js";
import { isVideoStreamUrl, SDK } from "./sdk.js";
import { unpackExtensionPackage, SandboxedExtensionRunner } from "./runtime.js";
import { extensionsRouter } from "./routes.js";
import { zipSync, strToU8 } from "fflate";

test("DiagnosticBuffer redacts sensitive keys and URLs", () => {
  const buf = new DiagnosticBuffer(10);
  buf.log("info", "network", "fetch", "Fetching https://api.themoviedb.org/3/search/movie?api_key=secret1234567890&query=dune");
  buf.log("warn", "auth", "token", "Token Bearer eyJhbGciOiJIUzI1NiJ9.test leaked in auth header");

  const entries = buf.getLogs();
  assert.equal(entries.length, 2);
  assert.ok(!entries[0].message.includes("secret1234567890"));
  assert.ok(entries[0].message.includes("[REDACTED]"));
  assert.ok(!entries[1].message.includes("eyJhbGciOiJIUzI1NiJ9.test"));
});

test("DiagnosticBuffer handles filtering and clear", () => {
  const buf = new DiagnosticBuffer(5);
  buf.log("info", "repo", "sync", "Repository synced");
  buf.log("error", "provider", "failed", "Extraction failed");

  const errorsOnly = buf.getLogs({ level: "ERROR" });
  assert.equal(errorsOnly.length, 1);
  assert.equal(errorsOnly[0].level, "ERROR");

  buf.clear();
  assert.equal(buf.getLogs().length, 0);
});

test("ExtensionManager manages install, auto-enable, toggle and uninstall", async () => {
  const testDir = path.join(process.cwd(), "scratch-ext-test-" + Date.now());
  const manager = new ExtensionManager({
    storageDir: testDir,
    defaultRepoUrl: "https://example.com/repo.json"
  });

  // Create a minimal fake valid .streamix-ext package
  const manifest = {
    id: "test-provider",
    displayName: "Test Provider",
    version: "1.0.0",
    description: "Mock test provider",
    main: "index.js",
    contentTypes: ["movie"],
    languages: ["en"]
  };
  const scriptContent = `
    exports.search = async function(q) {
      return [{ id: "m1", title: "Test " + q, type: "movie" }];
    };
    exports.resolveSources = async function(req) {
      return {
        sources: [{ url: "https://cdn.example.com/video.mp4", format: "mp4", quality: "1080p" }]
      };
    };
  `;
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "index.js": strToU8(scriptContent)
  });
  const sha256 = crypto.createHash("sha256").update(zipped).digest("hex");

  // Mock catalog
  manager.catalog = [
    {
      id: "test-provider",
      displayName: "Test Provider",
      version: "1.0.0",
      description: "Mock test provider",
      contentTypes: ["movie"],
      languages: ["en"],
      packageUrl: "https://example.com/test-provider.streamix-ext",
      sha256,
      packageSizeBytes: zipped.length
    }
  ];

  // Mock fetch to return our valid package
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === "https://example.com/test-provider.streamix-ext") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => zipped.buffer
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    // 1. Install provider
    const installedRecord = await manager.installExtension("test-provider");
    assert.equal(installedRecord.id, "test-provider");
    // Verify auto-enabled on successful installation
    assert.equal(installedRecord.enabled, true);

    // 2. Resolve sources with enabled extension
    const sourcesResult = await manager.resolveSources({ title: "Avatar", year: 2009 });
    assert.equal(sourcesResult.provider.id, "test-provider");
    assert.equal(sourcesResult.sources.length, 1);
    assert.equal(sourcesResult.sources[0].url, "https://cdn.example.com/video.mp4");

    // 3. Disable provider toggle
    await manager.setEnabled("test-provider", false);
    assert.equal(manager.installed.get("test-provider").enabled, false);

    // 4. Invocation when disabled must fail (not invoked)
    await assert.rejects(
      () => manager.resolveSources({ title: "Avatar", year: 2009 }),
      /No enabled extensions installed/
    );

    // 5. Re-enable
    await manager.setEnabled("test-provider", true);
    assert.equal(manager.installed.get("test-provider").enabled, true);

    // 6. Disable All & Enable All
    await manager.disableAll();
    assert.equal(manager.installed.get("test-provider").enabled, false);

    await manager.enableAll();
    assert.equal(manager.installed.get("test-provider").enabled, true);

    // 7. Uninstall
    await manager.uninstallExtension("test-provider");
    assert.equal(manager.installed.has("test-provider"), false);

    // 8. Safe repeated uninstall
    const repeatResult = await manager.uninstallExtension("test-provider");
    assert.equal(repeatResult.ok, true);
  } finally {
    global.fetch = originalFetch;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
});

test("isVideoStreamUrl correctly identifies video streams vs web pages", () => {
  assert.equal(isVideoStreamUrl("https://example.com/stream.m3u8"), true);
  assert.equal(isVideoStreamUrl("https://example.com/video.mp4?token=abc"), true);
  assert.equal(isVideoStreamUrl("https://example.com/movie.mkv"), true);
  assert.equal(isVideoStreamUrl("https://example.com/clip.webm"), true);
  assert.equal(isVideoStreamUrl("https://pixeldrain.com/api/file/abc12345?download"), true);

  assert.equal(isVideoStreamUrl("https://example.com/watch.html"), false);
  assert.equal(isVideoStreamUrl("https://example.com/embed/player.php?id=123"), false);
  assert.equal(isVideoStreamUrl("https://example.com/video/stream-page"), false);
  assert.equal(isVideoStreamUrl(""), false);
  assert.equal(isVideoStreamUrl(null), false);
  assert.equal(isVideoStreamUrl(undefined), false);

  assert.equal(typeof SDK.isVideoStreamUrl, "function");
});

test("Extension installation fails cleanly on size mismatch and does not leave broken state", async () => {
  const testDir = path.join(process.cwd(), "scratch-fail-test-" + Date.now());
  const manager = new ExtensionManager({
    storageDir: testDir,
    defaultRepoUrl: "https://example.com/repo.json"
  });

  const dummyBytes = Buffer.from("dummy-content");
  manager.catalog = [
    {
      id: "bad-size-provider",
      displayName: "Bad Size Provider",
      version: "1.0.0",
      packageUrl: "https://example.com/pkg.streamix-ext",
      packageSizeBytes: 999999
    }
  ];

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => dummyBytes.buffer
  });

  try {
    await assert.rejects(
      () => manager.installExtension("bad-size-provider"),
      /Package size mismatch/
    );

    assert.equal(manager.installed.has("bad-size-provider"), false);
    const cat = manager.getCatalog();
    const entry = cat.find((c) => c.id === "bad-size-provider");
    assert.equal(entry.isInstalled, false);
    assert.equal(manager.getInstalled().length, 0);
  } finally {
    global.fetch = originalFetch;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
});

test("Extension installation fails cleanly on runtime init error and cleans up disk file", async () => {
  const testDir = path.join(process.cwd(), "scratch-init-fail-" + Date.now());
  const manager = new ExtensionManager({
    storageDir: testDir,
    defaultRepoUrl: "https://example.com/repo.json"
  });

  const manifest = {
    id: "broken-provider",
    displayName: "Broken Provider",
    version: "1.0.0",
    main: "index.js"
  };
  // Script with missing resolveSources method
  const scriptContent = `exports.search = async function() { return []; };`;
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "index.js": strToU8(scriptContent)
  });

  manager.catalog = [
    {
      id: "broken-provider",
      displayName: "Broken Provider",
      version: "1.0.0",
      packageUrl: "https://example.com/broken.streamix-ext",
      packageSizeBytes: zipped.length
    }
  ];

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => zipped.buffer
  });

  try {
    await assert.rejects(
      () => manager.installExtension("broken-provider"),
      /Provider does not implement required interface|does not export a recognized extension factory/
    );

    assert.equal(manager.installed.has("broken-provider"), false);
    const cat = manager.getCatalog();
    const entry = cat.find((c) => c.id === "broken-provider");
    assert.equal(entry.isInstalled, false);
    assert.equal(manager.getInstalled().length, 0);

    // Verify file was cleaned up from disk
    const targetFile = path.join(manager.extensionsDir, "broken-provider-1.0.0.streamix-ext");
    assert.equal(fs.existsSync(targetFile), false);
  } finally {
    global.fetch = originalFetch;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
});

test("Real streamix-extension-lab packages unpack and run without missing SDK exports", async () => {
  const packagesDir = path.resolve(process.cwd(), "streamix-extension-lab/repository/packages");
  if (!fs.existsSync(packagesDir)) return;

  const files = fs.readdirSync(packagesDir).filter((f) => f.endsWith(".streamix-ext"));
  assert.ok(files.length >= 5, "Expected at least 5 provider packages in repository/packages");

  for (const filename of files) {
    const pkgPath = path.join(packagesDir, filename);
    const buffer = fs.readFileSync(pkgPath);
    const unpacked = unpackExtensionPackage(buffer);
    assert.ok(unpacked.manifest.id, `Manifest in ${filename} must have an id`);

    const runner = new SandboxedExtensionRunner(unpacked);
    await runner.initialize();
    assert.ok(runner.isInitialized, `Runner for ${filename} must initialize`);
    assert.equal(typeof runner.extensionInstance.search, "function");
    assert.equal(typeof runner.extensionInstance.resolveSources, "function");
    await runner.dispose();
  }
});

test("extensionsRouter validates and handles both providerId and id payloads", async () => {
  const router = extensionsRouter();
  const routes = router.stack.filter((layer) => layer.route);
  const installLayer = routes.find((l) => l.route.path === "/extensions/install" && l.route.methods.post);
  const uninstallLayer = routes.find((l) => l.route.path === "/extensions/uninstall" && l.route.methods.post);
  const toggleLayer = routes.find((l) => l.route.path === "/extensions/toggle" && l.route.methods.post);

  assert.ok(installLayer, "Install route should exist");
  assert.ok(uninstallLayer, "Uninstall route should exist");
  assert.ok(toggleLayer, "Toggle route should exist");

  let resStatus = null;
  let resJson = null;
  const mockRes = {
    status(s) { resStatus = s; return this; },
    json(j) { resJson = j; return this; }
  };

  // Rejection when neither providerId nor id provided
  await installLayer.route.stack[0].handle({ body: {} }, mockRes);
  assert.equal(resStatus, 400);
  assert.equal(resJson.error, "validation_error");

  await uninstallLayer.route.stack[0].handle({ body: {} }, mockRes);
  assert.equal(resStatus, 400);
  assert.equal(resJson.error, "validation_error");

  await toggleLayer.route.stack[0].handle({ body: {} }, mockRes);
  assert.equal(resStatus, 400);
  assert.equal(resJson.error, "validation_error");
});

