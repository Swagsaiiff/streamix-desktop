const { contextBridge, ipcRenderer } = require("electron");

// Secure, minimal bridge adhering to Phase 2B and Phase 3 requirements.
// No raw Node.js APIs, fs, child_process, or unrestricted IPC are exposed.
contextBridge.exposeInMainWorld("streamixDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: "0.1.0",
  apiUrl: process.env.STREAMIX_API_URL || "http://localhost:4000",
  mpv: {
    start: (sourceUrl, options) => ipcRenderer.invoke("mpv:start", sourceUrl, options),
    stop: () => ipcRenderer.invoke("mpv:stop"),
    play: () => ipcRenderer.invoke("mpv:play"),
    pause: () => ipcRenderer.invoke("mpv:pause"),
    seek: (seconds, mode) => ipcRenderer.invoke("mpv:seek", seconds, mode),
    setVolume: (volume) => ipcRenderer.invoke("mpv:set-volume", volume),
    setMute: (muted) => ipcRenderer.invoke("mpv:set-mute", muted),
    setSpeed: (speed) => ipcRenderer.invoke("mpv:set-speed", speed),
    setAudioTrack: (aid) => ipcRenderer.invoke("mpv:set-audio-track", aid),
    setSubtitleTrack: (sid) => ipcRenderer.invoke("mpv:set-subtitle-track", sid),
    setBounds: (bounds) => ipcRenderer.invoke("mpv:set-bounds", bounds),
    onEvent: (callback) => {
      if (typeof callback !== "function") return () => {};
      const subscription = (_event, { type, data }) => {
        try {
          callback(type, data);
        } catch (err) {
          console.error("[Preload] Error in mpv event callback:", err);
        }
      };
      ipcRenderer.on("mpv:event", subscription);
      return () => {
        ipcRenderer.removeListener("mpv:event", subscription);
      };
    }
  }
});
