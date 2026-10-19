// Playback progress storage abstraction.
// Uses an injected storage (defaults to localStorage) so it is testable in Node
// and can be swapped for a backend implementation later.

const STORAGE_KEY = "streamix.progress.v1";
const MAX_ENTRIES = 60;
const COMPLETE_RATIO = 0.95;
const COMPLETE_TAIL_SECONDS = 30;
const MIN_SAVE_SECONDS = 5;

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // storage unavailable (private mode / SSR)
  }
  return null;
}

function safeParse(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function progressKey({ provider = "default", type, id, season = null, episode = null } = {}) {
  const base = `${provider}:${type}:${id}`;
  if (season != null && episode != null) return `${base}:s${season}e${episode}`;
  return base;
}

export function isComplete(position, duration) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return false;
  if (position >= duration * COMPLETE_RATIO) return true;
  return duration - position <= COMPLETE_TAIL_SECONDS;
}

export function clampPosition(position, duration) {
  const pos = Number(position);
  const dur = Number(duration);
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (!Number.isFinite(dur) || dur <= 0) return pos;
  return Math.min(pos, Math.max(0, dur - 1));
}

export function createProgressStore(storageOverride) {
  const storage = resolveStorage(storageOverride);

  function readAll() {
    if (!storage) return {};
    return safeParse(storage.getItem(STORAGE_KEY));
  }

  function writeAll(entries) {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // quota or unavailable storage: keep the app working without persistence
    }
  }

  function prune(entries) {
    const list = Object.entries(entries)
      .filter(([, value]) => value && Number.isFinite(value.position) && Number.isFinite(value.duration) && value.duration > 0)
      .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    const kept = {};
    for (const [key, value] of list.slice(0, MAX_ENTRIES)) kept[key] = value;
    return kept;
  }

  function save(entry) {
    if (!entry || !entry.type || entry.id == null) return null;
    const duration = Number(entry.duration);
    const rawPosition = Number(entry.position);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    if (!Number.isFinite(rawPosition) || rawPosition < 0) return null;

    const position = clampPosition(rawPosition, duration);
    const key = progressKey(entry);

    if (isComplete(position, duration)) {
      remove(key);
      return null;
    }
    if (position < MIN_SAVE_SECONDS) {
      remove(key);
      return null;
    }

    const entries = readAll();
    entries[key] = {
      key,
      id: entry.id,
      type: entry.type,
      provider: entry.provider ?? "default",
      title: entry.title ?? null,
      poster: entry.poster ?? null,
      backdrop: entry.backdrop ?? null,
      season: entry.season ?? null,
      episode: entry.episode ?? null,
      episodeTitle: entry.episodeTitle ?? null,
      position,
      duration,
      updatedAt: Date.now()
    };
    writeAll(prune(entries));
    return entries[key];
  }

  function get(entry) {
    const entries = readAll();
    return entries[progressKey(entry)] ?? null;
  }

  function remove(identifier) {
    const key = typeof identifier === "string" ? identifier : progressKey(identifier);
    const entries = readAll();
    if (entries[key]) {
      delete entries[key];
      writeAll(entries);
    }
  }

  function clear() {
    writeAll({});
  }

  function list() {
    return Object.values(readAll()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  return { save, get, remove, clear, list, key: progressKey, isComplete };
}

export const progressStore = createProgressStore();