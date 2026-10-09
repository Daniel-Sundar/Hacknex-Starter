// Documents state for Docs Q&A: the loaded list (GET /api/docs), a one-at-a-time upload queue with honest
// per-file states, and removing one or all documents.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, del, getJSON, postForm } from "../../lib/api";
import type { Problem } from "../../lib/errors";
import { useHealth } from "../../lib/health";
import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { checkDoc, describeDocsError, type DocInfo, type UploadResult } from "./lib";

export type Upload = { id: number; name: string; status: "waiting" | "uploading" | "failed"; problem?: Problem };
export type ListStatus = "loading" | "ready" | "error";

/** Screen-reader announcements, batched: several files finishing at once are read as one message. */
export function useAnnouncer() {
  const { announce } = useToast();
  const pending = useRef<string[]>([]);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback((message: string) => {
    pending.current.push(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      announce(pending.current.join(" "));
      pending.current = [];
    }, 300);
  }, [announce]);
}

export function useDocuments() {
  const { t, tn } = useT();
  const limitMb = useHealth().limits.docsMaxUploadMb;
  const say = useAnnouncer();

  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [list, setList] = useState<ListStatus>("loading");
  const [listError, setListError] = useState<unknown>(null);
  const [serverList, setServerList] = useState(true); // false: an older backend without GET /api/docs
  const [notes, setNotes] = useState<Record<string, "added" | "replaced">>({});
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [removeError, setRemoveError] = useState<{ error: unknown; source: string } | null>(null);

  // The async upload loop reads these through a ref so it always sees the latest values.
  const latest = useRef({ t, tn, say, limitMb, docs });
  latest.current = { t, tn, say, limitMb, docs };
  const files = useRef(new Map<number, File>());
  const queue = useRef<number[]>([]);
  const running = useRef(false);
  const nextId = useRef(1);
  const version = useRef(0); // bumped on every local change, so a slower list response can't undo it
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (quiet = false) => {
    const started = version.current;
    if (!quiet) setList("loading");
    setListError(null);
    try {
      const r = await getJSON<{ docs?: DocInfo[] }>("/api/docs");
      if (!alive.current) return;
      if (version.current !== started) { void load(true); return; }
      setDocs(Array.isArray(r.docs) ? r.docs : []);
      setServerList(true);
      setList("ready");
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 404) {
        // Older backend: keep track of what was uploaded in this session instead.
        setServerList(false);
        setList("ready");
      } else {
        setListError(e);
        setList("error");
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setUpload = (id: number, patch: Partial<Upload>) =>
    setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const fail = (id: number, name: string, problem: Problem) => {
    setUpload(id, { status: "failed", problem });
    const { t: tt, say: s } = latest.current;
    s(tt("docs.upload.failed", { name, reason: tt(problem.title, problem.vars) }));
  };

  async function uploadOne(id: number) {
    const file = files.current.get(id);
    if (!file) return;
    setUpload(id, { status: "uploading", problem: undefined });
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await postForm<UploadResult>("/api/docs/upload", form);
      const name = r.file || file.name;
      const chunks = Number(r.chunks) || 0;
      const replaced = r.replaced ?? latest.current.docs.some((d) => d.source === name);
      version.current++;
      setDocs((ds) => (ds.some((d) => d.source === name)
        ? ds.map((d) => (d.source === name ? { source: name, chunks } : d))
        : [...ds, { source: name, chunks }]));
      setNotes((n) => ({ ...n, [name]: replaced ? "replaced" : "added" }));
      setUploads((us) => us.filter((u) => u.id !== id));
      files.current.delete(id);
      const { t: tt, tn: ttn, say: s } = latest.current;
      s(tt(r.read_by === "handwriting" ? "docs.upload.doneHand" : "docs.upload.done", { name, passages: ttn("docs.files.passages", chunks) }));
    } catch (e) {
      fail(id, file.name, describeDocsError(e, latest.current.limitMb));
    }
  }

  async function pump() {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) await uploadOne(queue.current.shift()!);
    } finally {
      running.current = false;
    }
  }

  /** Check each file, then queue the good ones. Files upload one at a time, in the order given. */
  async function add(picked: File[]) {
    const checks = await Promise.all(picked.map((f) => checkDoc(f, latest.current.limitMb)));
    const items: Upload[] = picked.map((f, i) => {
      const id = nextId.current++;
      files.current.set(id, f);
      return { id, name: f.name, status: checks[i] ? "failed" : "waiting", problem: checks[i] ?? undefined };
    });
    setUploads((us) => [...us, ...items]);
    items.forEach((u) => {
      if (u.problem) fail(u.id, u.name, u.problem);
      else queue.current.push(u.id);
    });
    void pump();
  }

  function retry(id: number) {
    if (!files.current.has(id)) return;
    setUpload(id, { status: "waiting", problem: undefined });
    queue.current.push(id);
    void pump();
  }

  function dismiss(id: number) {
    files.current.delete(id);
    setUploads((us) => us.filter((u) => u.id !== id));
  }

  const forget = (source: string) => {
    version.current++;
    setDocs((ds) => ds.filter((d) => d.source !== source));
    setNotes(({ [source]: _gone, ...rest }) => rest);
  };

  /** true when the document is gone (removed now, or already gone on the server). */
  async function remove(source: string): Promise<boolean> {
    setRemoving((r) => [...r, source]);
    setRemoveError(null);
    try {
      await del(`/api/docs/${encodeURIComponent(source)}`);
      forget(source);
      say(t("docs.files.removed", { name: source }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_found") {
        forget(source);
        void load(true); // the list was out of date; fetch the real one
        return true;
      }
      setRemoveError({ error: e, source });
      return false;
    } finally {
      setRemoving((r) => r.filter((s) => s !== source));
    }
  }

  /** Throws on failure so the confirmation dialog can show the error. */
  async function clear() {
    await del("/api/docs");
    version.current++;
    setDocs([]);
    setNotes({});
    setRemoveError(null);
    say(t("docs.clear.done"));
  }

  return {
    docs, list, listError, serverList, notes, uploads, removing, removeError, limitMb,
    load, add, retry, dismiss, remove, clear, clearRemoveError: () => setRemoveError(null),
  };
}

export type DocumentsState = ReturnType<typeof useDocuments>;
