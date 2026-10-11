import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { FileQuestion, Languages, Loader2, Menu, Moon, ScanText, Sun, X } from "lucide-react";
import { Legal, type LegalPage } from "./pages/Legal";
import Handwriting from "./pages/Handwriting";
import { IconButton, ToastProvider } from "./components/ui";
import { I18nProvider, LOCALES, useT, type LocaleCode, type MessageKey } from "./i18n";
import { HealthProvider, useHealth } from "./lib/health";
import { AuthProvider, useAuth } from "./lib/auth";
import { AccountMenu } from "./components/AccountMenu";
import { LoginPage } from "./pages/Login";

// Docs Q&A (and its Markdown renderer) loads only when someone opens it.
const Docs = lazy(() => import("./pages/Docs"));

// Each tab is a real link (#/clearscript, #/docs), so refresh, back/forward and shared links land on the right view.
const TABS = [
  { id: "clearscript", icon: ScanText, label: "shell.tab.clearscript", title: "shell.page.clearscript.title", blurb: "shell.page.clearscript.blurb" },
  { id: "docs", icon: FileQuestion, label: "shell.tab.docs", title: "shell.page.docs.title", blurb: "shell.page.docs.blurb" },
] as const satisfies readonly { id: string; label: MessageKey; title: MessageKey; blurb: MessageKey; icon: unknown }[];
type TabId = (typeof TABS)[number]["id"];
const hashId = () => window.location.hash.replace(/^#\/?/, "");
const tabFromHash = (): TabId => TABS.find((t) => t.id === hashId())?.id ?? TABS[0].id;
// #/privacy and #/terms are full pages; the tabs stay mounted underneath so their state survives a visit.
const legalFromHash = (): LegalPage | null => (hashId() === "privacy" || hashId() === "terms" ? hashId() as LegalPage : null);

export default function App() {
  return (
    <I18nProvider>
      <HealthProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </HealthProvider>
    </I18nProvider>
  );
}

function Shell() {
  const { t, locale, dir, scriptFont } = useT();
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [legal, setLegal] = useState<LegalPage | null>(legalFromHash);
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tabFromHash()]));
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  const [menuOpen, setMenuOpen] = useState(false); // phone/tablet menu; the desktop sidebar is always open
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const headings = useRef<Partial<Record<TabId, HTMLHeadingElement | null>>>({});
  const shownTab = useRef<TabId>(tab);
  const firstLoad = useRef(true);

  useEffect(() => {
    const onHash = () => {
      setMenuOpen(false);
      const page = legalFromHash();
      setLegal(page);
      if (!page) setTab(tabFromHash());
      else window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!legal) return;
    document.title = `${t(legal === "privacy" ? "legal.privacy.title" : "legal.terms.title")} · ClearScript`;
    if (!firstLoad.current) document.getElementById("h-legal")?.focus(); // like a tab switch; not on first load
    return () => { shownTab.current = tab; };
  }, [legal, t, tab]);
  useEffect(() => { firstLoad.current = false; }, []);

  useEffect(() => {
    if (legal) return;
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
    const info = TABS.find((x) => x.id === tab)!;
    document.title = tab === "clearscript" ? "ClearScript" : `${t(info.label)} · ClearScript`;
    // On a tab switch (not on first load), move focus to the new page's heading so screen readers hear where they are.
    if (shownTab.current !== tab) headings.current[tab]?.focus();
    shownTab.current = tab;
  }, [tab, t, legal]);

  // The theme follows the OS (theme-init.js) until the person presses the toggle; then their choice is kept.
  const toggleTheme = () => setLight((v) => {
    try { localStorage.setItem("cs-theme", v ? "dark" : "light"); } catch { /* storage blocked: choice lasts this visit */ }
    return !v;
  });
  useEffect(() => {
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    // Keep the browser chrome (mobile address bar) on the chosen theme's background, not just the OS one.
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-page").trim();
    if (bg) document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = bg; });
  }, [light]);

  const style = scriptFont ? ({ "--font-script": `"${scriptFont}", "Nirmala UI"` } as CSSProperties) : undefined;
  const { enabled, ready, user, guest } = useAuth();

  // With Supabase configured, the login page comes first (until signed in, or "continue without an account").
  if (enabled && (!ready || (!user && !guest)) && !legal) {
    return (
      <div className="cs-app flex flex-col" lang={locale} dir={dir} style={style}>
        <ToastProvider>
          {ready ? <LoginPage /> : <div className="grid min-h-dvh place-items-center"><Loader2 className="size-6 animate-spin text-muted" aria-label={t("common.loading")} /></div>}
        </ToastProvider>
      </div>
    );
  }

  return (
    <div className="cs-app flex flex-col" lang={locale} dir={dir} style={style}>
      <ToastProvider>
        <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}
          className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
          {t("shell.skip")}
        </a>

        {/* Desktop (lg): a floating forest-green rail. Phones and tablets: the same element is a compact bar of green glass
            whose navigation and controls drop down as a drawer over a dimmed page. */}
        {menuOpen && <div aria-hidden="true" className="cs-scrim fixed inset-0 z-20 bg-[rgb(24_25_48/0.32)] backdrop-blur-[3px] lg:hidden" onClick={() => setMenuOpen(false)} />}
        <header className="cs-bar sticky top-0 z-30 lg:fixed lg:inset-y-3 lg:start-3 lg:w-60"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6 lg:h-full lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-6 lg:px-4 lg:py-6">
            <a href="#/clearscript" className="flex min-h-10 items-center gap-2 rounded-md lg:px-2" aria-label={t("shell.home")}>
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-[0.625rem] bg-white text-[var(--color-side)] shadow-[inset_0_-1px_0_rgb(0_0_0/0.08),0_2px_8px_rgb(8_14_9/0.35)]"><ScanText className="size-4" /></span>
              <span className="cs-wordmark text-base text-side-fg lg:text-lg">ClearScript</span>
            </a>
            <IconButton
              className="ms-auto !text-side-fg hover:!bg-side-hover lg:hidden"
              label={menuOpen ? t("shell.menu.close") : t("shell.menu.open")}
              aria-expanded={menuOpen}
              aria-controls="cs-menu"
              icon={menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              onClick={() => setMenuOpen((v) => !v)}
            />
            <div id="cs-menu" className={`${menuOpen ? "flex" : "hidden"} cs-drawer absolute inset-x-3 top-full mt-2 flex-col gap-3 rounded-2xl p-3 lg:static lg:mt-0 lg:flex lg:flex-1 lg:gap-6 lg:rounded-none lg:p-0`}>
              <nav aria-label={t("shell.nav")}>
                <ul className="flex flex-col gap-1">
                  {TABS.map((x) => (
                    <li key={x.id}>
                      <a
                        href={`#/${x.id}`}
                        aria-current={!legal && tab === x.id ? "page" : undefined}
                        onClick={() => setMenuOpen(false)}
                        className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${!legal && tab === x.id ? "cs-nav-active font-semibold text-side-fg" : "text-side-muted hover:bg-side-hover hover:text-side-fg"}`}
                      >
                        <x.icon className="size-4" aria-hidden="true" /> {t(x.label)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="flex flex-wrap items-center gap-2 border-t border-side-line pt-3 lg:mt-auto lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-1 lg:pt-4">
                <ServerStatus />
                <LanguagePicker />
                <div className="ms-auto flex items-center gap-2 lg:ms-0 lg:justify-between">
                  <IconButton
                    className="!text-side-fg hover:!bg-side-hover"
                    label={light ? t("shell.theme.toDark") : t("shell.theme.toLight")}
                    icon={light ? <Moon className="size-4" /> : <Sun className="size-4" />}
                    onClick={toggleTheme}
                  />
                  <AccountMenu />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col lg:ps-[15.75rem]">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[85rem] flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8">
          {legal && (
            <section aria-labelledby="h-legal">
              <h1 id="h-legal" tabIndex={-1} className="cs-on-canvas cs-title mx-auto mb-6 max-w-[62rem] outline-none">
                {t(legal === "privacy" ? "legal.privacy.title" : "legal.terms.title")}
              </h1>
              <Legal page={legal} />
            </section>
          )}
          {/* Visited tabs stay mounted so switching keeps their state. */}
          {TABS.map((x) => (
            <section key={x.id} hidden={!!legal || x.id !== tab} aria-labelledby={`h-${x.id}`}>
              <div className="cs-on-canvas mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 max-w-prose space-y-1">
                  <h1 id={`h-${x.id}`} tabIndex={-1} ref={(el) => { headings.current[x.id] = el; }} className="cs-title outline-none">
                    {t(x.title)}
                  </h1>
                  <p className="text-sm text-muted sm:text-base">{t(x.blurb)}</p>
                </div>
                {x.id === "clearscript" && <div id="cs-page-tools" className="flex shrink-0" />}
              </div>
              {visited.has(x.id) && (x.id === "clearscript" ? <Handwriting active={tab === "clearscript"} /> : (
                <Suspense fallback={<p className="cs-on-canvas flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("common.loading")}</p>}>
                  <Docs />
                </Suspense>
              ))}
            </section>
          ))}
        </main>

        <footer className="cs-on-canvas border-t border-white/15">
          <div className="mx-auto flex max-w-[85rem] flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted sm:px-6 lg:px-8" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}>
            <p className="max-w-prose">{t("shell.footer")}</p>
            <nav aria-label={t("legal.nav")} className="flex flex-wrap items-center gap-1">
              <a href="#/privacy" aria-current={legal === "privacy" ? "page" : undefined}
                className="inline-flex min-h-10 items-center rounded-md px-2 font-medium text-body underline-offset-2 hover:text-ink hover:underline">
                {t("legal.footer.privacy")}
              </a>
              <a href="#/terms" aria-current={legal === "terms" ? "page" : undefined}
                className="inline-flex min-h-10 items-center rounded-md px-2 font-medium text-body underline-offset-2 hover:text-ink hover:underline">
                {t("legal.footer.terms")}
              </a>
            </nav>
          </div>
        </footer>
        </div>
      </ToastProvider>
    </div>
  );
}

function ServerStatus() {
  const { t } = useT();
  const h = useHealth();
  const label = t(`shell.status.${h.state}`);
  // Light dots with a white ring so they read on the green bar; the label carries the meaning too.
  const dot = h.state === "online" ? "bg-[#4cc38a]" : h.state === "offline" ? "bg-[#f0787d]" : "bg-side-muted";
  return (
    <span role="status" title={h.provider ? `${label}. ${t("shell.status.detail", { provider: h.provider })}` : label}
      className="flex min-h-10 items-center gap-2 rounded-md px-2 text-xs text-side-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ring-2 ring-white/60 ${dot}`} />
      <span className="max-sm:sr-only">{label}</span>
    </span>
  );
}

function LanguagePicker() {
  const { t, locale, setLocale } = useT();
  return (
    <label className="flex min-h-10 items-center gap-1 rounded-md ps-2 text-sm text-side-fg hover:bg-side-hover" title={t("shell.language.draft")}>
      <Languages className="size-4 shrink-0 text-side-muted" aria-hidden="true" />
      <span className="sr-only">{t("shell.language")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleCode)}
        className="min-h-10 max-w-24 cursor-pointer appearance-none bg-transparent pe-2 text-sm text-side-fg outline-none sm:max-w-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>{l.code === "en" ? l.native : `${l.native} (${l.english})`}</option>
        ))}
      </select>
    </label>
  );
}
