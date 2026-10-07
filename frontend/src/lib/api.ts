export const API = import.meta.env.VITE_API_URL ?? "";

export async function postJSON<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

export async function postForm<T = any>(path: string, form: FormData): Promise<T> {
  const r = await fetch(API + path, { method: "POST", body: form });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

/** Streams plain-text chunks from /api/chat. */
export async function streamChat(
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  system?: string,
) {
  const r = await fetch(API + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system }),
  });
  if (!r.ok || !r.body) throw new Error(`${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
