// History for signed-in users, in Firestore at users/{uid}/history/{entryId}. Same HistoryEntry shape as
// the browser-only history (lib/history.ts), so the UI doesn't care where an entry lives.
//
// The result and words are stored as one JSON string: Firestore rejects some shapes our results can have
// (empty map keys in `votes`, undefined values), and a string round-trips exactly. The small fields beside
// it are what the Firebase console shows at a glance.
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc, writeBatch, type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { stats } from "./handwriting";
import type { HistoryEntry } from "./history";

export const CLOUD_MAX = 100;
const DOC_LIMIT = 1_000_000; // Firestore's limit is 1 MiB per document; leave room for the other fields

type Stored = {
  id: string; ts: number; updated?: number; name: string; thumb?: string;
  docType: string; flagged: number; payload: string;
};

const col = (uid: string) => collection(db!, "users", uid, "history");

function toDoc(e: HistoryEntry): Stored {
  const payload = JSON.stringify({ result: e.result, words: e.words });
  const thumb = payload.length + (e.thumb?.length ?? 0) > DOC_LIMIT ? undefined : e.thumb;
  if (payload.length > DOC_LIMIT) throw new Error("This result is too large to save to your account.");
  return {
    id: e.id, ts: e.ts, updated: e.updated, name: e.name, thumb,
    docType: e.result.doc_type ?? "note", flagged: stats(e.words, e.result).flagged, payload,
  };
}

function fromDoc(d: DocumentData): HistoryEntry | null {
  try {
    const { result, words } = JSON.parse(d.payload);
    if (!result || !Array.isArray(words)) return null;
    return { id: d.id, ts: d.ts, updated: d.updated, name: d.name, thumb: d.thumb, result, words };
  } catch {
    return null;
  }
}

/** Live list, newest first. Calls `onData` again whenever this account's history changes on any device. */
export function watchHistory(uid: string, onData: (xs: HistoryEntry[]) => void, onError: (e: unknown) => void) {
  const q = query(col(uid), orderBy("ts", "desc"), limit(CLOUD_MAX));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => fromDoc(d.data())).filter((x): x is HistoryEntry => !!x)), onError);
}

export const saveCloudEntry = (uid: string, e: HistoryEntry) => setDoc(doc(col(uid), e.id), toDoc(e));

export const deleteCloudEntry = (uid: string, id: string) => deleteDoc(doc(col(uid), id));

/** Writes (or deletes) many entries at once; Firestore batches hold up to 500 writes. */
export async function batchCloud(uid: string, save: HistoryEntry[], remove: string[] = []) {
  const ops = [...save.map((e) => ({ e })), ...remove.map((id) => ({ id }))];
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db!);
    for (const op of ops.slice(i, i + 450)) {
      if ("e" in op) b.set(doc(col(uid), op.e.id), toDoc(op.e));
      else b.delete(doc(col(uid), op.id));
    }
    await b.commit();
  }
}
