// Live progress of one Digitize run, built only from events the backend really sent
// (POST /api/handwriting/stream). Nothing here is estimated or animated on a timer.
import type { Options } from "./handwriting";

export type StageId = "prepare" | "clean" | "read" | "vote" | "context" | "safety" | "baseline";
export type StageState = "pending" | "active" | "done" | "skipped" | "failed";
export type ReaderState = "waiting" | "running" | "done" | "failed" | "timeout";
export type Reader = { slot: number; model: string; state: ReaderState; error?: string; ms?: number; replaced: string[] };

export type Run = {
  stages: Record<StageId, StageState>;
  readers: Reader[];
  live: boolean;      // false = old backend without the stream: we only know it is waiting
  baseline: boolean;
};

export const STAGE_ORDER: StageId[] = ["prepare", "clean", "read", "vote", "context", "safety"];

export function newRun(o: Options): Run {
  return {
    stages: {
      prepare: "pending", clean: o.clean ? "pending" : "skipped", read: "pending", vote: "pending",
      context: o.context ? "pending" : "skipped", safety: "pending", baseline: o.baseline ? "pending" : "skipped",
    },
    readers: [],
    live: true,
    baseline: o.baseline,
  };
}

const READER_STATE: Record<string, ReaderState> = { start: "running", done: "done", failed: "failed", timeout: "timeout" };
const STAGE_STATE: Record<string, StageState> = { start: "active", done: "done", skipped: "skipped", failed: "failed" };

/** Apply one stream event. Unknown events are ignored, so an older or newer backend never breaks the UI. */
export function step(run: Run, ev: any): Run {
  if (!ev || typeof ev !== "object") return run;
  if (ev.type === "plan" && Array.isArray(ev.readers)) {
    return { ...run, readers: ev.readers.map((m: string, slot: number) => ({ slot, model: String(m), state: "waiting", replaced: [] })) };
  }
  if (ev.type === "stage" && ev.stage in run.stages && ev.status in STAGE_STATE) {
    return { ...run, stages: { ...run.stages, [ev.stage]: STAGE_STATE[ev.status] } };
  }
  if (ev.type === "reader" && typeof ev.slot === "number" && ev.status in READER_STATE) {
    const readers = [...run.readers];
    while (readers.length <= ev.slot) readers.push({ slot: readers.length, model: "", state: "waiting", replaced: [] });
    const r = { ...readers[ev.slot] };
    if (ev.status === "start" && r.model && ev.model && r.model !== ev.model && r.state !== "waiting") {
      r.replaced = [...r.replaced, r.model]; // a spare model stood in for one that failed
    }
    if (ev.model) r.model = String(ev.model);
    r.state = READER_STATE[ev.status];
    r.error = ev.error ? String(ev.error) : ev.status === "start" ? undefined : r.error;
    r.ms = typeof ev.ms === "number" ? ev.ms : r.ms;
    readers[ev.slot] = r;
    return { ...run, readers };
  }
  return run;
}

/** Short display name: "groq:qwen/qwen3.8-27b" -> "qwen3.8-27b (groq)". */
export function modelLabel(name: string): string {
  const [provider, ...rest] = name.split(":");
  const model = rest.join(":").replace(/:free$/, "");
  if (!model) return provider;
  return `${model.split("/").pop()} (${provider})`;
}
