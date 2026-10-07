import { useState } from "react";
import Markdown from "react-markdown";
import { FileUp } from "lucide-react";
import { postForm, postJSON } from "../lib/api";
import { Button, Card, ErrorNote, inputCls } from "../components/ui";

type Source = { source: string; text: string };

export default function Docs() {
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; sources: Source[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list) return;
    setError(null);
    for (const f of Array.from(list)) {
      const form = new FormData();
      form.append("file", f);
      try {
        const r = await postForm("/api/docs/upload", form);
        setFiles((x) => [...x, `${r.file} (${r.chunks} chunks)`]);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      setAnswer(await postJSON("/api/docs/ask", { text: q }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400 hover:border-brand">
          <FileUp className="size-6" />
          Upload PDF or text files
          <input type="file" multiple accept=".pdf,.txt,.md,.csv" className="hidden" onChange={(e) => upload(e.target.files)} />
        </label>
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">{files.map((f) => <li key={f}>• {f}</li>)}</ul>
      </Card>
      <Card className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about your documents…" />
          <Button loading={loading} type="submit">Ask</Button>
        </form>
        <ErrorNote error={error} />
        {answer && (
          <>
            <div className="text-sm leading-relaxed"><Markdown>{answer.answer}</Markdown></div>
            <div className="space-y-2">
              {answer.sources.map((s, i) => (
                <details key={i} className="rounded-lg bg-zinc-950 p-2 text-xs text-zinc-400">
                  <summary className="cursor-pointer">[{i + 1}] {s.source}</summary>
                  <p className="mt-1">{s.text}</p>
                </details>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
