// Languages the UI can show. Native name first so people find their own language; never flags.
// tier: 1 = South Indian launch set, 2 = next most spoken, 3 = rest. Only English is reviewed;
// the others are machine-drafted (see shell.language.draft).

export type LocaleCode = "en" | "hi" | "ta" | "te" | "kn" | "ml" | "bn" | "mr" | "gu" | "pa" | "or" | "as" | "ur";

export type LocaleInfo = { code: LocaleCode; native: string; english: string; tier: 0 | 1 | 2 | 3; dir: "ltr" | "rtl"; font?: string };

export const LOCALES: LocaleInfo[] = [
  { code: "en", native: "English", english: "English", tier: 0, dir: "ltr" },
  { code: "hi", native: "हिन्दी", english: "Hindi", tier: 1, dir: "ltr", font: "Noto Sans Devanagari" },
  { code: "ta", native: "தமிழ்", english: "Tamil", tier: 1, dir: "ltr", font: "Noto Sans Tamil" },
  { code: "te", native: "తెలుగు", english: "Telugu", tier: 1, dir: "ltr", font: "Noto Sans Telugu" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada", tier: 1, dir: "ltr", font: "Noto Sans Kannada" },
  { code: "ml", native: "മലയാളം", english: "Malayalam", tier: 1, dir: "ltr", font: "Noto Sans Malayalam" },
  { code: "bn", native: "বাংলা", english: "Bengali", tier: 2, dir: "ltr", font: "Noto Sans Bengali" },
  { code: "mr", native: "मराठी", english: "Marathi", tier: 2, dir: "ltr", font: "Noto Sans Devanagari" },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati", tier: 2, dir: "ltr", font: "Noto Sans Gujarati" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi", tier: 2, dir: "ltr", font: "Noto Sans Gurmukhi" },
  { code: "or", native: "ଓଡ଼ିଆ", english: "Odia", tier: 3, dir: "ltr", font: "Noto Sans Oriya" },
  { code: "as", native: "অসমীয়া", english: "Assamese", tier: 3, dir: "ltr", font: "Noto Sans Bengali" },
  { code: "ur", native: "اردو", english: "Urdu", tier: 3, dir: "rtl", font: "Noto Nastaliq Urdu" },
];

export const localeInfo = (code: string) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];

/** Load the Noto face for a script once, only when someone picks that language (keeps the default page light).
 *  If Google Fonts is unreachable the OS font is used (Nirmala UI on Windows covers every script here). */
export function loadScriptFont(code: LocaleCode) {
  const family = localeInfo(code).font;
  if (!family || typeof document === "undefined") return;
  const id = `font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, "+")}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}
