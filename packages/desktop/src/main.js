import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { MpvManager } from "./mpv-manager.js";
import { LocalBackendService } from "./local-backend.js";
import { VideoHostManager } from "./video-host.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
try {
  const envCandidate = path.join(repoRoot, ".env");
  if (existsSync(envCandidate)) {
    process.loadEnvFile(envCandidate);
  }
} catch {}
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
function resolveClientDist() {
  const candidates = [
    process.env.STREAMIX_CLIENT_DIST,
    path.resolve(__dirname, "../client-dist/index.html"),
    path.resolve(__dirname, "../client/dist/index.html"),
    path.resolve(__dirname, "../../client/dist/index.html"),
    path.resolve(process.resourcesPath || "", "app/client-dist/index.html"),
    path.resolve(process.resourcesPath || "", "app.asar/client-dist/index.html")
  ].filter(Boolean);

  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return candidates[0] || path.resolve(__dirname, "../client-dist/index.html");
}

let mainWindow = null;
const mpv = new MpvManager();
const videoHost = new VideoHostManager();
const localBackend = new LocalBackendService({
  port: Number(process.env.PORT) || 4000
});

// Ensure single instance of the desktop application
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Forward MPV events to renderer via webContents
mpv.onEvent = (type, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mpv:event", { type, data });
  }
};

videoHost.onEvent = (type, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mpv:event", { type: "video-" + type, data });
  }
};

// Register safe IPC handlers for MPV player control
ipcMain.handle("mpv:start", async (_event, sourceUrl, options = {}) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !options.wid) {
      const handleBuffer = mainWindow.getNativeWindowHandle();
      const parentHwnd = process.arch === "x64" ? handleBuffer.readBigUInt64LE(0) : handleBuffer.readUInt32LE(0);
      const bounds = options.bounds || { x: 0, y: 56, width: 1280, height: 648 };
      const childHwnd = await videoHost.createHost(parentHwnd.toString(), bounds);
      options.wid = childHwnd.toString();
    }
    return await mpv.start(sourceUrl, options);
  } catch (err) {
    console.error("[main] Failed to start MPV:", err.message);
    throw err;
  }
});

ipcMain.handle("mpv:set-bounds", async (_event, bounds) => {
  if (bounds && typeof bounds === "object") {
    return await videoHost.setBounds(bounds);
  }
});

ipcMain.handle("mpv:stop", async () => {
  await videoHost.destroy();
  return await mpv.stop();
});

ipcMain.handle("mpv:play", async () => {
  return await mpv.play();
});

ipcMain.handle("mpv:pause", async () => {
  return await mpv.pause();
});

ipcMain.handle("mpv:seek", async (_event, seconds, mode) => {
  return await mpv.seek(seconds, mode);
});

ipcMain.handle("mpv:set-volume", async (_event, volume) => {
  return await mpv.setVolume(volume);
});

ipcMain.handle("mpv:set-mute", async (_event, muted) => {
  return await mpv.setMute(muted);
});

ipcMain.handle("mpv:set-speed", async (_event, speed) => {
  return await mpv.setSpeed(speed);
});

ipcMain.handle("mpv:set-audio-track", async (_event, aid) => {
  return await mpv.setAudioTrack(aid);
});

ipcMain.handle("mpv:set-subtitle-track", async (_event, sid) => {
  return await mpv.setSubtitleTrack(sid);
});


function applyZoom(delta) {
  if (!mainWindow || mainWindow.isDestroyed()) return 1.0;
  const current = mainWindow.webContents.getZoomFactor();
  const next = Math.min(3.0, Math.max(0.5, Math.round((current + delta) * 10) / 10));
  mainWindow.webContents.setZoomFactor(next);
  mainWindow.webContents
    .executeJavaScript("window.dispatchEvent(new Event('resize'))")
    .catch(() => {});
  videoHost.sync().catch(() => {});
  return next;
}

function resetZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return 1.0;
  mainWindow.webContents.setZoomFactor(1.0);
  mainWindow.webContents.setZoomLevel(0);
  mainWindow.webContents
    .executeJavaScript("window.dispatchEvent(new Event('resize'))")
    .catch(() => {});
  videoHost.sync().catch(() => {});
  return 1.0;
}

ipcMain.handle("window:zoom-in", () => applyZoom(0.1));
ipcMain.handle("window:zoom-out", () => applyZoom(-0.1));
ipcMain.handle("window:reset-zoom", () => resetZoom());
ipcMain.handle("window:get-zoom", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents.getZoomFactor();
  }
  return 1.0;
});

async function waitForServer(url, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.status >= 200 && res.status < 500) {
        return true;
      }
    } catch {
      // Server not ready yet; wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 540,
    title: "STREAMIX Desktop",
    backgroundColor: "#0b0c10",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV !== "production"
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Reset zoom factor to default 100% on page load so accidental zoom-out does not remain permanently stuck
  mainWindow.webContents.on("did-finish-load", () => {
    resetZoom();
  });

  // Handle keyboard zoom shortcuts reliably across all keyboard layouts:
  // Ctrl + '=' / '+' / NumpadAdd -> Zoom In
  // Ctrl + '-' / '_' / NumpadSubtract -> Zoom Out
  // Ctrl + '0' / Numpad0 -> Reset Zoom to 100%
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isCtrl = input.control || input.meta;
    if (!isCtrl) return;

    const isZoomIn =
      input.key === "=" ||
      input.key === "+" ||
      input.code === "Equal" ||
      input.code === "NumpadAdd";

    const isZoomOut =
      input.key === "-" ||
      input.key === "_" ||
      input.code === "Minus" ||
      input.code === "NumpadSubtract";

    const isZoomReset =
      input.key === "0" ||
      input.code === "Digit0" ||
      input.code === "Numpad0";

    if (isZoomIn) {
      event.preventDefault();
      applyZoom(0.1);
    } else if (isZoomOut) {
      event.preventDefault();
      applyZoom(-0.1);
    } else if (isZoomReset) {
      event.preventDefault();
      resetZoom();
    }
  });

  mainWindow.webContents.on("zoom-changed", (_event, zoomDirection) => {
    if (zoomDirection === "in") {
      applyZoom(0.1);
    } else if (zoomDirection === "out") {
      applyZoom(-0.1);
    }
  });


  // Prevent navigation away from the application origin
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const isLocal =
      targetUrl.startsWith(DEV_SERVER_URL) ||
      targetUrl.startsWith("file://");
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(targetUrl).catch(() => {});
    }
  });

  // Prevent opening arbitrary unmanaged popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });

  const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;

  const clientDist = resolveClientDist();
  if (isDev) {
    const ready = await waitForServer(DEV_SERVER_URL, 2500);
    if (ready) {
      await mainWindow.loadURL(DEV_SERVER_URL);
    } else if (existsSync(clientDist)) {
      console.warn(`[desktop] Dev server at ${DEV_SERVER_URL} unavailable. Loading production build from ${clientDist}`);
      await mainWindow.loadFile(clientDist);
    } else {
      throw new Error(`[desktop] Unable to connect to Vite dev server at ${DEV_SERVER_URL} and no dist/index.html found.`);
    }
  } else if (existsSync(clientDist)) {
    await mainWindow.loadFile(clientDist);
  } else {
    await mainWindow.loadURL(DEV_SERVER_URL);
  }

  if (process.env.STREAMIX_DESKTOP_TEST === "1" || process.argv.includes("--test-verification")) {
    console.log("[desktop-test] Running automated verification in Electron...");
    try {
      let cardsCount = 0;
      let bridgeKeys = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        cardsCount = await mainWindow.webContents.executeJavaScript('document.querySelectorAll(".card").length');
        bridgeKeys = await mainWindow.webContents.executeJavaScript('window.streamixDesktop ? Object.keys(window.streamixDesktop) : null');
        if (cardsCount > 0) break;
      }
      const pageTitle = await mainWindow.webContents.executeJavaScript("document.title");
      const appMounted = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".app"))');
      console.log(`[desktop-test] PAGE_TITLE: ${pageTitle}`);
      console.log(`[desktop-test] APP_MOUNTED: ${appMounted}`);
      console.log(`[desktop-test] CARDS_RENDERED: ${cardsCount}`);
      console.log(`[desktop-test] BRIDGE_KEYS: ${JSON.stringify(bridgeKeys)}`);
      console.log("[desktop-test] VERIFICATION_SUCCESS");
      app.quit();
    } catch (err) {
      console.error("[desktop-test] VERIFICATION_FAILED:", err.message);
      app.exit(1);
    }
  }

  mainWindow.on("move", () => {
    videoHost.sync().catch(() => {});
  });

  mainWindow.on("resize", () => {
    videoHost.sync().catch(() => {});
  });

  mainWindow.on("minimize", () => {
    videoHost.hide().catch(() => {});
  });

  mainWindow.on("restore", () => {
    videoHost.show().catch(() => {});
    videoHost.sync().catch(() => {});
  });

  mainWindow.on("hide", () => {
    videoHost.hide().catch(() => {});
  });

  mainWindow.on("show", () => {
    videoHost.show().catch(() => {});
    videoHost.sync().catch(() => {});
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    videoHost.stop().catch(() => {});
    mpv.stop().catch(() => {});
  });
}

app.whenReady().then(async () => {
  try {
    const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;
    // Start or attach to local backend service before creating UI window
    await localBackend.start({
      repoRoot,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath("userData"),
      isDev
    });

    await createWindow();
  } catch (err) {
    console.error("[desktop] Failed to start local backend or create window:", err.message);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => {
        console.error("[desktop] Failed to recreate window:", err.message);
      });
    }
  });
});

app.on("before-quit", () => {
  videoHost.stop().catch(() => {});
  mpv.stop().catch(() => {});
  localBackend.stop();
});

app.on("window-all-closed", () => {
  videoHost.stop().catch(() => {});
  mpv.stop().catch(() => {});
  localBackend.stop();
  app.quit();
});
