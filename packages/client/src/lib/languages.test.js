import test from "node:test";
import assert from "node:assert/strict";
import { languageName, audioTrackLabel } from "./languages.js";

test("languageName maps ISO 639-2/B and 639-2/T codes", () => {
  assert.equal(languageName("hin"), "Hindi");
  assert.equal(languageName("eng"), "English");
  assert.equal(languageName("tha"), "Thai");
  assert.equal(languageName("chi"), "Chinese");
  assert.equal(languageName("zho"), "Chinese");
  assert.equal(languageName("fre"), "French");
  assert.equal(languageName("fra"), "French");
  assert.equal(languageName("ger"), "German");
  assert.equal(languageName("deu"), "German");
  assert.equal(languageName("kor"), "Korean");
  assert.equal(languageName("tam"), "Tamil");
  assert.equal(languageName("tel"), "Telugu");
});

test("languageName handles ISO 639-1, case and region subtags", () => {
  assert.equal(languageName("EN"), "English");
  assert.equal(languageName("pt-BR"), "Portuguese");
  assert.equal(languageName("hi-IN"), "Hindi");
});

test("languageName never invents a mapping for unknown codes", () => {
  assert.equal(languageName("xyz"), "Xyz");
  assert.equal(languageName("qq"), "QQ");
  assert.equal(languageName(null), null);
  assert.equal(languageName(""), null);
});

test("audioTrackLabel combines the track name with the language name without duplication", () => {
  assert.equal(audioTrackLabel({ name: "Stereo", lang: "hin" }), "Stereo · Hindi");
  assert.equal(audioTrackLabel({ name: "Hindi", lang: "hin" }), "Hindi");
  assert.equal(audioTrackLabel({ name: "eng", lang: "eng" }), "English");
  assert.equal(audioTrackLabel({ name: "hin", lang: "hin" }), "Hindi");
  assert.equal(audioTrackLabel({ name: "eng (eng)", lang: "eng" }), "English");
  assert.equal(audioTrackLabel({ name: "hin (hin)", lang: "hin" }), "Hindi");
  assert.equal(audioTrackLabel({ name: "English Dub", lang: "eng" }), "English Dub");
  assert.equal(audioTrackLabel({ name: null, lang: "tha" }), "Thai");
  assert.equal(audioTrackLabel({ name: "Track 1", lang: null }), "Track 1");
  assert.equal(audioTrackLabel(null), "");
});
