const { contextBridge } = require("electron");

// Secure, minimal bridge adhering to Phase 2B requirements.
// No Node.js APIs or privileged capabilities are exposed.
contextBridge.exposeInMainWorld("streamixDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: "0.1.0"
});
