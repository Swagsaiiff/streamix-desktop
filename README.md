# STREAMIX Desktop

STREAMIX is a responsive, modern desktop streaming application for Windows that brings movie and series exploration, catalog discovery, and native video playback into a desktop experience.

Powered by:
- **Desktop Shell:** Electron 44 (secure sandbox, context isolation, zero node integration in renderer)
- **Frontend UI:** React 19 + Vite 8 Netflix-style user interface
- **Local Backend:** Node.js + Express 5 running locally on the user's PC (`http://localhost:4000`)
- **Native Playback:** Portable 64-bit MPV (`mpv.exe`) integration controlled via Windows Named Pipe IPC
- **Audio & Subtitle Control:** Real-time multi-audio track discovery, selection, and switching

---

## Windows Installation & Running

### 1. Download the Installer
Download the latest Windows installer:
- **File:** `STREAMIX Setup 1.0.0.exe` (~123 MB)
- **Architecture:** Windows 10/11 64-bit (x64)

### 2. Run the Installer
1. Double-click `STREAMIX Setup 1.0.0.exe`.
2. Follow the NSIS setup wizard prompts to select an installation location and create desktop/Start Menu shortcuts.
3. Finish the installation and launch **STREAMIX**.

> [!NOTE]
> **Code Signing Notice:**
> Open-source release builds of STREAMIX are currently distributed without an expensive commercial EV Code Signing Certificate. If Windows SmartScreen or Windows Defender displays "Windows protected your PC", click **More info** and select **Run anyway**.

### 3. First-Launch Behavior
- When STREAMIX launches, it automatically checks for and initializes its local background service.
- The React application UI loads immediately from the bundled local production assets (`client-dist`) without requiring any developer tooling or Vite servers.
- The home page automatically fetches catalog data from configured providers (such as CineStream).
- All runtime caches and temporary sessions are written to the user's local application data directory (`%APPDATA%/streamix-desktop`).

---

## Native Playback & Multi-Audio Switching

STREAMIX Desktop features a native MPV media pipeline:
- **Direct IPC Control:** Electron communicates with MPV over Windows Named Pipes (`\\.\pipe\streamix-mpv-*`).
- **Comprehensive Controls:** Play, pause, absolute and relative seeking, volume adjustment (0–100%), mute toggle, playback speed control (0.5x–2.0x).
- **Multi-Audio Track Switching:** MPV probes the media streams, reports all available audio tracks with language codes (`en`, `es`, `hi`, etc.) and titles, and dynamically switches audio tracks mid-playback without reloading the video.
- **Subtitles:** Subtitle track enumeration and selection.
- **Clean Exit:** Closing the window or application cleanly terminates the MPV process and shuts down managed backend services without leaving orphaned processes.

---

## Building from Source

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x
- Windows 10 or 11 (64-bit)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Swagsaiiff/streamix-desktop.git
cd streamix-desktop
npm install
```

### 2. Development Workflows
- **Desktop Development (Electron + Local Backend + Vite Client):**
  ```bash
  npm run dev:electron
  ```
- **Web-Only Development (Browser):**
  ```bash
  npm run dev
  ```
  Opens client at `http://localhost:5173` with API backend at `http://localhost:4000`.
- **Backend Only:**
  ```bash
  npm run dev:server
  ```
- **Client Only:**
  ```bash
  npm run dev:client
  ```

### 3. Testing & Verification
- **Run Complete Test Suite (131 tests):**
  ```bash
  npm run test
  ```
- **Run Native MPV IPC Spike Test:**
  ```bash
  node packages/desktop/src/spike-mpv.js
  ```
- **Run Electron UI Automated Verification:**
  ```bash
  npx electron packages/desktop --test-verification
  ```

### 4. Build the Windows Installer
```bash
npm run package:desktop
```
This script:
1. Compiles the React frontend production bundle via Vite (`packages/client/dist`).
2. Synchronizes frontend assets and server scripts into `packages/desktop`.
3. Packages the Electron shell, bundled assets, and native MPV binaries using `electron-builder`.
4. Generates the NSIS installer at `packages/desktop/dist/STREAMIX Setup 1.0.0.exe`.

---

---

## TMDB Catalog & Configuration

STREAMIX uses the **TMDB (The Movie Database) API** as the authoritative source for the homepage catalog (trending movies, popular movies, new releases, top-rated movies, genre categories, popular series, action series, and anime sections) and title metadata.

### Obtaining a TMDB API Key
1. Create a free account at [themoviedb.org](https://www.themoviedb.org/).
2. Navigate to **Settings > API** ([themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)) and generate a v3 API Key.

### Configuring the API Key

- **Development:**
  Add your API key to `.env` in the repository root:
  ```env
  TMDB_API_KEY=your_tmdb_api_key_here
  ```
- **Packaged Desktop Application:**
  Create or edit `config.json` in your local user data directory (`%APPDATA%\streamix-desktop\config.json`):
  ```json
  {
    "tmdbApiKey": "your_tmdb_api_key_here"
  }
  ```
  Alternatively, place a `.env` file containing `TMDB_API_KEY=your_tmdb_api_key_here` inside `%APPDATA%\streamix-desktop\`.

### TMDB Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## Providers & Upstream Resolution

- **TMDB:** Primary homepage catalog source and authoritative movie/series metadata provider.
- **VegaMovies:** Media extraction provider for resolving real video streams and multi-quality variants. Playback requests for TMDB-cataloged titles bridge metadata (title, year, season, episode) to VegaMovies's title-based resolution.
- **CineStream:** Available in the provider registry for compatibility and legacy catalog lookups.

---

## Open Source Licensing

STREAMIX is released under the **ISC License**. See [LICENSE](LICENSE) for details.

This distribution includes and redistributes third-party open-source components:
- **MPV:** GNU General Public License v2+ / Lesser General Public License v2.1+ (https://mpv.io)
- **Electron:** MIT License (https://electronjs.org)
- **React:** MIT License (https://react.dev)
- **Express:** MIT License (https://expressjs.com)
- **FFmpeg:** LGPL v2.1+ / GPL v2+ (https://ffmpeg.org)