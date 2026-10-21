import test from "node:test";
import assert from "node:assert/strict";
import { mergeSearchResults, rankSearchResults, relevanceScore, normalizeTitle } from "./search.js";

function item(overrides) {
  return {
    id: "x",
    title: "Title",
    type: "movie",
    year: 2020,
    provider: "CineStream",
    ...overrides
  };
}

test("mergeSearchResults keeps results from every provider without dropping slower ones", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [item({ id: "tt1", title: "Alpha", year: 2001 })] },
    { provider: "ProviderB", items: [item({ id: "/beta/", title: "Beta", year: 2020, provider: "ProviderB" })] }
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((i) => i.provider).sort(), ["CineStream", "ProviderB"]);
});

test("mergeSearchResults dedupes identical titles from different providers", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [item({ id: "tt1", title: "Beast of War", year: 2025 })] },
    { provider: "ProviderB", items: [item({ id: "/beast/", title: "Beast of War", year: 2025, provider: "ProviderB" })] }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provider, "CineStream");
});

test("mergeSearchResults keeps different years (remakes) as separate titles", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [item({ id: "tt-old", title: "Dune", year: 1984 })] },
    { provider: "ProviderB", items: [item({ id: "/dune-2021/", title: "Dune", year: 2021, provider: "ProviderB" })] }
  ]);
  assert.equal(merged.length, 2);
});

test("mergeSearchResults does not merge a movie with a series of the same name", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [item({ id: "tt-m", title: "Fargo", year: 1996, type: "movie" })] },
    { provider: "CineStream", items: [item({ id: "tt-s", title: "Fargo", year: 1996, type: "series" })] }
  ]);
  assert.equal(merged.length, 2);
});

test("mergeSearchResults normalizes punctuation and case for dedupe", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [item({ id: "a", title: "Spider-Man: No Way Home", year: 2021 })] },
    { provider: "ProviderB", items: [item({ id: "b", title: "Spider Man No Way Home", year: 2021, provider: "ProviderB" })] }
  ]);
  assert.equal(merged.length, 1);
});

test("mergeSearchResults tolerates empty provider result sets", () => {
  const merged = mergeSearchResults([
    { provider: "CineStream", items: [] },
    { provider: "VegaMovies", items: [item({ id: "/only/", provider: "VegaMovies" })] }
  ]);
  assert.equal(merged.length, 1);
});

test("normalizeTitle lowercases, strips punctuation and diacritics", () => {
  assert.equal(normalizeTitle("Spider-Man: No Way Home!"), "spider man no way home");
  assert.equal(normalizeTitle("Amélie"), "amelie");
  assert.equal(normalizeTitle("  THE   Batman (2022) "), "the batman 2022");
});

test("relevanceScore ranks exact title above partial matches", () => {
  const exact = relevanceScore("batman", { title: "Batman", year: 1989 });
  const prefix = relevanceScore("batman", { title: "Batman Begins", year: 2005 });
  const word = relevanceScore("batman", { title: "The Batman", year: 2022 });
  const contains = relevanceScore("batman", { title: "The Batmaniax", year: 2016 });
  const unrelated = relevanceScore("batman", { title: "Superman", year: 1978 });
  assert.ok(exact > prefix, "exact > prefix");
  assert.ok(prefix > word, "prefix > word-boundary");
  assert.ok(word > contains, "word > contains");
  assert.ok(contains > unrelated, "contains > unrelated");
});

test("rankSearchResults puts the exact full-title match first even with many results", () => {
  const items = [
    { id: "a", title: "Batman Begins", type: "movie", year: 2005, provider: "CineStream" },
    { id: "b", title: "The Batman", type: "movie", year: 2022, provider: "CineStream" },
    { id: "c", title: "Batman", type: "movie", year: 1989, provider: "CineStream" },
    { id: "d", title: "Batman Returns", type: "movie", year: 1992, provider: "VegaMovies" },
    { id: "e", title: "Batman v Superman: Dawn of Justice", type: "movie", year: 2016, provider: "CineStream" }
  ];
  const ranked = rankSearchResults(items, "batman");
  assert.equal(ranked[0].title, "Batman");
  assert.equal(ranked[1].title, "Batman Begins");
});

test("rankSearchResults is case and punctuation insensitive for the top slot", () => {
  const items = [
    { id: "a", title: "spider man", type: "movie", year: 2020, provider: "VegaMovies" },
    { id: "b", title: "Spider-Man: No Way Home", type: "movie", year: 2021, provider: "CineStream" }
  ];
  const ranked = rankSearchResults(items, "Spider-Man: No Way Home");
  assert.equal(ranked[0].title, "Spider-Man: No Way Home");
});

test("rankSearchResults breaks score ties by newest year and keeps all items", () => {
  const items = [
    { id: "old", title: "Dune", type: "movie", year: 1984, provider: "CineStream" },
    { id: "new", title: "Dune", type: "movie", year: 2021, provider: "VegaMovies" }
  ];
  const ranked = rankSearchResults(items, "dune");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].year, 2021);
});
