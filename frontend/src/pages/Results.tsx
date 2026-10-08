import { useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { API } from "../lib/api";
import { Card, ErrorNote } from "../components/ui";

// Shape of GET /api/handwriting/eval (written by backend/eval.py).
type Totals = { char_edits: number; ref_chars: number; word_edits: number; ref_words: number; wrong: number; flagged: number; flagged_wrong: number };
type Bucket = { words: number; right: number };
type EvalData = {
  ablation: { split: string; samples?: number; totals: Record<string, Totals>; calibration?: Record<string, Record<string, Bucket>> } | null;
  ablation_split: string | null;
  robustness: { split: string; samples?: number; results: Record<string, Record<string, Totals>> } | null;
  robustness_split: string | null;
  fallback: boolean;
};

const OURS = "clean + vote + context";
const BUCKETS = ["all agree (1.0)", "most agree (0.67-0.99)", "half agree (0.50-0.66)", "few agree (<0.50)"];
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const confident = (t: Totals) => t.wrong - t.flagged_wrong;

export default function Results() {
  const [data, setData] = useState<EvalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(API + "/api/handwriting/eval");
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setData(await r.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const ab = data?.ablation;
  const words = ab ? Object.values(ab.totals)[0]?.ref_words ?? 0 : 0;
  const calib = ab?.calibration?.[OURS] ?? ab?.calibration?.["clean + vote"];
  const rb = data?.robustness;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {ab && (
          <p className="text-[13px] text-body">
            <span className="font-mono text-ink">{ab.samples ?? "?"}</span> handwriting samples,{" "}
            <span className="font-mono text-ink">{words}</span> ground-truth words, split{" "}
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] uppercase">{data?.ablation_split}</span>
            {data?.fallback && <span className="ml-2 text-warn-fg">Held-out test results not run yet: showing the dev split.</span>}
          </p>
        )}
        <button onClick={load} disabled={loading} className="btn-wood elev ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-body hover:text-ink disabled:opacity-50">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Reload
        </button>
      </div>
      <ErrorNote error={error} />
      {loading && !data && <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> Loading results…</p>}
      {data && !ab && <p className="text-[13px] text-muted">No results yet. Run <span className="font-mono">eval.py</span> in backend/.</p>}

      {ab && (
        <Card>
          <h3 className="title mb-1">Ablation: what each stage adds</h3>
          <p className="mb-3 text-[12px] text-muted">
            CER / WER: share of characters / words read wrong (case and punctuation ignored). Confident errors: wrong words
            that were not flagged. Flag recall: share of wrong words that got flagged.
          </p>
          <Table
            head={["Variant", "CER ↓", "WER ↓", "Confident errors ↓", "Flagged", "Flag precision ↑", "Flag recall ↑"]}
            rows={Object.entries(ab.totals).map(([v, t]) => ({
              key: v, highlight: v === OURS,
              cells: [v, pct(t.char_edits, t.ref_chars), pct(t.word_edits, t.ref_words), confident(t), t.flagged,
                pct(t.flagged_wrong, t.flagged), pct(t.flagged_wrong, t.wrong)],
            }))}
          />
        </Card>
      )}

      {calib && (
        <Card>
          <h3 className="title mb-1">Calibration: is reader agreement a trustworthy signal?</h3>
          {calib[BUCKETS[0]] && (
            <p className="mb-3 text-[13px] text-body">
              When all readers agree, the word is right <span className="font-mono text-ink">{pct(calib[BUCKETS[0]].right, calib[BUCKETS[0]].words)}</span> of the time.
            </p>
          )}
          <Table
            head={["Reader agreement", "Words", "Right", "Accuracy"]}
            rows={BUCKETS.filter((b) => calib[b]).map((b) => ({
              key: b, highlight: b === BUCKETS[0],
              cells: [b, calib[b].words, calib[b].right, pct(calib[b].right, calib[b].words)],
            }))}
          />
        </Card>
      )}

      {rb && (
        <Card>
          <h3 className="title mb-1">Robustness: degraded photos</h3>
          <p className="mb-3 text-[12px] text-muted">
            The same samples blurred, darkened, noisy, rotated and compressed like a forwarded phone photo
            ({rb.samples ?? "?"} samples, split <span className="font-mono uppercase">{data?.robustness_split}</span>).
          </p>
          <Table
            head={["Image condition", "Baseline WER", "Our WER", "Baseline confident errors", "Our confident errors", "Our flag recall"]}
            rows={Object.entries(rb.results).map(([cond, t]) => {
              const b = t["baseline"], o = t[OURS];
              return {
                key: cond, highlight: false,
                cells: [cond, pct(b.word_edits, b.ref_words), pct(o.word_edits, o.ref_words), confident(b), confident(o), pct(o.flagged_wrong, o.wrong)],
              };
            })}
          />
        </Card>
      )}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: { key: string; highlight: boolean; cells: ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
            {head.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-line ${r.highlight ? "border-ok-line bg-ok-bg font-semibold text-ok-fg" : "text-ink"}`}>
              {r.cells.map((c, i) => <td key={i} className={`px-2 py-1.5 ${i ? "font-mono tabular-nums" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
