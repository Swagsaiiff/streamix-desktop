import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_QUALITY,
  applyQuality,
  buildQualityOptions,
  currentQualityValue,
  explainQuality,
  qualityLabel,
  realLevels
} from "./quality.js";

test("qualityLabel uses the real height when present", () => {
  assert.equal(qualityLabel({ height: 1080 }), "1080p");
  assert.equal(qualityLabel({ height: 480 }), "480p");
});

test("qualityLabel omits a resolution when the manifest provides none", () => {
  assert.equal(qualityLabel({}), null);
  assert.equal(qualityLabel(null), null);
});

test("qualityLabel falls back to bitrate only when no resolution exists", () => {
  assert.equal(qualityLabel({ bitrate: 800000 }), "800 kbps");
});

test("realLevels keeps only real, unique levels", () => {
  const real = realLevels([{ height: 1080 }, { height: 720 }, { height: 720 }, {}]);
  assert.deepEqual(real, [
    { value: 0, label: "1080p", height: 1080 },
    { value: 1, label: "720p", height: 720 }
  ]);
});

test("multi-quality sources expose Auto plus every real level and are switchable", () => {
  const info = buildQualityOptions([{ height: 1080 }, { height: 720 }, { height: 480 }], AUTO_QUALITY);
  assert.equal(info.single, false);
  assert.equal(info.realCount, 3);
  assert.deepEqual(
    info.options.map((o) => o.label),
    ["Auto", "1080p", "720p", "480p"]
  );
  assert.equal(info.displayLabel, "Auto");
  assert.equal(explainQuality(info.realCount, info.displayLabel), null);
});

test("single-quality sources show the real quality instead of a grey Auto", () => {
  const info = buildQualityOptions([{ height: 720 }], AUTO_QUALITY);
  assert.equal(info.single, true);
  assert.equal(info.realCount, 1);
  assert.equal(info.displayValue, 0);
  assert.equal(info.displayLabel, "720p");
  assert.match(explainQuality(info.realCount, info.displayLabel), /Only 720p is available/);
});

test("a source with no reported levels is honest about it and never fabricates options", () => {
  const info = buildQualityOptions([], AUTO_QUALITY);
  assert.equal(info.single, true);
  assert.equal(info.realCount, 0);
  assert.deepEqual(info.options, [{ value: AUTO_QUALITY, label: "Auto" }]);
  assert.match(explainQuality(info.realCount, info.displayLabel), /does not report any explicit video quality/);
});

test("applyQuality selects a specific level and returns it", () => {
  const hls = { currentLevel: AUTO_QUALITY, autoLevelEnabled: true };
  const applied = applyQuality(hls, 2);
  assert.equal(applied, 2);
  assert.equal(hls.currentLevel, 2);
});

test("applyQuality switches back to automatic mode", () => {
  const hls = { currentLevel: 1, autoLevelEnabled: false };
  const applied = applyQuality(hls, AUTO_QUALITY);
  assert.equal(applied, AUTO_QUALITY);
  assert.equal(hls.currentLevel, AUTO_QUALITY);
});

test("currentQualityValue reports Auto when adaptivity is on and the level otherwise", () => {
  assert.equal(currentQualityValue({ autoLevelEnabled: true, currentLevel: 2 }), AUTO_QUALITY);
  assert.equal(currentQualityValue({ autoLevelEnabled: false, currentLevel: 2 }), 2);
  assert.equal(currentQualityValue({ autoLevelEnabled: false, currentLevel: -1 }), AUTO_QUALITY);
  assert.equal(currentQualityValue(null), AUTO_QUALITY);
});

test("applyQuality tolerates a missing hls instance", () => {
  assert.equal(applyQuality(null, 1), AUTO_QUALITY);
});

test("quality options are ordered highest-first while keeping the real level index", () => {
  const { options } = buildQualityOptions([{ height: 640 }, { height: 1080 }, { height: 720 }], AUTO_QUALITY);
  assert.deepEqual(options.map((o) => o.label), ["Auto", "1080p", "720p", "640p"]);
  // 1080p sits at hls level index 1, and that real index is what the selector submits.
  assert.equal(options.find((o) => o.label === "1080p").value, 1);
  assert.equal(options.find((o) => o.label === "640p").value, 0);
});
