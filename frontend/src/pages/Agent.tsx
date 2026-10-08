import { useState } from "react";
import Markdown from "react-markdown";
import { Wrench } from "lucide-react";
import { postJSON } from "../lib/api";
import { Button, Card, ErrorNote, inputCls } from "../components/ui";

type Step = { tool: string; args: unknown; result: string };

export default function Agent() {
  const [task, setTask] = useState("What is 17 * 23, and what time is it now?");
  const [res, setRes] = useState<{ answer: string; trace: Step[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRes(await postJSON("/api/agent", { text: task }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input className={inputCls} value={task} onChange={(e) => setTask(e.target.value)} />
        <Button loading={loading} type="submit">Run agent</Button>
      </form>
      <ErrorNote error={error} />
      {res && (
        <>
          <ol className="space-y-2">
            {res.trace.map((s, i) => (
              <li key={i} className="flex gap-3 rounded-xl well p-3 text-xs">
                <Wrench className="mt-0.5 size-4 shrink-0 text-brand-soft" />
                <div>
                  <p className="font-mono text-body">{s.tool}({JSON.stringify(s.args)})</p>
                  <p className="text-muted">→ {s.result.slice(0, 300)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-xl bg-line p-4 text-sm"><Markdown>{res.answer}</Markdown></div>
        </>
      )}
    </Card>
  );
}
