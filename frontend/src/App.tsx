import { useEffect, useState } from "react";
import { FileText, Moon, PenLine, ScanText, Sun } from "lucide-react";
import Docs from "./pages/Docs";
import Handwriting from "./pages/Handwriting";
import { API } from "./lib/api";
import { PenIntro } from "./components/PenAnimation";

// Each tab is a real link (#/clearscript, #/docs), so refresh, back/forward and shared links all land on the right view.
const TABS = [
  { id: "clearscript", label: "ClearScript", icon: PenLine, el: <Handwriting />, blurb: "Upload a page, clean it, let every model read it, and compare against a single-model baseline." },
  { id: "docs", label: "Docs Q&A", icon: FileText, el: <Docs />, blurb: "Upload PDF or text files, then ask questions answered from those documents." },
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

  return (
    <div className="min-h-screen">
      <PenIntro />
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-brand text-white"><ScanText className="size-3.5" /></span>
            <a href="#/clearscript" className="font-display text-[16px] font-semibold tracking-[0.06em] text-ink">ClearScript</a>
          </div>
          <nav aria-label="Sections" className="flex gap-0.5 overflow-x-auto">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#/${t.id}`}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium tracking-tight whitespace-nowrap transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === t.id ? "bg-brand-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]" : "text-muted hover:bg-elev hover:text-ink"}`}
              >
                <t.icon className="size-3.5" /> {t.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="elev flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-body">
              <span className={`size-1.5 rounded-full ${online ? "bg-ok" : "bg-del-fg"}`} />
              {provider}
            </span>
            <button
              onClick={() => setLight((v) => !v)}
              aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
              title={light ? "Dark theme" : "Light theme"}
              className="elev grid size-7 place-items-center rounded-md text-body hover:text-ink"
            >
              {light ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* All tabs stay mounted so switching tabs keeps their state. */}
        {TABS.map((t) => (
          <section key={t.id} hidden={t.id !== tab} aria-labelledby={`h-${t.id}`}>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`h-${t.id}`} className="font-display text-[20px] font-semibold tracking-[0.04em] text-ink">{t.label}</h2>
              <p className="font-serif text-[16px] italic text-muted">{t.blurb}</p>
            </div>
            {t.el}
          </section>
        ))}
      </main>
    </div>
  );
}
