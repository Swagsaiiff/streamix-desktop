import { Router } from "express";
import { extensionManager } from "./manager.js";
import { diagnosticLogger } from "./diagnostics.js";

export function extensionsRouter() {
  const router = Router();

  // 1. Repository Management
  router.get("/extensions/repository", async (_req, res) => {
    try {
      res.json({
        ok: true,
        repositoryUrl: extensionManager.repositoryUrl,
        repository: extensionManager.repositoryManifest,
        catalogCount: extensionManager.catalog.length,
        installedCount: extensionManager.installed.size
      });
    } catch (err) {
      res.status(500).json({ error: "repository_error", message: err.message });
    }
  });

  router.post("/extensions/repository", async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "validation_error", message: "Repository URL is required" });
    }
    try {
      const data = await extensionManager.connectRepository(url);
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(400).json({ error: "repository_error", message: err.message });
    }
  });

  router.post("/extensions/repository/refresh", async (_req, res) => {
    try {
      const data = await extensionManager.connectRepository(extensionManager.repositoryUrl);
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ error: "repository_error", message: err.message });
    }
  });

  router.delete("/extensions/repository", async (_req, res) => {
    try {
      extensionManager.repositoryUrl = null;
      extensionManager.repositoryManifest = null;
      extensionManager.catalog = [];
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "repository_error", message: err.message });
    }
  });

  // 2. Catalog & Installed Providers
  router.get("/extensions/catalog", async (_req, res) => {
    try {
      res.json({
        ok: true,
        catalog: extensionManager.getCatalog(),
        installed: extensionManager.getInstalled()
      });
    } catch (err) {
      res.status(500).json({ error: "catalog_error", message: err.message });
    }
  });

  router.get("/extensions/installed", async (_req, res) => {
    try {
      res.json({
        ok: true,
        installed: extensionManager.getInstalled()
      });
    } catch (err) {
      res.status(500).json({ error: "installed_error", message: err.message });
    }
  });

  // 3. Install & Uninstall
  router.post("/extensions/install", async (req, res) => {
    const providerId = req.body?.providerId || req.body?.id;
    if (!providerId) {
      return res.status(400).json({ error: "validation_error", message: "providerId is required" });
    }
    try {
      const record = await extensionManager.installExtension(providerId);
      res.json({ ok: true, installed: record });
    } catch (err) {
      res.status(500).json({ error: "install_error", message: err.message });
    }
  });

  router.post("/extensions/uninstall", async (req, res) => {
    const providerId = req.body?.providerId || req.body?.id;
    if (!providerId) {
      return res.status(400).json({ error: "validation_error", message: "providerId is required" });
    }
    try {
      await extensionManager.uninstallExtension(providerId);
      res.json({ ok: true, providerId });
    } catch (err) {
      res.status(500).json({ error: "uninstall_error", message: err.message });
    }
  });

  // 4. Enable / Disable Toggles
  router.post("/extensions/toggle", async (req, res) => {
    const providerId = req.body?.providerId || req.body?.id;
    const { enabled } = req.body || {};
    if (!providerId) {
      return res.status(400).json({ error: "validation_error", message: "providerId is required" });
    }
    try {
      const updated = await extensionManager.setEnabled(providerId, enabled);
      res.json({ ok: true, provider: updated });
    } catch (err) {
      res.status(400).json({ error: "toggle_error", message: err.message });
    }
  });

  router.post("/extensions/toggle-all", async (req, res) => {
    const { enabled } = req.body || {};
    try {
      const list = enabled ? await extensionManager.enableAll() : await extensionManager.disableAll();
      res.json({ ok: true, installed: list });
    } catch (err) {
      res.status(500).json({ error: "toggle_all_error", message: err.message });
    }
  });

  // 5. Live Diagnostics Logs
  router.get("/extensions/logs", async (req, res) => {
    try {
      const { level, component, search, sinceId, limit } = req.query;
      const logs = diagnosticLogger.getLogs({
        level: level ? String(level) : null,
        component: component ? String(component) : null,
        search: search ? String(search) : null,
        sinceId: sinceId ? Number(sinceId) : 0,
        limit: limit ? Number(limit) : 200
      });
      res.json({ ok: true, count: logs.length, logs });
    } catch (err) {
      res.status(500).json({ error: "logs_error", message: err.message });
    }
  });

  router.post("/extensions/logs", async (req, res) => {
    const { level = "INFO", component = "client", stage = "player", message, meta } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "validation_error", message: "Log message is required" });
    }
    const entry = diagnosticLogger.log(level, component, stage, message, meta);
    res.json({ ok: true, entry });
  });

  router.post("/extensions/logs/clear", async (_req, res) => {
    diagnosticLogger.clear();
    res.json({ ok: true });
  });

  return router;
}
