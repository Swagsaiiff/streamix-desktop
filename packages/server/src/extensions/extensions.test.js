import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diagnosticLogger, DiagnosticBuffer } from "./diagnostics.js";
import { ExtensionManager } from "./manager.js";
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
  } finally {
    global.fetch = originalFetch;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
});
