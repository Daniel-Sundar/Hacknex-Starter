import { useEffect, useState } from "react";
import { Bot, Eye, FileText, MessageSquare, PenLine, ScanText } from "lucide-react";
import Chat from "./pages/Chat";
import Docs from "./pages/Docs";
import Agent from "./pages/Agent";
import Vision from "./pages/Vision";
import Handwriting from "./pages/Handwriting";
import { API } from "./lib/api";

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

  useEffect(() => {
    fetch(API + "/api/health").then((r) => r.json()).then((h) => setProvider(h.provider)).catch(() => setProvider("offline"));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScanText className="size-6 text-brand-soft" />
          <h1 className="text-xl font-bold text-ink">ClearScript</h1>
          <span className="text-sm text-muted">messy handwriting in, trusted text out</span>
        </div>
        <span className="neu rounded-full px-3 py-1 text-xs text-body">LLM: {provider}</span>
      </header>
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl glass p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm whitespace-nowrap transition ${tab === t.id ? "bg-brand-strong text-white shadow-md shadow-blue-600/20" : "text-muted hover:text-ink"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </nav>
      {/* All tabs stay mounted so switching tabs keeps their state. */}
      {TABS.map((t) => <div key={t.id} hidden={t.id !== tab}>{t.el}</div>)}
    </div>
  );
}
