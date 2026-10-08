import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, ClipboardCopy, Download, ListChecks, Loader2, Pill, RotateCcw } from "lucide-react";
import { Badge, Button, ErrorState, Notice, Panel, type Tone } from "../../components/ui";
import { useT } from "../../i18n";
import {
  isMarginTag, isNewline, isUnreadable, joinWords, stats, wordStatus, type HwResult, type RxRow, type Word, type WordStatus,
} from "../../lib/handwriting";
import { modelLabel } from "../../lib/progress";

type Props = {
  result: HwResult; words: Word[]; isSample: boolean; fromHistory: boolean; canRerun: boolean;
  rows: RxRow[] | null; rowsLoading: boolean; rowsError: unknown; onRetryRows: () => void;
  onOpenWord: (i: number) => void; onReview: () => void; onExport: () => void; onCopy: () => void; onRerun: () => void;
  focusWord: number | null;
};

export function ResultView(p: Props) {
  const { t, tn, pct } = useT();
  const s = stats(p.words, p.result);
  const isRx = p.result.doc_type === "prescription";
  const ours = useMemo(() => joinWords(p.words), [p.words]);
  const failed = Object.entries(p.result.errors).filter(([k]) => k !== "baseline");

  return (
    <div className="space-y-4">
      {/* ---- verdict: uncertainty first, never hidden ---- */}
      <section aria-labelledby="cs-verdict-h" className={`rounded-lg border p-4 ${s.flagged ? "border-flag-line bg-flag-bg" : "border-ok-line bg-ok-bg"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 id="cs-verdict-h" className={`flex items-center gap-2 text-base font-semibold ${s.flagged ? "text-flag-fg" : "text-ok-fg"}`}>
              {s.flagged ? <AlertTriangle className="size-5 shrink-0" aria-hidden="true" /> : <Check className="size-5 shrink-0" aria-hidden="true" />}
              {s.flagged ? tn("cs.verdict.flagged", s.flagged) : t("cs.verdict.clear")}
            </h2>
            <p className="text-sm text-ink">{s.flagged ? t("cs.verdict.flagged.body") : s.models > 1 ? t("cs.verdict.clear.body") : t("cs.verdict.clear.single")}</p>
            {s.lookalikes > 0 && <p className="text-sm font-medium text-danger-fg">{tn("cs.verdict.lookalikes", s.lookalikes)}</p>}
          </div>
          {s.flagged > 0 && (
            <Button variant="primary" icon={<ListChecks className="size-4" aria-hidden="true" />} onClick={p.onReview}>
              {t("cs.review.start")}
            </Button>
          )}
        </div>
      </section>

      {p.isSample && <Notice tone="info">{t("cs.result.sample")}</Notice>}
      {p.fromHistory && <Notice tone="neutral">{t("cs.result.fromHistory")}</Notice>}
      {failed.length > 0 && (
        <Notice tone="flag" title={t("cs.result.partial", { done: s.models, n: s.models + failed.length })}>
          <span className="block">{t("cs.result.partial.body")}</span>
          <ul className="mt-1 space-y-0.5 text-xs">
            {failed.map(([m, e]) => <li key={m} className="break-words"><span className="font-mono">{modelLabel(m)}</span>: {e}</li>)}
          </ul>
        </Notice>
      )}
      {!p.result.stages.vote && <Notice tone="flag">{t("cs.result.single")}</Notice>}

      {/* ---- the text ---- */}
      <Panel
        title={t("cs.transcript.title")}
        actions={
          <>
            {p.result.doc_type && <Badge>{t(p.result.doc_type === "prescription" ? "cs.doc.prescription" : "cs.doc.note")}</Badge>}
            {p.isSample && <Badge tone="accent">{t("cs.badge.sample")}</Badge>}
            <Button size="sm" icon={<ClipboardCopy className="size-4" aria-hidden="true" />} onClick={p.onCopy}>{t("common.copy")}</Button>
            <Button size="sm" icon={<Download className="size-4" aria-hidden="true" />} onClick={p.onExport}>{t("cs.export.open")}</Button>
            {p.canRerun && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={p.onRerun}>{t("cs.rerun")}</Button>}
          </>
        }
        bodyClassName="space-y-3 p-4"
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label={t("cs.stat.words")} value={String(s.words)} />
          <Stat label={t("cs.stat.unverified")} value={String(s.flagged)} tone={s.flagged ? "flag" : "ok"} />
          <Stat label={t("cs.stat.agreement")} value={pct(s.agreement)} hint={t("cs.stat.agreement.hint")} />
          <Stat label={t("cs.stat.models")} value={failed.length ? t("cs.stat.modelsOf", { done: s.models, n: s.models + failed.length }) : String(s.models)} />
        </dl>
        <Transcript words={p.words} onOpen={p.onOpenWord} focusWord={p.focusWord} />
        <Legend />
        {(s.human > 0 || s.context > 0) && (
          <p className="text-xs text-muted">
            {[s.human ? tn("cs.result.human", s.human) : "", s.context ? tn("cs.result.context", s.context) : ""].filter(Boolean).join(" · ")}
          </p>
        )}
      </Panel>

      {isRx && <RxTable rows={p.rows} loading={p.rowsLoading} error={p.rowsError} onRetry={p.onRetryRows} />}
      {p.result.baseline !== undefined && <Compare baseline={p.result.baseline} ours={ours} failed={p.result.errors.baseline} />}
      <Readings readings={p.result.readings} errors={p.result.errors} />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone === "flag" ? "text-flag-fg" : tone === "ok" ? "text-ok-fg" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

// ---------- transcript ----------

const WORD_CLS: Record<WordStatus, string> = {
  agreed: "hover:bg-surface",
  flagged: "bg-flag-bg text-flag-fg underline decoration-flag-line decoration-dashed decoration-2 underline-offset-4",
  lookalike: "bg-danger-bg text-danger-fg underline decoration-danger-line decoration-wavy decoration-2 underline-offset-4",
  context: "bg-info-bg text-info-fg underline decoration-info-line decoration-dotted decoration-2 underline-offset-4",
  guess: "bg-info-bg text-info-fg underline decoration-info-line decoration-dotted decoration-2 underline-offset-4",
  human: "bg-ok-bg text-ok-fg",
};
const MARKER: Partial<Record<WordStatus, string>> = { flagged: "?", lookalike: "!", human: "✓" };

/** The text as buttons: one tab stop, arrow keys move between words, Enter opens a word. */
function Transcript({ words, onOpen, focusWord }: { words: Word[]; onOpen: (i: number) => void; focusWord: number | null }) {
  const { t } = useT();
  const order = useMemo(() => words.flatMap((w, i) => (isNewline(w) || isMarginTag(w) ? [] : [i])), [words]);
  const firstFlag = order.find((i) => words[i].flagged);
  const [active, setActive] = useState<number | undefined>(firstFlag ?? order[0]);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const tabStop = active !== undefined && order.includes(active) ? active : order[0];

  // After a dialog closes, put focus back on the word it was about.
  useEffect(() => {
    if (focusWord === null) return;
    setActive(focusWord);
    refs.current.get(focusWord)?.focus();
  }, [focusWord]);

  const lines = useMemo(() => {
    const out: { w: Word; i: number }[][] = [[]];
    words.forEach((w, i) => (isNewline(w) ? out.push([]) : out[out.length - 1].push({ w, i })));
    return out.filter((l) => l.length);
  }, [words]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const k = order.indexOf(i);
    const rtl = (e.currentTarget as HTMLElement).closest("[dir=rtl]") !== null;
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    let to: number | undefined;
    if (next !== undefined) to = order[Math.min(order.length - 1, Math.max(0, k + next))];
    else if (e.key === "Home") to = order[0];
    else if (e.key === "End") to = order[order.length - 1];
    if (to === undefined) return;
    e.preventDefault();
    setActive(to);
    refs.current.get(to)?.focus();
  };

  return (
    <div>
      <p id="cs-transcript-help" className="sr-only">{t("cs.transcript.help")}</p>
      <div role="group" dir="auto" aria-label={t("cs.transcript.title")} aria-describedby="cs-transcript-help"
        className="transcript overflow-x-auto rounded-md border border-line bg-subtle px-3 py-2 text-ink">
        {lines.map((line, li) => (
          <p key={li} className="break-words">
            {line.map(({ w, i }) => {
              if (isMarginTag(w)) return <Badge key={i} className="me-1 align-middle">{t("cs.word.margin")}</Badge>;
              const st = wordStatus(w);
              return (
                <Fragment key={i}>
                  <button
                    type="button"
                    ref={(el) => { if (el) refs.current.set(i, el); else refs.current.delete(i); }}
                    tabIndex={i === tabStop ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onClick={() => onOpen(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    className={`rounded px-0.5 text-start transition-colors ${WORD_CLS[st]}`}
                  >
                    {isUnreadable(w) ? <span className="italic">{t("cs.word.unreadable")}</span> : w.text}
                    {MARKER[st] && <span aria-hidden="true" className="ms-0.5 align-super text-xs font-bold">{MARKER[st]}</span>}
                    {st !== "agreed" && <span className="sr-only">, {t(`cs.status.${st}`)}</span>}
                  </button>{" "}
                </Fragment>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  const { t } = useT();
  const items: [WordStatus, string][] = [["flagged", "?"], ["lookalike", "!"], ["context", ""], ["human", "✓"]];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-body">
      <span className="sr-only">{t("cs.legend.title")}</span>
      {items.map(([st, mark]) => (
        <span key={st} className="flex items-center gap-1">
          <span aria-hidden="true" className={`rounded px-1 ${WORD_CLS[st]}`}>abc{mark && <span className="ms-0.5 align-super font-bold">{mark}</span>}</span>
          {t(`cs.status.${st}`)}
        </span>
      ))}
      <span className="text-muted sm:ms-auto">{t("cs.legend.hint")}</span>
    </div>
  );
}

// ---------- prescription ----------

function RxTable({ rows, loading, error, onRetry }: { rows: RxRow[] | null; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t } = useT();
  const cols = ["drug", "strength", "form", "frequency", "duration"] as const;
  return (
    <Panel
      title={<span className="flex items-center gap-2"><Pill className="size-4" aria-hidden="true" />{t("cs.rx.title")}</span>}
      actions={loading ? <span className="flex items-center gap-1 text-xs text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("cs.rx.loading")}</span> : undefined}
      bodyClassName="space-y-3 p-4"
    >
      <p className="text-xs text-muted">{t("cs.rx.note")}</p>
      {!!error && <ErrorState error={error} onRetry={onRetry} />}
      {rows && rows.length === 0 && !loading && <p className="text-sm text-muted">{t("cs.rx.none")}</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-sm">
            <caption className="sr-only">{t("cs.rx.title")}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                {cols.map((c) => <th key={c} scope="col" className="px-2 py-2 text-start font-medium">{t(`cs.rx.${c}`)}</th>)}
                <th scope="col" className="px-2 py-2 text-end font-medium">{t("cs.rx.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={i}>
                  <tr className={`border-b border-line ${r.warnings?.length ? "bg-danger-bg" : r.flagged ? "bg-flag-bg" : ""}`}>
                    {cols.map((c) => <td key={c} dir="auto" className="px-2 py-2 align-top tabular-nums text-ink">{r[c] || <span className="text-muted">-</span>}</td>)}
                    <td className="px-2 py-2 text-end align-top">
                      {r.warnings?.length ? <Badge tone="danger">{t("cs.rx.checkDose")}</Badge>
                        : r.flagged ? <Badge tone="flag">{t("cs.rx.check")}</Badge>
                        : <Badge tone="ok">{t("cs.rx.ok")}</Badge>}
                    </td>
                  </tr>
                  {!!r.warnings?.length && (
                    <tr className="border-b border-line bg-danger-bg">
                      <td colSpan={cols.length + 1} className="px-2 pb-2 text-xs text-danger-fg">
                        {r.warnings.map((m) => <p key={m} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />{m}</p>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- baseline comparison ----------

/** Word-level diff: where a single model, single pass differs from ClearScript. */
function Compare({ baseline, ours, failed }: { baseline: string; ours: string; failed?: string }) {
  const { t, tn } = useT();
  const notTag = (x: string) => x && x.toLowerCase() !== "[margin]"; // margin tags are layout, not words
  const a = baseline.split(/\s+/).filter(notTag);
  const b = ours.split(/\s+/).filter(notTag);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Set<number>(), keepB = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) { keepA.add(i++); keepB.add(j++); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const changed = b.length - keepB.size;
  const show = (ws: string[], keep: Set<number>, cls: string) =>
    ws.map((x, k) => <Fragment key={k}><span className={keep.has(k) ? "" : `rounded px-0.5 ${cls}`}>{x}</span> </Fragment>);

  return (
    <Panel title={t("cs.compare.title")} bodyClassName="p-0">
      {!baseline && failed ? (
        <p className="p-4 text-sm text-muted">{t("cs.compare.failed")} <span className="break-words text-xs">{failed}</span></p>
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-muted">
            {changed ? tn("cs.compare.changed", changed) : t("cs.compare.same")} {t("cs.compare.hint")}
          </p>
          <div className="grid sm:grid-cols-2">
            <div className="min-w-0 border-line sm:border-e">
              <h3 className="px-4 pt-3 text-xs font-semibold text-muted">{t("cs.compare.one")}</h3>
              <p dir="auto" className="px-4 py-2 text-sm leading-7 text-body">{show(a, keepA, "bg-danger-bg text-danger-fg line-through")}</p>
            </div>
            <div className="min-w-0 border-t border-line sm:border-t-0">
              <h3 className="px-4 pt-3 text-xs font-semibold text-muted">{t("cs.compare.ours")}</h3>
              <p dir="auto" className="px-4 py-2 text-sm leading-7 text-body">{show(b, keepB, "bg-ok-bg text-ok-fg underline decoration-2 underline-offset-4")}</p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function Readings({ readings, errors }: { readings: Record<string, string>; errors: Record<string, string> }) {
  const { t } = useT();
  const failed = Object.entries(errors).filter(([k]) => k !== "baseline");
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold">{t("cs.readings.title")}</h2>
        <span className="text-xs font-normal text-muted">
          {t("cs.readings.count", { ok: Object.keys(readings).length, failed: failed.length })}
        </span>
      </summary>
      <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
        {Object.entries(readings).map(([name, text]) => (
          <div key={name} className="min-w-0">
            <h3 className="mb-1 break-all font-mono text-xs text-muted">{modelLabel(name)}</h3>
            <pre dir="auto" className="whitespace-pre-wrap break-words rounded-md border border-line bg-subtle p-3 font-sans text-sm text-body">{text}</pre>
          </div>
        ))}
        {failed.map(([name, e]) => (
          <div key={name} className="min-w-0">
            <h3 className="mb-1 break-all font-mono text-xs text-danger-fg">{modelLabel(name)}</h3>
            <p className="whitespace-pre-wrap break-words rounded-md border border-danger-line bg-danger-bg p-3 text-xs text-danger-fg">{e}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
