import test from "node:test";
import assert from "node:assert/strict";
import { matchesYear, createTmdbEnricher, mapWithConcurrency, TMDBProvider, getTmdbImageUrl } from "./tmdb.js";
import { ProviderError } from "./base.js";

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

test("getTmdbImageUrl formats proper image urls", () => {
  assert.equal(getTmdbImageUrl(null), null);
  assert.equal(getTmdbImageUrl("/path.jpg", "w500"), "https://image.tmdb.org/t/p/w500/path.jpg");
  assert.equal(getTmdbImageUrl("https://custom.cdn/img.jpg"), "https://custom.cdn/img.jpg");
});

test("TMDBProvider reports correct capabilities and configuration state", () => {
  const unconfigured = new TMDBProvider({ apiKey: "" });
  assert.equal(unconfigured.getName(), "TMDB");
  assert.equal(unconfigured.isConfigured(), false);
  const caps = unconfigured.getCapabilities();
  assert.equal(caps.supportsHomePage, true);
  assert.equal(caps.supportsSearch, true);
  assert.equal(caps.supportsDetail, true);
  assert.equal(caps.supportsStreamResolution, false);

  const configured = new TMDBProvider({ apiKey: "test_key_123" });
  assert.equal(configured.isConfigured(), true);
});

test("TMDBProvider.normalizeItem produces complete normalized item model", () => {
  const provider = new TMDBProvider({ apiKey: "dummy" });
  const genreMap = new Map([
    [28, "Action"],
    [12, "Adventure"]
  ]);

  const rawMovie = {
    id: 12345,
    title: "Test Movie",
    release_date: "2024-06-15",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    overview: "A test synopsis",
    vote_average: 8.35,
    popularity: 145.2,
    genre_ids: [28, 12]
  };

  const normalized = provider.normalizeItem(rawMovie, "movie", genreMap);
  assert.equal(normalized.id, "12345");
  assert.equal(normalized.tmdbId, 12345);
  assert.equal(normalized.type, "movie");
  assert.equal(normalized.provider, "TMDB");
  assert.equal(normalized.source, "TMDB");
  assert.equal(normalized.title, "Test Movie");
  assert.equal(normalized.year, 2024);
  assert.equal(normalized.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(normalized.backdrop, "https://image.tmdb.org/t/p/original/backdrop.jpg");
  assert.equal(normalized.overview, "A test synopsis");
  assert.equal(normalized.rating, 8.4);
  assert.deepEqual(normalized.genres, ["Action", "Adventure"]);
});

test("TMDBProvider.normalizeItem safely handles missing fields", () => {
  const provider = new TMDBProvider({ apiKey: "dummy" });
  const rawEmpty = { id: 999 };
  const normalized = provider.normalizeItem(rawEmpty, "movie");
  assert.equal(normalized.id, "999");
  assert.equal(normalized.tmdbId, 999);
  assert.equal(normalized.title, "Untitled");
  assert.equal(normalized.year, null);
  assert.equal(normalized.poster, null);
  assert.equal(normalized.backdrop, null);
  assert.equal(normalized.overview, null);
  assert.equal(normalized.rating, null);
  assert.equal(normalized.genres, null);
});

test("TMDBProvider.request throws unauthorized error when unconfigured", async () => {
  const provider = new TMDBProvider({ apiKey: "" });
  await assert.rejects(
    () => provider.request("/movie/popular"),
    (err) => err instanceof ProviderError && err.code === "unauthorized"
  );
});
