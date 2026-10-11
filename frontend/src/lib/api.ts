import { supabase } from "./supabase";

export const API = import.meta.env.VITE_API_URL ?? "";

// Who is calling. The server keeps Docs Q&A documents and writer profiles per caller:
// signed in, per account (the Supabase access token, checked by the server); signed out, per browser
// (a random id kept in localStorage, never shown or shared).
let memoryId = "";
function clientId(): string {
  try {
    const saved = localStorage.getItem("cs-client-id");
    if (saved && /^[A-Za-z0-9_-]{22,64}$/.test(saved)) return saved;
  } catch { /* storage blocked: an id for this tab only */ }
  if (!memoryId) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    memoryId = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  try { localStorage.setItem("cs-client-id", memoryId); } catch { /* private mode */ }
  return memoryId;
}

async function identity(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "X-Client-Id": clientId() };
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) h.Authorization = `Bearer ${data.session.access_token}`;
    } catch { /* no session: fall back to the browser id */ }
  }
  return h;
}

/** A failed request. `code` comes from the backend's {"detail": {"code", "message"}} errors, or is one of
 *  network | timeout | aborted | http when the request never got a structured answer. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public retryAfter?: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function toApiError(r: Response): Promise<ApiError> {
  const header = Number(r.headers.get("Retry-After"));
  let detail: unknown = null;
  const raw = await r.text().catch(() => "");
  try { detail = JSON.parse(raw)?.detail; } catch { detail = raw; }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    const retry = typeof d.retry_after === "number" ? d.retry_after : header || undefined;
    return new ApiError(String(d.code ?? "http"), String(d.message ?? r.statusText), r.status, retry, d);
  }
  // Our backend always answers with a JSON detail; a bare 502/503/504 comes from a proxy that couldn't reach it.
  if (r.status >= 502 && r.status <= 504) return new ApiError("network", "Can't reach the server", r.status);
  // FastAPI validation errors are a list; anything else is plain text
  const msg = Array.isArray(detail) ? "The request was not valid." : String(detail || r.statusText || "Request failed");
  const code = r.status === 429 ? "rate_limited" : r.status === 413 ? "too_large" : r.status === 415 ? "unsupported_type"
    : r.status >= 500 ? "server" : "http";
  return new ApiError(code, msg, r.status, header || undefined);
}

/** fetch() that turns every failure into an ApiError. */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let r: Response;
  try {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(await identity())) headers.set(k, v);
    r = await fetch(API + path, { ...init, headers });
  } catch (e) {
    if (e instanceof ApiError) throw e; // aborted with an ApiError reason (e.g. a timeout)
    if (init.signal?.aborted) {
      const reason = init.signal.reason;
      throw reason instanceof ApiError ? reason : new ApiError("aborted", "Request cancelled");
    }
    throw new ApiError("network", "Can't reach the server");
  }
  if (!r.ok) throw await toApiError(r);
  return r;
}

export async function getJSON<T = any>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request(path, { signal })).json();
}

export async function postJSON<T = any>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return r.json();
}

export async function postForm<T = any>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return (await request(path, { method: "POST", body: form, signal })).json();
}

export async function del<T = any>(path: string): Promise<T> {
  return (await request(path, { method: "DELETE" })).json();
}

/** Reads a newline-delimited JSON stream, calling onEvent for each object. If nothing arrives for
 *  `stallMs` the request is aborted with code "timeout". */
export async function streamNDJSON(
  path: string,
  init: RequestInit,
  onEvent: (e: any) => void,
  stallMs = 120_000,
): Promise<void> {
  const ctrl = new AbortController();
  const outer = init.signal;
  const onAbort = () => ctrl.abort(outer?.reason);
  outer?.addEventListener("abort", onAbort);
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => ctrl.abort(new ApiError("timeout", "No response from the server")), stallMs);
  };
  try {
    arm();
    const r = await request(path, { ...init, signal: ctrl.signal });
    if (!r.body) throw new ApiError("server", "Empty response");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        const reason = ctrl.signal.reason;
        throw reason instanceof ApiError ? reason : ctrl.signal.aborted ? new ApiError("aborted", "Request cancelled")
          : new ApiError("network", "The connection dropped");
      }
      if (chunk.done) break;
      arm();
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onEvent(JSON.parse(line));
      }
    }
    if (buf.trim()) onEvent(JSON.parse(buf));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
