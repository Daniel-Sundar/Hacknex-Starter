import { useEffect, useState } from "react";
import { Feather, FileText, Moon, ScrollText, Sun } from "lucide-react";
import Docs from "./pages/Docs";
import Handwriting from "./pages/Handwriting";
import { API } from "./lib/api";
import { VideoIntro } from "./components/VideoIntro";
import "./styles/study.css";

// Each tab is a real link (#/clearscript, #/docs), so refresh, back/forward and shared links all land on the right view.
const TABS = [
  { id: "clearscript", label: "ClearScript", icon: Feather, el: <Handwriting />, blurb: "Upload a page, clean it, let every model read it, and compare against a single-model baseline." },
  { id: "docs", label: "Docs Q&A", icon: ScrollText, el: <Docs />, blurb: "Upload PDF or text files, then ask questions answered from those documents." },
];
type TabId = (typeof TABS)[number]["id"];
const tabFromHash = (): TabId => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return (TABS.find((t) => t.id === id)?.id ?? TABS[0].id) as TabId;
};

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [provider, setProvider] = useState<string>("…");
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const t = TABS.find((x) => x.id === tab)!;
    document.title = t.id === "clearscript" ? "ClearScript" : `${t.label} · ClearScript`;
  }, [tab]);

  useEffect(() => {
    fetch(API + "/api/health").then((r) => r.json()).then((h) => setProvider(h.provider)).catch(() => setProvider("offline"));
  }, []);

  useEffect(() => {
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("cs-theme", light ? "light" : "dark"); } catch { /* storage blocked: theme just won't persist */ }
  }, [light]);

  const online = provider !== "offline" && provider !== "…";

  // The intro renders outside the app shell, so the shell's styles never reach it.
  return (
    <>
      <VideoIntro />
      <div className={light ? "study" : "min-h-screen"}>
        <header className={`sticky top-0 z-20 ${light ? "study-header mat-walnut" : "border-b border-line bg-page/85 backdrop-blur"}`}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
            <a href="#/clearscript" className="imprint flex items-center gap-2" aria-label="ClearScript home">
              <span className="imprint-seal grid size-6 place-items-center rounded-md bg-brand text-white"><Feather className="size-3.5" /></span>
              <span>
                <span className="imprint-name font-display text-[16px] font-semibold tracking-[0.06em] text-ink">ClearScript</span>
                <span className="imprint-sub hidden">handwriting, read by many</span>
              </span>
            </a>
            <span className="study-sep hidden sm:block" aria-hidden="true" />
            <nav aria-label="Sections" className="flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <a key={t.id} href={`#/${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={`navtab flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === t.id ? "bg-brand-strong text-white" : "text-muted hover:bg-elev hover:text-ink"}`}>
                  <t.icon className="size-4" /> {t.label}
                </a>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <span className="chip-brass elev flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-body" title="Model provider">
                <span className={`size-1.5 rounded-full ${online ? "bg-[#6fae7f]" : "bg-[#c0565c]"}`} />
                {provider}
              </span>
              <button
                onClick={() => setLight((v) => !v)}
                aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
                title={light ? "Ravenclaw night" : "Scholar's study"}
                className="chip-brass elev grid size-7 place-items-center rounded-md !p-0 text-body hover:text-ink"
              >
                {light ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-3 py-6 sm:px-6 sm:py-8">
          <div className="manuscript px-4 py-6 sm:px-9 sm:py-9">
            <span className="corners-x" aria-hidden="true" />
            {/* All tabs stay mounted so switching tabs keeps their state. */}
            {TABS.map((t) => (
              <section key={t.id} hidden={t.id !== tab} aria-labelledby={`h-${t.id}`}>
                <div className="mb-6 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <h2 id={`h-${t.id}`} className="folio-title font-display text-[22px] font-semibold tracking-[0.04em] text-ink">{t.label}</h2>
                    <p className="folio-blurb font-serif text-[16px] italic text-muted">{t.blurb}</p>
                  </div>
                  <div className="rule-ornament hidden" aria-hidden="true"><span>◆</span></div>
                </div>
                {t.el}
              </section>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
