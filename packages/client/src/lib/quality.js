// Quality options are derived from the actual HLS levels hls.js reports.
// Never invent resolutions: if the manifest exposes no height we omit the label.

export const AUTO_QUALITY = -1;

export function qualityLabel(level) {
  if (!level) return null;
  const height = Number(level.height);
  if (Number.isFinite(height) && height > 0) return `${height}p`;
  const width = Number(level.width);
  if (Number.isFinite(width) && width > 0) {
    const approx = [4320, 2160, 1440, 1080, 720, 576, 480, 360, 240, 144].find((h) => h <= Math.round(width * 0.5625));
    if (approx) return `${approx}p`;
  }
  if (Number.isFinite(Number(level.bitrate)) && Number(level.bitrate) > 0) {
    return `${Math.round(Number(level.bitrate) / 1000)} kbps`;
  }
  return null;
}

export function realLevels(levels = []) {
  const seen = new Set();
  const list = [];
  levels.forEach((level, index) => {
    const label = qualityLabel(level);
    if (!label || seen.has(label)) return;
    seen.add(label);
    list.push({ value: index, label, height: Number(level?.height) || 0 });
  });
  // Display highest quality first; `value` keeps the real hls.js level index for switching.
  return list.sort((a, b) => b.height - a.height);
}

export function buildQualityOptions(levels = [], currentLevel = AUTO_QUALITY) {
  const real = realLevels(levels);
  const options = [{ value: AUTO_QUALITY, label: "Auto" }, ...real];
  // `single` = at most one real quality, so there is nothing to switch between.
  const single = real.length <= 1;
  return {
    options,
    real,
    realCount: real.length,
    single,
    current: currentLevel,
    // With a single quality, show that actual quality rather than a meaningless "Auto".
    displayValue: single && real.length === 1 ? real[0].value : currentLevel,
    displayLabel: single
      ? real.length === 1
        ? real[0].label
        : "Auto"
      : currentLevel === AUTO_QUALITY
        ? "Auto"
        : (real.find((r) => r.value === currentLevel)?.label ?? "Auto")
  };
}

export function explainQuality(realCount, displayLabel) {
  if (realCount <= 0) return "This source does not report any explicit video quality levels";
  if (realCount === 1) return `Only ${displayLabel} is available from this source, so switching is unavailable`;
  return null;
}

// Applies a selection to an hls.js instance. Returns the level that was requested
// (AUTO_QUALITY means automatic/adaptive).
export function applyQuality(hls, value) {
  if (!hls) return AUTO_QUALITY;
  const level = Number(value);
  if (!Number.isFinite(level) || level === AUTO_QUALITY) {
    hls.currentLevel = AUTO_QUALITY;
    return AUTO_QUALITY;
  }
  hls.currentLevel = level;
  return level;
}

export function currentQualityValue(hls) {
  if (!hls) return AUTO_QUALITY;
  if (hls.autoLevelEnabled) return AUTO_QUALITY;
  const level = Number(hls.currentLevel);
  return Number.isFinite(level) && level >= 0 ? level : AUTO_QUALITY;
}
