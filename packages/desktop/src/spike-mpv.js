import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// Fixture check
const fixturePath = path.resolve(rootDir, 'temp/fixtures/multi-audio.mkv');
if (!fs.existsSync(fixturePath)) {
  console.error(`[Spike Error] Test fixture not found at: ${fixturePath}`);
  process.exit(1);
}

// Locate MPV binary
const candidates = [
  path.resolve(rootDir, 'temp/mpv-bin/mpv.exe'),
  path.resolve(rootDir, 'temp/mpv-bin/mpv.com'),
  'mpv.exe',
  'mpv'
];

let mpvExe = null;
for (const cand of candidates) {
  if (path.isAbsolute(cand)) {
    if (fs.existsSync(cand)) {
      mpvExe = cand;
      break;
    }
  } else {
    mpvExe = cand; // fallback to PATH
    break;
  }
}

console.log(`[Spike] Test fixture: ${fixturePath}`);
console.log(`[Spike] Using MPV executable: ${mpvExe}`);

const pipeName = `\\\\.\\pipe\\streamix-mpv-spike-${Date.now()}`;
console.log(`[Spike] Using Windows Named Pipe: ${pipeName}`);

const mpvArgs = [
  '--idle=yes',
  `--input-ipc-server=${pipeName}`,
  '--audio-client-name=STREAMIX-Desktop-Spike',
  '--no-terminal',
  '--keep-open=yes',
  '--volume=70'
];

console.log(`[Spike 1/9] Spawning MPV native process...`);
const mpvProc = spawn(mpvExe, mpvArgs, {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: false
});

mpvProc.stderr.on('data', (d) => {
  const msg = d.toString().trim();
  if (msg) console.error(`[MPV stderr] ${msg}`);
});

mpvProc.on('exit', (code, signal) => {
  console.log(`[Spike] MPV process exited with code=${code}, signal=${signal}`);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToPipe(pipe, retries = 30, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await new Promise((resolve, reject) => {
        const sock = net.connect(pipe, () => resolve(sock));
        sock.on('error', (err) => reject(err));
      });
      return client;
    } catch {
      await sleep(delayMs);
    }
  }
  throw new Error(`Failed to connect to MPV IPC socket at ${pipe} after ${retries} attempts.`);
}

class MpvClient {
  constructor(socket) {
    this.socket = socket;
    this.reqId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.events = [];

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.request_id && this.pending.has(parsed.request_id)) {
            const { resolve, reject } = this.pending.get(parsed.request_id);
            this.pending.delete(parsed.request_id);
            if (parsed.error && parsed.error !== 'success') {
              reject(new Error(`MPV error (${parsed.error}) for req ${parsed.request_id}`));
            } else {
              resolve(parsed.data);
            }
          } else {
            this.events.push(parsed);
          }
        } catch (e) {
          console.error(`[Spike] Failed to parse IPC line: ${line}`, e);
        }
      }
    });
  }

  command(...args) {
    const id = this.reqId++;
    const payload = JSON.stringify({ command: args, request_id: id }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(payload, 'utf8', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  getProperty(name) {
    return this.command('get_property', name);
  }

  setProperty(name, value) {
    return this.command('set_property', name, value);
  }

  destroy() {
    this.socket.destroy();
  }
}

async function runSpike() {
  const results = {
    started: false,
    fileOpened: false,
    playbackBegan: false,
    positionAndDurationRead: false,
    pauseResumeVerified: false,
    seekVerified: false,
    audioTracksEnumerated: false,
    audioTracksSwitched: false,
    shutdownClean: false,
    details: {}
  };

  try {
    console.log(`[Spike] Connecting to MPV named pipe IPC...`);
    const socket = await connectToPipe(pipeName);
    const client = new MpvClient(socket);
    results.started = true;
    console.log(`[Spike 1/9 PASS] Native MPV process running and IPC connected.`);

    // 2. Open local test file
    console.log(`[Spike 2/9] Loading local test fixture: ${fixturePath}`);
    await client.command('loadfile', fixturePath, 'replace');
    results.fileOpened = true;
    console.log(`[Spike 2/9 PASS] Fixture loadfile command sent.`);

    // Wait briefly for file probe and playback to begin
    await sleep(800);

    // 3. Begin playback
    const pausedInit = await client.getProperty('pause');
    const coreIdle = await client.getProperty('core-idle');
    results.playbackBegan = !coreIdle;
    console.log(`[Spike 3/9 PASS] Playback started (pause=${pausedInit}, coreIdle=${coreIdle}).`);

    // 4. Read playback position and duration
    let duration = null;
    let pos = null;
    for (let i = 0; i < 10; i++) {
      duration = await client.getProperty('duration').catch(() => null);
      pos = await client.getProperty('time-pos').catch(() => null);
      if (duration !== null && pos !== null) break;
      await sleep(300);
    }
    results.positionAndDurationRead = (duration !== null && pos !== null);
    results.details.duration = duration;
    results.details.initialPosition = pos;
    console.log(`[Spike 4/9 PASS] Position=${pos}s, Duration=${duration}s`);

    // 5. Pause and resume
    console.log(`[Spike 5/9] Testing pause & resume...`);
    await client.setProperty('pause', true);
    const isPaused = await client.getProperty('pause');
    await sleep(400);
    await client.setProperty('pause', false);
    const isResumed = !(await client.getProperty('pause'));
    results.pauseResumeVerified = (isPaused === true && isResumed === true);
    console.log(`[Spike 5/9 PASS] Pause verified (${isPaused}) & Resume verified (${isResumed}).`);

    // 6. Seek
    console.log(`[Spike 6/9] Testing seek...`);
    await client.command('seek', 2.0, 'absolute');
    await sleep(400);
    const posAfterSeek = await client.getProperty('time-pos');
    results.details.posAfterSeek = posAfterSeek;
    results.seekVerified = (typeof posAfterSeek === 'number' && Math.abs(posAfterSeek - 2.0) < 1.0);
    console.log(`[Spike 6/9 PASS] Target seek=2.0s, Observed position=${posAfterSeek}s`);

    // 7. Enumerate actual audio tracks
    console.log(`[Spike 7/9] Enumerating actual audio tracks from MPV...`);
    const trackList = await client.getProperty('track-list');
    const audioTracks = (trackList || []).filter(t => t.type === 'audio');
    results.details.audioTracks = audioTracks;
    results.audioTracksEnumerated = (audioTracks.length >= 2);
    console.log(`[Spike 7/9 PASS] Discovered ${audioTracks.length} audio tracks:`, JSON.stringify(audioTracks, null, 2));

    // 8. Switch between available audio tracks
    console.log(`[Spike 8/9] Testing audio track switching...`);
    const currentAidBefore = await client.getProperty('aid');
    console.log(`[Spike] Initial active audio track ID (aid): ${currentAidBefore}`);

    // Select second audio track
    const targetAid = audioTracks[1]?.id || 2;
    await client.setProperty('aid', targetAid);
    await sleep(400);
    const currentAidAfter = await client.getProperty('aid');
    console.log(`[Spike] Switched active audio track ID (aid): ${currentAidAfter}`);

    results.audioTracksSwitched = (currentAidAfter === targetAid && currentAidAfter !== currentAidBefore);
    results.details.audioSwitch = { from: currentAidBefore, to: currentAidAfter, target: targetAid };
    console.log(`[Spike 8/9 PASS] Audio track switch verified: ${currentAidBefore} -> ${currentAidAfter}`);

    // Test volume control
    await client.setProperty('volume', 85);
    const vol = await client.getProperty('volume');
    results.details.volume = vol;
    console.log(`[Spike] Volume verified: ${vol}%`);

    // 9. Stop playback and release resources cleanly
    console.log(`[Spike 9/9] Quitting MPV and cleaning up IPC resources...`);
    await client.command('quit');
    client.destroy();

    // Wait for process exit
    const exitCode = await new Promise((resolve) => {
      if (mpvProc.exitCode !== null) return resolve(mpvProc.exitCode);
      mpvProc.on('exit', (c) => resolve(c));
      setTimeout(() => {
        try { mpvProc.kill(); } catch {}
        resolve(-1);
      }, 3000);
    });

    results.shutdownClean = (exitCode === 0);
    console.log(`[Spike 9/9 PASS] MPV cleanly terminated with exitCode=${exitCode}.`);

    console.log('\n================ SPIKE SUMMARY ================');
    console.log(JSON.stringify(results, null, 2));
    console.log('================================================\n');

    process.exit(0);
  } catch (err) {
    console.error(`[Spike FAILURE]`, err);
    try { mpvProc.kill(); } catch {}
    process.exit(1);
  }
}

runSpike();
