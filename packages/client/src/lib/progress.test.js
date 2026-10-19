import test from "node:test";
import assert from "node:assert/strict";
import { createProgressStore, progressKey, clampPosition, isComplete } from "./progress.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

const movie = { provider: "CineStream", type: "movie", id: "tt1", title: "Dune", poster: "p.jpg" };

test("progressKey distinguishes movies and episodes", () => {
  assert.equal(progressKey(movie), "CineStream:movie:tt1");
  assert.equal(progressKey({ ...movie, season: 1, episode: 3 }), "CineStream:movie:tt1:s1e3");
});

test("save stores position and duration and lists the entry", () => {
  const store = createProgressStore(fakeStorage());
  const saved = store.save({ ...movie, position: 120, duration: 600 });
  assert.equal(saved.position, 120);
  assert.equal(saved.duration, 600);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(movie).title, "Dune");
});

test("resume data persists across store instances (localStorage round trip)", () => {
  const storage = fakeStorage();
  const first = createProgressStore(storage);
  first.save({ ...movie, position: 300, duration: 900 });
  const second = createProgressStore(storage);
  assert.equal(second.get(movie).position, 300);
});

test("clampPosition keeps resume within the real duration", () => {
  assert.equal(clampPosition(5000, 100), 99);
  assert.equal(clampPosition(-10, 100), 0);
  assert.equal(clampPosition(50, 100), 50);
  assert.equal(clampPosition(NaN, 100), 0);
  assert.equal(clampPosition(50, 0), 50);
});

test("finished titles are treated as complete and removed", () => {
  const store = createProgressStore(fakeStorage());
  store.save({ ...movie, position: 590, duration: 600 });
  assert.equal(store.get(movie), null);
  store.save({ ...movie, position: 300, duration: 600 });
  assert.ok(store.get(movie));
  store.save({ ...movie, position: 599, duration: 600 });
  assert.equal(store.get(movie), null);
});

test("isComplete handles edge cases without dividing by zero", () => {
  assert.equal(isComplete(0, 0), false);
  assert.equal(isComplete(10, 0), false);
  assert.equal(isComplete(96, 100), true);
  assert.equal(isComplete(50, 100), false);
});

test("invalid saved data is ignored and never resumes", () => {
  const storage = fakeStorage();
  const store = createProgressStore(storage);
  assert.equal(store.save({ ...movie, position: 10, duration: 0 }), null);
  assert.equal(store.save({ ...movie, position: -5, duration: 100 }), null);
  assert.equal(store.save({ ...movie, position: NaN, duration: 100 }), null);
  assert.equal(store.save({ ...movie }), null);
  assert.equal(store.list().length, 0);
});

test("a missing provider is normalized to the default provider, not rejected", () => {
  const store = createProgressStore(fakeStorage());
  const saved = store.save({ type: "movie", id: "x", title: "X", position: 60, duration: 600 });
  assert.equal(saved.provider, "default");
  assert.equal(store.get({ type: "movie", id: "x" }).position, 60);
});

test("very short early positions are not saved (avoids noisy continue-watching)", () => {
  const store = createProgressStore(fakeStorage());
  store.save({ ...movie, position: 2, duration: 600 });
  assert.equal(store.get(movie), null);
});

test("each episode keeps its own progress", () => {
  const store = createProgressStore(fakeStorage());
  const series = { provider: "VegaMovies", type: "series", id: "/show/", title: "Show" };
  store.save({ ...series, season: 1, episode: 1, position: 100, duration: 1200 });
  store.save({ ...series, season: 1, episode: 2, position: 400, duration: 1200 });
  assert.equal(store.get({ ...series, season: 1, episode: 1 }).position, 100);
  assert.equal(store.get({ ...series, season: 1, episode: 2 }).position, 400);
});

test("entries are deduplicated and newest-first ordered", () => {
  const store = createProgressStore(fakeStorage());
  store.save({ ...movie, position: 100, duration: 600 });
  store.save({ ...movie, position: 250, duration: 600 });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].position, 250);
});

test("remove and clear drop persisted entries", () => {
  const store = createProgressStore(fakeStorage());
  store.save({ ...movie, position: 100, duration: 600 });
  store.remove(movie);
  assert.equal(store.get(movie), null);
  store.save({ ...movie, position: 100, duration: 600 });
  store.clear();
  assert.equal(store.list().length, 0);
});

test("list caps the number of stored entries", () => {
  const store = createProgressStore(fakeStorage());
  for (let i = 0; i < 70; i += 1) {
    store.save({ provider: "p", type: "movie", id: `id${i}`, title: `T${i}`, position: 100 + i, duration: 600 });
  }
  assert.ok(store.list().length <= 60);
});
