import test from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "./cache.js";

test("set and get within ttl", () => {
  const cache = new TtlCache({ ttlMs: 60000 });
  cache.set("a", { ok: 1 });
  assert.deepEqual(cache.get("a"), { ok: 1 });
});

test("expired entries are not returned", async () => {
  const cache = new TtlCache({ ttlMs: 10 });
  cache.set("a", 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cache.get("a"), undefined);
});

test("per-call ttl overrides the default", async () => {
  const cache = new TtlCache({ ttlMs: 60000 });
  cache.set("a", 1, 10);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cache.get("a"), undefined);
});

test("max entries evicts the oldest entry", () => {
  const cache = new TtlCache({ ttlMs: 60000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("delete invalidates a key without affecting others", () => {
  const cache = new TtlCache({ ttlMs: 60000 });
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.delete("a"), true);
  assert.equal(cache.delete("missing"), false);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.size(), 1);
});
