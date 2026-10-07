import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { Send } from "lucide-react";
import { streamChat } from "../lib/api";
import { Button, Card, ErrorNote, inputCls } from "../components/ui";

type Msg = { role: "user" | "assistant"; content: string };

// Change this to give the assistant your problem's persona.
const SYSTEM = "You are a helpful, concise assistant.";

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function send() {
    if (!input.trim()) return;
    const next: Msg[] = [...messages, { role: "user", content: input }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      await streamChat(next, (chunk) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
        bottom.current?.scrollIntoView({ behavior: "smooth" });
      }, SYSTEM);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="flex h-[70vh] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="text-sm text-zinc-500">Ask anything to get started.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-brand text-white" : "bg-zinc-800"}`}>
              <Markdown>{m.content || "…"}</Markdown>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <ErrorNote error={error} />
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message…" />
        <Button loading={loading} type="submit"><Send className="size-4" /></Button>
      </form>
    </Card>
  );
}
