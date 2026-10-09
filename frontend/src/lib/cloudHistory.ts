// History for signed-in users, in the Supabase table public.history (see backend/supabase.sql). Row-level
// security lets each user see only their own rows. Same HistoryEntry shape as the browser-only history
// (lib/history.ts), so the UI doesn't care where an entry lives.
import { supabase } from "./supabase";
import { stats } from "./handwriting";
import type { HistoryEntry } from "./history";

export const CLOUD_MAX = 100;
const MAX_CHARS = 2_000_000;

type Row = {
  id: string; user_id: string; ts: number; updated: number | null; name: string; thumb: string | null;
  doc_type: string; flagged: number; payload: { result: HistoryEntry["result"]; words: HistoryEntry["words"] };
};

const db = () => supabase!.from("history");

function toRow(uid: string, e: HistoryEntry): Row {
  const payload = { result: e.result, words: e.words };
  const size = JSON.stringify(payload).length;
  if (size > MAX_CHARS) throw new Error("This result is too large to save to your account.");
  return {
    id: e.id, user_id: uid, ts: e.ts, updated: e.updated ?? null, name: e.name,
    thumb: size + (e.thumb?.length ?? 0) > MAX_CHARS ? null : e.thumb ?? null,
    doc_type: e.result.doc_type ?? "note", flagged: stats(e.words, e.result).flagged, payload,
  };
}

function fromRow(r: Row): HistoryEntry | null {
  const { result, words } = r.payload ?? {};
  if (!result || !Array.isArray(words)) return null;
  return { id: r.id, ts: r.ts, updated: r.updated ?? undefined, name: r.name, thumb: r.thumb ?? undefined, result, words };
}

// Changes made in this tab reload the list; other devices see them on their next load.
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** List, newest first. Calls `onData` again after every save or delete from this tab. */
export function watchHistory(uid: string, onData: (xs: HistoryEntry[]) => void, onError: (e: unknown) => void) {
  let live = true;
  const load = async () => {
    const { data, error } = await db().select("*").eq("user_id", uid).order("ts", { ascending: false }).limit(CLOUD_MAX);
    if (!live) return;
    if (error) onError(error);
    else onData((data as Row[]).map(fromRow).filter((x): x is HistoryEntry => !!x));
  };
  listeners.add(load);
  load();
  return () => { live = false; listeners.delete(load); };
}

const ok = (r: { error: unknown }) => { if (r.error) throw r.error; };

export async function saveCloudEntry(uid: string, e: HistoryEntry) {
  ok(await db().upsert(toRow(uid, e)));
  changed();
}

export async function deleteCloudEntry(uid: string, id: string) {
  ok(await db().delete().eq("user_id", uid).eq("id", id));
  changed();
}

/** Writes (or deletes) many entries at once. */
export async function batchCloud(uid: string, save: HistoryEntry[], remove: string[] = []) {
  for (let i = 0; i < save.length; i += 50) ok(await db().upsert(save.slice(i, i + 50).map((e) => toRow(uid, e))));
  if (remove.length) ok(await db().delete().eq("user_id", uid).in("id", remove));
  changed();
}
