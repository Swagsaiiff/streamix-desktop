import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDetail } from "./cinemeta.js";

const seriesMeta = {
  id: "tt0903747",
  type: "series",
  name: "Breaking Bad",
  year: "2008–2013",
  releaseInfo: "2008-2013",
  imdbRating: "9.5",
  genre: ["Crime", "Drama", "Thriller"],
  description: "A high school chemistry teacher...",
  poster: "https://images.metahub.space/poster/small/tt0903747/img",
  background: "https://images.metahub.space/background/medium/tt0903747/img",
  popularity: 9.8,
  videos: [
    {
      id: "tt0903747:1:1",
      name: "Pilot",
      season: 1,
      number: 1,
      episode: 1,
      firstAired: "2008-01-21T05:00:00.000Z",
      released: "2008-01-21T05:00:00.000Z",
      rating: "7.7",
      overview: "When an unassuming high school chemistry teacher discovers...",
      thumbnail: "https://episodes.metahub.space/tt0903747/1/1/w780.jpg",
      tvdb_id: 349232
    },
    {
      id: "tt0903747:1:2",
      name: "Cat's in the Bag...",
      season: 1,
      number: 2,
      episode: 2,
      firstAired: "2008-01-28T05:00:00.000Z",
      released: "2008-01-28T05:00:00.000Z",
      rating: "7.6",
      overview: "Walt and Jesse attempt to tie up loose ends.",
      thumbnail: "https://episodes.metahub.space/tt0903747/1/2/w780.jpg",
      tvdb_id: 349233
    }
  ]
};

const movieMeta = {
  id: "tt0096895",
  type: "movie",
  name: "Batman",
  year: "1989",
  releaseInfo: "1989",
  imdbRating: "7.5",
  genre: ["Action", "Adventure"],
  description: "The Dark Knight...",
  poster: "https://images.metahub.space/poster/small/tt0903747/img",
  background: "https://images.metahub.space/background/medium/tt0903747/img",
  popularity: 8.2
};

test("normalizeDetail returns movie episodes as null", () => {
  const item = normalizeDetail(movieMeta);
  assert.equal(item.type, "movie");
  assert.equal(item.episodes, null);
});

test("normalizeDetail extracts episodes for series", () => {
  const item = normalizeDetail(seriesMeta);
  assert.equal(item.type, "series");
  assert.ok(Array.isArray(item.episodes));
  assert.equal(item.episodes.length, 2);
  assert.equal(item.episodes[0].season, 1);
  assert.equal(item.episodes[0].episode, 1);
  assert.equal(item.episodes[0].name, "Pilot");
  assert.equal(item.episodes[0].overview, "When an unassuming high school chemistry teacher discovers...");
  assert.equal(item.episodes[0].rating, 7.7);
  assert.equal(item.episodes[0].firstAired, "2008-01-21T05:00:00.000Z");
});

test("normalizeDetail filters out season 0 episodes", () => {
  const metaWithSpecials = {
    ...seriesMeta,
    videos: [
      { ...seriesMeta.videos[0], season: 0, episode: 1 },
      { ...seriesMeta.videos[0], season: 1, episode: 1 }
    ]
  };
  const item = normalizeDetail(metaWithSpecials);
  assert.equal(item.episodes.length, 1);
  assert.equal(item.episodes[0].season, 1);
});

test("normalizeDetail sorts episodes by season then number", () => {
  const meta = {
    id: "x",
    type: "series",
    name: "S",
    year: "2020",
    videos: [
      { name: "S2E1", season: 2, episode: 1 },
      { name: "S1E2", season: 1, episode: 2 },
      { name: "S1E1", season: 1, episode: 1 }
    ]
  };
  const item = normalizeDetail(meta);
  assert.equal(item.episodes.length, 3);
  assert.equal(item.episodes[0].season, 1);
  assert.equal(item.episodes[0].episode, 1);
  assert.equal(item.episodes[1].season, 1);
  assert.equal(item.episodes[1].episode, 2);
  assert.equal(item.episodes[2].season, 2);
  assert.equal(item.episodes[2].episode, 1);
});

test("normalizeDetail handles missing videos array", () => {
  const meta = { id: "x", type: "series", name: "S", year: "2020", videos: [] };
  const item = normalizeDetail(meta);
  assert.equal(item.type, "series");
  assert.ok(Array.isArray(item.episodes));
  assert.equal(item.episodes.length, 0);
});

test("normalizeDetail preserves base meta fields", () => {
  const item = normalizeDetail(movieMeta);
  assert.equal(item.id, "tt0096895");
  assert.equal(item.title, "Batman");
  assert.equal(item.year, 1989);
  assert.equal(item.rating, 7.5);
  assert.equal(item.source, "CineStream");
});
