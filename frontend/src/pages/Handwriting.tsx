import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Keyboard } from "lucide-react";
import { ApiError, postForm, postJSON, streamNDJSON } from "../lib/api";
import { Button, Dialog, ErrorState, useToast } from "../components/ui";
import { useT } from "../i18n";
import { useHealth } from "../lib/health";
import { checkFile, thumbnail, type Kind } from "../lib/fileCheck";
import {
  DEFAULT_OPTIONS, SAMPLE, SAMPLE_ROWS, markWords, reviewQueue, stats, type HwResult, type Options, type RxRow, type Word,
} from "../lib/handwriting";
import { loadHistory, newId, saveHistory, upsert, type HistoryEntry } from "../lib/history";
import { toText } from "../lib/exporters";
import { newRun, step, type Run } from "../lib/progress";
import { InputPanel } from "./clearscript/InputPanel";
import { ProcessingView } from "./clearscript/Progress";
import { Guide } from "./clearscript/Guide";
import { ResultView } from "./clearscript/ResultView";
import { WordDialog } from "./clearscript/WordDialog";
import { CameraDialog, ExportDialog, HistoryDialog, ShortcutsDialog } from "./clearscript/Dialogs";

const WRITER_KEY = "cs-writer";
const readWriter = () => { try { return localStorage.getItem(WRITER_KEY) ?? ""; } catch { return ""; } };

type Shown = { result: HwResult; words: Word[]; name: string; ts: number; sample: boolean; entryId: string | null; fromHistory: boolean };

export default function Handwriting({ active }: { active: boolean }) {
  const { t, tn } = useT();
  const { toast, announce } = useToast();
  const health = useHealth();
  const maxMb = health.limits.maxUploadMb;

  // input
  const [file, setFile] = useState<Blob | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS);
  const [writer, setWriterState] = useState(readWriter);

  // run
  const [run, setRun] = useState<Run | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [runError, setRunError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);

  // result
  const [shown, setShown] = useState<Shown | null>(null);
  const [rows, setRows] = useState<RxRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<unknown>(null);
  const [rowsTick, setRowsTick] = useState(0);

  // dialogs
  const [wordIdx, setWordIdx] = useState<number | null>(null);
  const [review, setReview] = useState<{ skipped: number[]; total: number } | null>(null);
  const [focusWord, setFocusWord] = useState<number | null>(null);
  const [camera, setCamera] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
  const previous = useRef<Shown | null>(null); // shown again if a re-run is stopped or fails

  const workspace = useRef<HTMLDivElement>(null);
  const progressHeading = useRef<HTMLHeadingElement>(null);
  const running = run !== null;
  const words = shown?.words ?? [];

  const setWriter = (w: string) => {
    setWriterState(w);
    try { localStorage.setItem(WRITER_KEY, w); } catch { /* not persisted */ }
  };

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // ---------- input ----------

  async function pick(files: File[] | Blob[]) {
    const f = files[0];
    if (!f || running) return;
    const check = await checkFile(f, maxMb);
    if (check.code) {
      setProblem(check.code);
      announce(t(`err.${check.code}.title` as "err.unknown.title"));
      return;
    }
    setProblem(null);
    setFile(f);
    setName(f instanceof File && f.name ? f.name : "camera.jpg");
    setKind(check.kind ?? null);
    setPreview(check.kind === "pdf" ? null : URL.createObjectURL(f));
    setRunError(null);
    if (shown) {
      setShown(null); // the previous result stays in History
      setRows(null);
    }
    announce(t("cs.input.added", { name: f instanceof File ? f.name : "camera.jpg" }));
  }

  function removeFile() {
    setFile(null);
    setName("");
    setKind(null);
    setPreview(null);
    setProblem(null);
    setRunError(null);
  }

  function loadSample() {
    removeFile();
    show({ result: SAMPLE, words: SAMPLE.words, name: "sample-prescription", ts: Date.now(), sample: true, entryId: null, fromHistory: false });
  }

  function show(s: Shown) {
    setShown(s);
    setReview(null);
    setWordIdx(null);
    setRows(null);
    setRowsError(null);
  }

  // ---------- digitize ----------

  const formFor = useCallback(() => {
    const form = new FormData();
    form.append("file", file!, name || (kind === "pdf" ? "page.pdf" : "page.jpg"));
    (Object.keys(opts) as (keyof Options)[]).forEach((k) => form.append(k, String(opts[k])));
    if (writer.trim()) form.append("writer", writer.trim()); // the backend uses this writer's confirmed words as hints
    return form;
  }, [file, name, kind, opts, writer]);

  async function digitize() {
    if (!file || running) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunError(null);
    setRun(newRun(opts));
    setStartedAt(Date.now());
    previous.current = shown && !shown.sample ? shown : null;
    setShown(null);
    setRows(null);
    announce(t("cs.run.started"));
    requestAnimationFrame(() => {
      const top = workspace.current?.getBoundingClientRect().top ?? 0;
      if (top > window.innerHeight * 0.6) {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        workspace.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      }
      progressHeading.current?.focus({ preventScroll: true });
    });

    try {
      let result: HwResult | null = null;
      let failure: ApiError | null = null;
      try {
        await streamNDJSON("/api/handwriting/stream", { method: "POST", body: formFor(), signal: ctrl.signal }, (ev) => {
          if (ev.type === "result") result = ev.result;
          else if (ev.type === "error") failure = new ApiError(String(ev.code ?? "server"), String(ev.message ?? ""), 0, undefined, ev);
          else {
            setRun((r) => (r ? step(r, ev) : r));
            if (ev.type === "stage" && ev.stage === "read" && ev.status === "done" && typeof ev.answered === "number") {
              announce(t("cs.progress.readers", { done: ev.answered, n: ev.answered + (ev.failed ?? 0) }));
            }
          }
        });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        // Older backend without the progress stream: same result, no live stages.
        setRun((r) => (r ? { ...r, live: false } : r));
        result = await postForm<HwResult>("/api/handwriting", formFor(), ctrl.signal);
      }
      if (failure) throw failure;
      if (!result) throw new ApiError("server", "The server finished without a result.");
      const r: HwResult = result;
      const ts = Date.now();
      const entryId = newId();
      const thumb = kind === "pdf" ? undefined : await thumbnail(file);
      show({ result: r, words: r.words, name, ts, sample: false, entryId, fromHistory: false });
      persist(upsert(historyRef.current, { id: entryId, ts, name, thumb, result: r, words: r.words }));
      previous.current = null;
      const s = stats(r.words, r);
      announce(s.flagged ? tn("cs.run.doneFlags", s.flagged) : t("cs.run.doneClear"));
    } catch (e) {
      if (previous.current) setShown(previous.current); // a failed re-run leaves the last result in place
      if (e instanceof ApiError && e.code === "aborted") {
        toast(t("cs.run.stopped"));
      } else {
        setRunError(e);
        announce(t("cs.run.failed"));
      }
    } finally {
      abort.current = null;
      setRun(null);
    }
  }

  const digitizeRef = useRef(digitize);
  digitizeRef.current = digitize;
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // Ctrl/⌘ + Enter digitizes; pasting an image adds it. Only while this tab is showing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        digitizeRef.current();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/") || f.type === "application/pdf");
      if (img) { e.preventDefault(); pickRef.current([img]); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, [active]);

  // ---------- history ----------

  function persist(xs: HistoryEntry[]) {
    historyRef.current = xs;
    setHistory(xs);
    if (!saveHistory(xs)) toast(t("cs.history.notSaved"), "flag");
  }

  function openEntry(e: HistoryEntry) {
    removeFile();
    show({ result: e.result, words: e.words, name: e.name, ts: e.ts, sample: false, entryId: e.id, fromHistory: true });
    setHistoryOpen(false);
  }

  // ---------- corrections ----------

  // Corrections are saved into the result's History entry as they happen.
  useEffect(() => {
    if (!shown?.entryId) return;
    const entry = historyRef.current.find((x) => x.id === shown.entryId);
    if (entry && entry.words !== shown.words) persist(upsert(historyRef.current, { ...entry, words: shown.words, updated: Date.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only when the words change
  }, [shown?.words, shown?.entryId]);

  async function confirmWord(i: number, text: string) {
    if (!shown) return;
    const w = shown.words[i];
    const original = w.original ?? w.text;
    const next = shown.words.map((x, j) => (j === i ? { ...x, text, flagged: false, resolved_by: "human", original } : x));
    setShown((s) => s && { ...s, words: next });
    setRowsTick((n) => n + 1);
    advance(next, i);

    const profile = writer.trim();
    if (shown.sample || !profile) {
      announce(t("cs.word.saved"));
      return;
    }
    // The person's answer is final. Save it to the writer profile, then let the constrained context fix
    // resolve other flagged copies of the same word (no new vision calls).
    try {
      await postJSON("/api/handwriting/answer", { writer: profile, original, answer: text });
      toast(t("cs.word.savedProfile", { writer: profile }), "ok");
      const r = await postJSON<{ words: Word[] }>("/api/handwriting/recontext", { words: next, writer: profile, doc_type: shown.result.doc_type ?? "note" });
      if (r.words.length !== next.length) return;
      // never overwrite a person's answer, including one given while this request was running
      setShown((s) => s && s.words.length === r.words.length
        ? { ...s, words: s.words.map((x, j) => (x.resolved_by === "human" ? x : { ...r.words[j], by_model: r.words[j].by_model ?? x.by_model })) }
        : s);
      const fixed = r.words.filter((x, j) => next[j].flagged && next[j].resolved_by !== "human" && !x.flagged).length;
      if (fixed) toast(tn("cs.word.recontext", fixed), "info");
    } catch {
      toast(t("cs.word.profileFailed"), "flag");
    }
  }

  // ---------- review mode ----------

  const queue = useMemo(() => reviewQueue(words), [words]);

  function startReview() {
    const q = reviewQueue(words);
    if (!q.length) return;
    setReview({ skipped: [], total: q.length });
    setWordIdx(q[0]);
  }

  function advance(next: Word[], from: number, skipped: number[] = review?.skipped ?? []) {
    if (!review) { closeWord(from); return; }
    const rest = reviewQueue(next).filter((i) => !skipped.includes(i));
    if (rest.length) setWordIdx(rest[0]);
    else {
      closeWord(from);
      toast(stats(next, null).flagged ? t("cs.review.doneSkipped") : t("cs.review.done"), "ok");
    }
  }

  function skipWord() {
    if (wordIdx === null || !review) return;
    const skipped = [...review.skipped, wordIdx];
    setReview({ ...review, skipped });
    advance(words, wordIdx, skipped);
  }

  function closeWord(i: number | null = wordIdx) {
    setWordIdx(null);
    setReview(null);
    setFocusWord(i);
  }

  // ---------- prescription table ----------

  const isRx = shown?.result.doc_type === "prescription";
  useEffect(() => {
    if (!shown || !isRx) { setRows(null); setRowsError(null); return; }
    if (shown.sample) { setRows(SAMPLE_ROWS); setRowsError(null); return; }
    let live = true;
    setRowsLoading(true);
    setRowsError(null);
    postJSON<{ rows: RxRow[] }>("/api/handwriting/table", { marked: markWords(shown.words) })
      .then((r) => live && setRows(r.rows))
      .catch((e) => live && setRowsError(e))
      .finally(() => live && setRowsLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on a new result or after a correction, not on every render
  }, [shown?.result, shown?.sample, isRx, rowsTick]);

  // ---------- copy ----------

  async function copy() {
    try {
      await navigator.clipboard.writeText(toText(words));
      toast(t("common.copied"), "ok");
    } catch {
      toast(t("common.copyFailed"), "flag");
    }
  }

  const reviewPos = review ? Math.max(1, review.total - queue.filter((i) => !review.skipped.includes(i)).length + 1) : 0;
  const canRerun = !!file && !!shown && !shown.sample && !shown.fromHistory;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" icon={<Keyboard className="size-4" aria-hidden="true" />} onClick={() => setKeysOpen(true)}>{t("cs.keys.title")}</Button>
        <Button size="sm" variant="ghost" icon={<History className="size-4" aria-hidden="true" />} onClick={() => setHistoryOpen(true)}>
          {t("cs.history.button", { n: history.length })}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <InputPanel
            file={file} name={name} preview={preview} kind={kind} problem={problem} isSample={!!shown?.sample}
            onFiles={pick} onCamera={() => setCamera(true)} onSample={loadSample} onRemove={removeFile}
            opts={opts} setOpts={setOpts} writer={writer} setWriter={setWriter}
            running={running} hasResult={!!shown && !shown.sample && !shown.fromHistory} onDigitize={digitize}
            onStop={() => abort.current?.abort()} maxMb={maxMb}
          />
        </div>

        {/* On phones the result (or progress) comes first; the input panel follows for the next page. */}
        <div ref={workspace} className={`min-w-0 scroll-mt-20 ${run || runError || shown ? "max-lg:order-first" : ""}`} aria-busy={running || undefined}>
          {run ? (
            <ProcessingView run={run} startedAt={startedAt} headingRef={progressHeading} onStop={() => abort.current?.abort()} />
          ) : runError ? (
            <div className="space-y-4">
              <ErrorState error={runError} onRetry={file ? digitize : undefined} preserved={!!file} limits={{ maxUploadMb: maxMb }} />
              <Guide ready={!!file} name={name} readers={health.readers} />
            </div>
          ) : shown ? (
            <ResultView
              result={shown.result} words={shown.words} isSample={shown.sample} fromHistory={shown.fromHistory} canRerun={canRerun}
              rows={rows} rowsLoading={rowsLoading} rowsError={rowsError} onRetryRows={() => setRowsTick((n) => n + 1)}
              onOpenWord={(i) => { setReview(null); setWordIdx(i); }} onReview={startReview}
              onExport={() => setExporting(true)} onCopy={copy}
              onRerun={() => (stats(shown.words, null).human ? setConfirmRerun(true) : digitize())}
              focusWord={focusWord}
            />
          ) : (
            <Guide ready={!!file} name={name} readers={health.readers} />
          )}
        </div>
      </div>

      <WordDialog
        open={wordIdx !== null} index={wordIdx} words={words} models={Object.keys(shown?.result.readings ?? {}).length}
        writer={shown?.sample ? "" : writer} review={review && wordIdx !== null ? { pos: reviewPos, total: review.total } : null}
        onClose={() => closeWord()} onConfirm={confirmWord} onSkip={skipWord}
      />
      <CameraDialog open={camera} onClose={() => setCamera(false)} onUse={(f) => pick([f])} />
      {shown && (
        <ExportDialog open={exporting} onClose={() => setExporting(false)} words={shown.words} result={shown.result}
          name={shown.name} ts={shown.ts} rows={rows} onCopy={copy} />
      )}
      <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} entries={history} currentId={shown?.entryId ?? null}
        onOpen={openEntry}
        onDelete={(id) => { persist(historyRef.current.filter((x) => x.id !== id)); if (shown?.entryId === id) setShown((s) => s && { ...s, entryId: null }); }}
        onClear={() => { persist([]); setShown((s) => s && { ...s, entryId: null }); }} />
      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
      <Dialog open={confirmRerun} onClose={() => setConfirmRerun(false)} title={t("cs.rerun.title")}
        footer={<>
          <Button onClick={() => setConfirmRerun(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => { setConfirmRerun(false); digitize(); }}>{t("cs.rerun.yes")}</Button>
        </>}>
        <p className="text-sm text-body">{t("cs.rerun.body")}</p>
      </Dialog>
    </div>
  );
}
