import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

const clientDistSrc = path.resolve(repoRoot, "packages/client/dist");
const clientDistDest = path.resolve(desktopRoot, "client-dist");

const serverSrc = path.resolve(repoRoot, "packages/server/src");
const serverPkgSrc = path.resolve(repoRoot, "packages/server/package.json");
const serverDest = path.resolve(desktopRoot, "server");
const serverSrcDest = path.resolve(serverDest, "src");

console.log("[prepare-package] Preparing assets for Electron packaging...");

// 1. Verify client dist exists
if (!fs.existsSync(clientDistSrc)) {
  console.error(`[prepare-package] Client dist not found at ${clientDistSrc}. Please run 'npm run build' first.`);
  process.exit(1);
}

// 2. Copy client dist
fs.rmSync(clientDistDest, { recursive: true, force: true });
fs.cpSync(clientDistSrc, clientDistDest, { recursive: true });
console.log(`[prepare-package] Copied client dist -> ${clientDistDest}`);

// 3. Copy server files
fs.rmSync(serverDest, { recursive: true, force: true });
fs.mkdirSync(serverSrcDest, { recursive: true });
fs.cpSync(serverSrc, serverSrcDest, { recursive: true });
fs.copyFileSync(serverPkgSrc, path.join(serverDest, "package.json"));
console.log(`[prepare-package] Copied server files -> ${serverDest}`);

// 4. Verify native MPV binaries exist in bin/mpv
const mpvBinDir = path.resolve(desktopRoot, "bin/mpv");
const mpvExe = path.join(mpvBinDir, "mpv.exe");
if (!fs.existsSync(mpvExe)) {
  console.warn(`[prepare-package] Warning: MPV executable not found at ${mpvExe}`);
} else {
  console.log(`[prepare-package] Verified native MPV binary present at ${mpvExe}`);
}

console.log("[prepare-package] Packaging preparation complete!");
