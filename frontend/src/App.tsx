import { useEffect, useState } from "react";
import { Bot, Eye, FileText, MessageSquare, Moon, PenLine, ScanText, Sun } from "lucide-react";
import Chat from "./pages/Chat";
import Docs from "./pages/Docs";
import Agent from "./pages/Agent";
import Vision from "./pages/Vision";
import Handwriting from "./pages/Handwriting";
import { API } from "./lib/api";
import { PenIntro } from "./components/PenAnimation";

// Rename / reorder / delete tabs to fit tomorrow's problem statement.
const TABS = [
  { id: "clearscript", label: "ClearScript", icon: PenLine, el: <Handwriting /> },
  { id: "chat", label: "Chat", icon: MessageSquare, el: <Chat /> },
  { id: "docs", label: "Docs Q&A", icon: FileText, el: <Docs /> },
  { id: "agent", label: "Agent", icon: Bot, el: <Agent /> },
  { id: "vision", label: "Vision", icon: Eye, el: <Vision /> },
];

export default function App() {
  const [tab, setTab] = useState(TABS[0].id);
  const [provider, setProvider] = useState<string>("…");
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");

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
            <h1 className="text-[14px] font-semibold tracking-tight">ClearScript</h1>
          </div>
          <nav className="flex gap-0.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium tracking-tight whitespace-nowrap transition-all duration-150 ease-in-out ${tab === t.id ? "bg-brand-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]" : "text-muted hover:bg-elev hover:text-ink"}`}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
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
        {TABS.map((t) => <div key={t.id} hidden={t.id !== tab}>{t.el}</div>)}
      </main>
    </div>
  );
}
