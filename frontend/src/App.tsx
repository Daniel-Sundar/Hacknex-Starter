import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { FileQuestion, Languages, Loader2, Moon, ScanText, ShieldCheck, Sun } from "lucide-react";
import Handwriting from "./pages/Handwriting";
import { JournalIntro } from "./components/JournalIntro";
import { Dialog, IconButton, ToastProvider } from "./components/ui";
import { I18nProvider, LOCALES, useT, type LocaleCode, type MessageKey } from "./i18n";
import { HealthProvider, useHealth } from "./lib/health";
import { AuthProvider } from "./lib/auth";
import { firebaseEnabled } from "./lib/firebase";
import { AccountMenu } from "./components/AccountMenu";

// Docs Q&A (and its Markdown renderer) loads only when someone opens it.
const Docs = lazy(() => import("./pages/Docs"));

// Each tab is a real link (#/clearscript, #/docs), so refresh, back/forward and shared links land on the right view.
const TABS = [
  { id: "clearscript", icon: ScanText, label: "shell.tab.clearscript", title: "shell.page.clearscript.title", blurb: "shell.page.clearscript.blurb" },
  { id: "docs", icon: FileQuestion, label: "shell.tab.docs", title: "shell.page.docs.title", blurb: "shell.page.docs.blurb" },
] as const satisfies readonly { id: string; label: MessageKey; title: MessageKey; blurb: MessageKey; icon: unknown }[];
type TabId = (typeof TABS)[number]["id"];
const tabFromHash = (): TabId => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return TABS.find((t) => t.id === id)?.id ?? TABS[0].id;
};

export default function App() {
  // The intro renders outside the app shell, so the shell's styles never reach it.
  return (
    <>
      <JournalIntro />
      <I18nProvider>
        <HealthProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </HealthProvider>
      </I18nProvider>
    </>
  );
}

function Shell() {
  const { t, locale, dir, scriptFont } = useT();
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tabFromHash()]));
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  const [privacy, setPrivacy] = useState(false);
  const headings = useRef<Partial<Record<TabId, HTMLHeadingElement | null>>>({});
  const shownTab = useRef<TabId>(tab);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
    const info = TABS.find((x) => x.id === tab)!;
    document.title = tab === "clearscript" ? "ClearScript" : `${t(info.label)} · ClearScript`;
    // On a tab switch (not on first load), move focus to the new page's heading so screen readers hear where they are.
    if (shownTab.current !== tab) headings.current[tab]?.focus();
    shownTab.current = tab;
  }, [tab, t]);

  useEffect(() => {
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("cs-theme", light ? "light" : "dark"); } catch { /* storage blocked: theme just won't persist */ }
  }, [light]);

  const style = scriptFont ? ({ "--font-script": `"${scriptFont}", "Nirmala UI"` } as CSSProperties) : undefined;

  return (
    <div className="cs-app flex flex-col" lang={locale} dir={dir} style={style}>
      <ToastProvider>
        <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}
          className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
          {t("shell.skip")}
        </a>

        <header className="cs-desk-bar sticky top-0 z-30 border-b border-line bg-surface" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-6 sm:px-6">
            <a href="#/clearscript" className="flex min-h-10 items-center gap-2 rounded-md" aria-label={t("shell.home")}>
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg"><ScanText className="size-4" /></span>
              <span className="cs-wordmark text-base font-semibold tracking-tight text-ink">ClearScript</span>
            </a>
            <nav aria-label={t("shell.nav")} className="order-last w-full sm:order-none sm:w-auto">
              <ul className="flex gap-1">
                {TABS.map((x) => (
                  <li key={x.id} className="flex-1 sm:flex-none">
                    <a
                      href={`#/${x.id}`}
                      aria-current={tab === x.id ? "page" : undefined}
                      className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${tab === x.id ? "bg-accent-soft text-accent-text" : "text-body hover:bg-subtle hover:text-ink"}`}
                    >
                      <x.icon className="size-4" aria-hidden="true" /> {t(x.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="ms-auto flex items-center gap-1 sm:gap-2">
              <ServerStatus />
              <LanguagePicker />
              <IconButton
                label={light ? t("shell.theme.toDark") : t("shell.theme.toLight")}
                icon={light ? <Moon className="size-4" /> : <Sun className="size-4" />}
                onClick={() => setLight((v) => !v)}
              />
              <AccountMenu />
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="cs-sheet mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">
          {/* Visited tabs stay mounted so switching keeps their state. */}
          {TABS.map((x) => (
            <section key={x.id} hidden={x.id !== tab} aria-labelledby={`h-${x.id}`}>
              <div className="mb-6 space-y-1">
                <h1 id={`h-${x.id}`} tabIndex={-1} ref={(el) => { headings.current[x.id] = el; }} className="cs-title text-lg font-semibold text-ink outline-none">
                  {t(x.title)}
                </h1>
                <p className="max-w-prose text-sm text-muted">{t(x.blurb)}</p>
              </div>
              {visited.has(x.id) && (x.id === "clearscript" ? <Handwriting active={tab === "clearscript"} /> : (
                <Suspense fallback={<p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("common.loading")}</p>}>
                  <Docs />
                </Suspense>
              ))}
            </section>
          ))}
        </main>

        <footer className="cs-desk-bar border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted sm:px-6">
            <p className="max-w-prose">{t("shell.footer")}</p>
            <button type="button" onClick={() => setPrivacy(true)} className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 font-medium text-accent-text underline-offset-2 hover:underline">
              <ShieldCheck className="size-4" aria-hidden="true" /> {t("shell.privacy")}
            </button>
          </div>
        </footer>

        <Dialog open={privacy} onClose={() => setPrivacy(false)} title={t("shell.privacy.title")}>
          <ul className="list-disc space-y-2 ps-4 text-sm text-body">
            {(["models", "images", "writer", "history", "account", "docs", "medical"] as const)
              .filter((k) => k !== "account" || firebaseEnabled)
              .map((k) => <li key={k}>{t(`shell.privacy.${k}`)}</li>)}
          </ul>
        </Dialog>
      </ToastProvider>
    </div>
  );
}

function ServerStatus() {
  const { t } = useT();
  const h = useHealth();
  const label = t(`shell.status.${h.state}`);
  const dot = h.state === "online" ? "bg-ok-fg" : h.state === "offline" ? "bg-danger-fg" : "bg-muted";
  return (
    <span role="status" title={h.provider ? `${label}. ${t("shell.status.detail", { provider: h.provider })}` : label}
      className="flex min-h-10 items-center gap-2 rounded-md px-2 text-xs text-body">
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      <span className="max-sm:sr-only">{label}</span>
    </span>
  );
}

function LanguagePicker() {
  const { t, locale, setLocale } = useT();
  return (
    <label className="flex min-h-10 items-center gap-1 rounded-md border border-line-strong bg-surface ps-2 text-sm text-ink" title={t("shell.language.draft")}>
      <Languages className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="sr-only">{t("shell.language")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleCode)}
        className="min-h-10 max-w-24 cursor-pointer appearance-none bg-transparent pe-2 text-sm text-ink outline-none sm:max-w-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>{l.code === "en" ? l.native : `${l.native} (${l.english})`}</option>
        ))}
      </select>
    </label>
  );
}
