// History lives only in this browser (localStorage). No server copy, nothing invented: an entry is a
// result the user really got, with their corrections. The original image is not kept (too large);
// a small thumbnail is.
import type { HwResult, Word } from "./handwriting";

export type HistoryEntry = {
  id: string;
  ts: number;          // when it was digitized
  updated?: number;    // last correction
  name: string;        // file name
  thumb?: string;
  result: HwResult;
  words: Word[];       // current words, with corrections
};

const KEY = "cs-history";
export const HISTORY_MAX = 20;
const MAX_CHARS = 2_500_000; // stay well inside the ~5 MB localStorage quota

export function loadHistory(): HistoryEntry[] {
  try {
    const xs = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(xs) ? xs.filter((x) => x && x.id && x.result && Array.isArray(x.words)) : [];
  } catch {
    return [];
  }
}

/** Saves the list, dropping the oldest entries if it gets too big. Returns false if storage is unavailable. */
export function saveHistory(xs: HistoryEntry[]): boolean {
  let list = xs.slice(0, HISTORY_MAX);
  for (;;) {
    const json = JSON.stringify(list);
    if (json.length <= MAX_CHARS || list.length <= 1) {
      try {
        localStorage.setItem(KEY, json);
        return true;
      } catch {
        if (list.length <= 1) return false;
      }
    }
    list = list.slice(0, -1);
  }
}

/** New entries go first; an existing entry (corrections saved) keeps its place. */
export function upsert(xs: HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  return xs.some((x) => x.id === e.id) ? xs.map((x) => (x.id === e.id ? e : x)) : [e, ...xs].slice(0, HISTORY_MAX);
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
