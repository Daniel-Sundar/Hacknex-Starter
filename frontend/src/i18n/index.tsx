import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey, type Messages } from "./en";
import { LOCALES, loadScriptFont, localeInfo, type LocaleCode } from "./locales";

export { LOCALES, type LocaleCode } from "./locales";
export type { MessageKey } from "./en";

/** Keys that come in _one / _other pairs, used with tn(). */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;
type Vars = Record<string, string | number>;

const STORAGE = "cs-locale";
// Each language is its own chunk, fetched only when picked.
const loaders = import.meta.glob<{ default: Messages }>("./locales/*.ts");

function detect(): LocaleCode {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved && LOCALES.some((l) => l.code === saved)) return saved as LocaleCode;
  } catch { /* storage blocked */ }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.toLowerCase().split("-")[0];
    const hit = LOCALES.find((l) => l.code === base);
    if (hit) return hit.code;
  }
  return "en";
}

const warned = new Set<string>();

type Ctx = {
  locale: LocaleCode;
  dir: "ltr" | "rtl";
  scriptFont?: string;
  setLocale: (l: LocaleCode) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  tn: (key: PluralKey, count: number, vars?: Vars) => string;
  num: (n: number) => string;
  pct: (x: number) => string;
  date: (ts: number) => string;
};

const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [wanted, setWanted] = useState<LocaleCode>(detect);
  const [active, setActive] = useState<{ locale: LocaleCode; messages: Messages }>({ locale: "en", messages: {} });

  useEffect(() => {
    let live = true;
    try { localStorage.setItem(STORAGE, wanted); } catch { /* not persisted */ }
    loadScriptFont(wanted);
    if (wanted === "en") { setActive({ locale: "en", messages: {} }); return; }
    const load = loaders[`./locales/${wanted}.ts`];
    // Keep showing the current language until the new one has arrived (no flash of raw keys).
    (load ? load().then((m) => m.default) : Promise.resolve({} as Messages))
      .catch(() => ({} as Messages))
      .then((messages) => live && setActive({ locale: wanted, messages }));
    return () => { live = false; };
  }, [wanted]);

  const { locale, messages } = active;
  const info = localeInfo(locale);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const value = useMemo<Ctx>(() => {
    const nf = new Intl.NumberFormat(locale);
    const pf = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
    const df = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const plural = new Intl.PluralRules(locale);
    const lookup = (key: string): string | undefined => (messages as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
    const fill = (s: string, vars?: Vars) =>
      vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (typeof vars[k] === "number" ? nf.format(vars[k] as number) : String(vars[k])) : m)) : s;
    const t = (key: MessageKey, vars?: Vars) => {
      const s = lookup(key);
      if (s === undefined) {
        if (import.meta.env.DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
        return key;
      }
      return fill(s, vars);
    };
    const tn = (key: PluralKey, count: number, vars?: Vars) => {
      const s = lookup(`${key}_${plural.select(count)}`) ?? lookup(`${key}_other`) ?? key;
      return fill(s, { count, ...vars });
    };
    return {
      locale, dir: info.dir, scriptFont: info.font, setLocale: setWanted, t, tn,
      num: (n) => nf.format(n), pct: (x) => pf.format(x), date: (ts) => df.format(ts),
    };
  }, [locale, messages, info]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT() {
  const ctx = useContext(I18n);
  if (!ctx) throw new Error("useT() outside <I18nProvider>");
  return ctx;
}

/** For code that can't use hooks: the English text. */
export const enText = (key: MessageKey) => (en as Record<string, string>)[key] ?? key;
