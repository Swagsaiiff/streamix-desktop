import test from "node:test";
import assert from "node:assert/strict";
import { matchesYear, createTmdbEnricher, mapWithConcurrency } from "./tmdb.js";

test("matchesYear within tolerance", () => {
  assert.equal(matchesYear(2008, 2009), true);
  assert.equal(matchesYear(2008, 2010), false);
  assert.equal(matchesYear(null, 2008), false);
});

test("enricher is disabled without a key and passes items through", async () => {
  const { enrich, isEnabled } = createTmdbEnricher({ apiKey: "", cache: undefined });
  assert.equal(isEnabled, false);
  const result = await enrich([{ id: "x", title: "Batman", year: 1989 }]);
  assert.equal(result.status, "disabled");
  assert.equal(result.reason, "no_tmdb_key");
  assert.equal(result.matched, 0);
  assert.deepEqual(result.items, [{ id: "x", title: "Batman", year: 1989 }]);
});

test("mapWithConcurrency preserves input order and applies concurrency limit", async () => {
  const input = [1, 2, 3, 4, 5];
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency(input, 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("mapWithConcurrency handles empty input", async () => {
  const result = await mapWithConcurrency([], 4, async (value) => value);
  assert.deepEqual(result, []);
});

test("mapWithConcurrency propagates rejected items", async () => {
  await assert.rejects(
    () =>
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error("boom");
        return value;
      }),
    /boom/
  );
});
