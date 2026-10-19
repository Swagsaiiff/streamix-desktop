const LANGUAGE_NAMES = {
  eng: "English",
  en: "English",
  hin: "Hindi",
  hi: "Hindi",
  tha: "Thai",
  th: "Thai",
  tam: "Tamil",
  tel: "Telugu",
  mal: "Malayalam",
  kan: "Kannada",
  mar: "Marathi",
  ben: "Bengali",
  guj: "Gujarati",
  pan: "Punjabi",
  pun: "Punjabi",
  urd: "Urdu",
  ori: "Odia",
  asm: "Assamese",
  kor: "Korean",
  ko: "Korean",
  jpn: "Japanese",
  ja: "Japanese",
  chi: "Chinese",
  zho: "Chinese",
  zh: "Chinese",
  yue: "Cantonese",
  spa: "Spanish",
  es: "Spanish",
  fre: "French",
  fra: "French",
  fr: "French",
  ger: "German",
  deu: "German",
  de: "German",
  ita: "Italian",
  it: "Italian",
  por: "Portuguese",
  pt: "Portuguese",
  rus: "Russian",
  ru: "Russian",
  ara: "Arabic",
  ar: "Arabic",
  per: "Persian",
  fas: "Persian",
  tur: "Turkish",
  tr: "Turkish",
  vie: "Vietnamese",
  vi: "Vietnamese",
  ind: "Indonesian",
  id: "Indonesian",
  fil: "Filipino",
  tgl: "Tagalog",
  dut: "Dutch",
  nld: "Dutch",
  nl: "Dutch",
  swe: "Swedish",
  nor: "Norwegian",
  dan: "Danish",
  fin: "Finnish",
  pol: "Polish",
  gre: "Greek",
  ell: "Greek",
  cze: "Czech",
  ces: "Czech",
  slo: "Slovak",
  slk: "Slovak",
  hun: "Hungarian",
  rum: "Romanian",
  ron: "Romanian",
  ukr: "Ukrainian",
  heb: "Hebrew",
  hin_arabic: "Hindi",
  mya: "Burmese",
  nep: "Nepali",
  sin: "Sinhala",
  swa: "Swahili",
  afr: "Afrikaans"
};

export function languageName(code) {
  if (!code) return null;
  const key = String(code).trim().toLowerCase();
  if (!key) return null;
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key];
  const primary = key.split(/[-_]/)[0].replace(/[^a-z]/g, "");
  if (LANGUAGE_NAMES[primary]) return LANGUAGE_NAMES[primary];
  if (primary.length === 2) return primary.toUpperCase();
  return primary.charAt(0).toUpperCase() + primary.slice(1);
}

export function audioTrackLabel(track) {
  if (!track) return "";
  const base = String(track.name ?? track.title ?? "").trim();
  const langName = languageName(track.lang);
  const lowered = base.toLowerCase();
  const code = String(track.lang ?? "").trim().toLowerCase();
  const baseIsJustCode = lowered.length > 0 && (lowered === code || lowered.split(/[^a-z]/).filter(Boolean).every((part) => part === code || part === languageName(code)?.toLowerCase()));
  if (baseIsJustCode && langName) return langName;
  const alreadyNamed =
    base.length > 0 &&
    ((langName && lowered.includes(langName.toLowerCase())) || (code && new RegExp(`\\b${code}\\b`).test(lowered)));
  if (base && langName && !alreadyNamed) return `${base} · ${langName}`;
  if (base) return base;
  if (langName) return langName;
  return "Audio";
}
