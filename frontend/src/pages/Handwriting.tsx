import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from "react";
import {
  Camera, Check, ClipboardCopy, Download, FlaskConical, HelpCircle, ImageUp, ShieldCheck, SkipForward, Sparkles, UserCheck, Wand2,
} from "lucide-react";
import { postForm, postJSON } from "../lib/api";
import { Button, Card, ErrorNote, inputCls } from "../components/ui";
import { SAMPLE, hasDigit, isNewline, joinWords, reviewQueue, type HwResult, type Word } from "../lib/handwriting";

type Mode = "auto" | "review";

export default function Handwriting() {
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [opts, setOpts] = useState({ clean: true, vote: true, context: true, baseline: true });
  const [result, setResult] = useState<HwResult | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [isSample, setIsSample] = useState(false);
  const [mode, setMode] = useState<Mode>("auto");
  const [writer, setWriter] = useState("dr-default");
  const [asked, setAsked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!camOn) return;
    let stream: MediaStream;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (video.current) video.current.srcObject = s;
    }).catch((e) => setError(String(e)));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [camOn]);

  function pick(f: Blob) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setWords([]);
    setIsSample(false);
    setCamOn(false);
  }

  function snapshot() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && pick(b), "image/jpeg", 0.92);
  }

  function load(r: HwResult, sample: boolean) {
    setResult(r);
    setWords(r.words);
    setIsSample(sample);
    setAsked(0);
  }

  async function digitize() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file, "page.jpg");
    Object.entries(opts).forEach(([k, v]) => form.append(k, String(v)));
    setLoading(true);
    setError(null);
    try {
      load(await postForm<HwResult>("/api/handwriting", form), false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function answer(i: number, text: string) {
    const original = words[i].text;
    setWords((ws) => ws.map((w, j) => (j === i ? { ...w, text, flagged: false, confidence: 1, resolved_by: "human" } : w)));
    setAsked((n) => n + 1);
    // The human's answer is final; also teach this writer's word list (best effort, the UI works without it).
    postJSON("/api/handwriting/answer", { writer, original, answer: text }).catch(() => {});
  }

  function skip(i: number) {
    setWords((ws) => ws.map((w, j) => (j === i ? { ...w, skipped: true } : w)));
  }

  const text = useMemo(() => joinWords(words), [words]);
  const real = words.filter((w) => !isNewline(w));
  const flaggedLeft = real.filter((w) => w.flagged).length;
  const avgConf = real.length ? real.reduce((s, w) => s + (w.confidence ?? 0), 0) / real.length : 0;
  const byContext = real.filter((w) => w.resolved_by === "context").length;
  const queue = reviewQueue(words.map((w) => (w.skipped ? { ...w, flagged: false } : w)));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ---------- input ---------- */}
      <Card className="space-y-4 self-start">
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-brand">
            <ImageUp className="size-4" /> Upload page
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          <button
            onClick={() => setCamOn((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-brand"
          >
            <Camera className="size-4" /> {camOn ? "Close camera" : "Camera"}
          </button>
          <button
            onClick={() => { setPreview(null); setFile(null); load(SAMPLE, true); }}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-slate-400 hover:border-brand hover:text-slate-100"
          >
            <FlaskConical className="size-4" /> Load sample
          </button>
        </div>

        {camOn && (
          <div className="space-y-2">
            <video ref={video} autoPlay playsInline className="w-full rounded-xl bg-black" />
            <Button onClick={snapshot}><Camera className="size-4" /> Capture</Button>
          </div>
        )}

        {preview ? (
          <img src={preview} alt="handwriting" className="max-h-[420px] w-full rounded-xl border border-line object-contain bg-page" />
        ) : !camOn && (
          <div className="grid h-48 place-items-center rounded-xl border border-dashed border-line text-sm text-slate-400">
            A photo of a prescription, form or note
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-sm">
          {([
            ["clean", "Clean image", "denoise, deskew, contrast"],
            ["vote", "Multi-model vote", "disagreement = flag"],
            ["context", "Context fix", "only from candidates"],
            ["baseline", "Compare baseline", "one model, one pass"],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-2 hover:border-slate-500">
              <input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
              <span><span className="block">{label}</span><span className="text-xs text-slate-400">{hint}</span></span>
            </label>
          ))}
        </div>

        <Button onClick={digitize} loading={loading} disabled={!file} className="w-full">
          <Wand2 className="size-4" /> {loading ? "Reading with every model…" : "Digitize"}
        </Button>
        <ErrorNote error={error} />
      </Card>

      {/* ---------- output ---------- */}
      <div className="space-y-4">
        {!result ? (
          <Card className="grid h-full min-h-64 place-items-center text-center text-sm text-slate-400">
            <div className="space-y-2">
              <ShieldCheck className="mx-auto size-8 text-brand-soft" />
              <p>Every word is read by several AI models.<br />Where they disagree, ClearScript flags it instead of guessing.</p>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Words" value={real.length} />
              <Stat label="Still flagged" value={flaggedLeft} tone={flaggedLeft ? "amber" : "emerald"} />
              <Stat label="Avg agreement" value={`${Math.round(avgConf * 100)}%`} />
              <Stat label="Questions asked" value={asked} hint={`${byContext} fixed by context`} />
            </div>

            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex rounded-xl bg-page p-1 text-sm">
                  {(["auto", "review"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${mode === m ? "bg-brand-strong text-white" : "text-slate-400 hover:text-slate-100"}`}
                    >
                      {m === "auto" ? <Sparkles className="size-4" /> : <UserCheck className="size-4" />}
                      {m === "auto" ? "Auto" : "Ask the human"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {isSample && <span className="rounded-full bg-line px-2 py-0.5 text-xs text-slate-200">sample data</span>}
                  <IconBtn title="Copy text" onClick={() => navigator.clipboard.writeText(text)}><ClipboardCopy className="size-4" /></IconBtn>
                  <IconBtn title="Download .txt" onClick={() => download(text)}><Download className="size-4" /></IconBtn>
                </div>
              </div>

              <WordText words={words} />
              <Legend />
            </Card>

            {mode === "review" && (
              <ReviewPanel words={words} queue={queue} writer={writer} setWriter={setWriter} onAnswer={answer} onSkip={skip} />
            )}

            {result.baseline !== undefined && <Compare baseline={result.baseline} ours={text} />}
            <Readings readings={result.readings} errors={result.errors} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- pieces ----------

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "amber" | "emerald" }) {
  const color = tone === "amber" ? "text-warn" : tone === "emerald" ? "text-ok" : "text-slate-100";
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-300">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function IconBtn(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded-lg border border-line p-2 text-slate-300 hover:border-brand hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" />;
}

function wordCls(w: Word) {
  if (w.flagged) return "border border-warn bg-warn-bg text-warn underline decoration-warn decoration-wavy decoration-1 underline-offset-[5px]";
  if (w.resolved_by === "human") return "border border-ok bg-ok-bg text-ok-fg";
  if (w.resolved_by === "context") return "border border-info bg-info-bg text-info-fg";
  return "";
}

function WordText({ words }: { words: Word[] }) {
  return (
    <div className="rounded-xl border border-line bg-page p-5 font-mono text-[15px] leading-relaxed [&>span]:mr-1.5 [&>span]:inline-block [&>span]:my-1">
      {words.map((w, i) =>
        isNewline(w) ? <br key={i} /> : (
          <span key={i} className="group relative">
            <span className={`rounded-md px-1 ${wordCls(w)}`}>{w.text}</span>{" "}
            <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-max max-w-64 rounded-lg border border-line bg-panel px-2 py-1 font-sans text-xs leading-5 text-slate-300 shadow-xl group-hover:block">
              {Math.round((w.confidence ?? 0) * 100)}% of models agree
              {w.resolved_by && <> · fixed by {w.resolved_by}</>}
              {!!w.alternatives?.length && <><br />others read: {w.alternatives.join(", ")}</>}
            </span>
          </span>
        ),
      )}
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5"><span className={`inline-block size-3 rounded ${cls}`} />{label}</span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300">
      {item("border border-warn bg-warn-bg", "Needs check")}
      {item("border border-info bg-info-bg", "Fixed by context")}
      {item("border border-ok bg-ok-bg", "Confirmed by you")}
      <span className="text-slate-400">Hover a word for details.</span>
    </div>
  );
}

function ReviewPanel({ words, queue, writer, setWriter, onAnswer, onSkip }: {
  words: Word[]; queue: number[]; writer: string; setWriter: (s: string) => void;
  onAnswer: (i: number, text: string) => void; onSkip: (i: number) => void;
}) {
  const [typed, setTyped] = useState("");
  const i = queue[0];
  if (i === undefined) {
    return (
      <Card className="flex items-center gap-3 border-ok bg-ok-bg text-sm text-ok-fg">
        <Check className="size-5" /> Nothing left to ask. Every flagged word has been checked.
      </Card>
    );
  }
  const w = words[i];
  const before = words.slice(Math.max(0, i - 5), i).filter((x) => !isNewline(x)).map((x) => x.text).join(" ");
  const after = words.slice(i + 1, i + 6).filter((x) => !isNewline(x)).map((x) => x.text).join(" ");
  const options = [...new Set([w.text, ...(w.alternatives ?? [])])].filter((x) => x && x !== "[?]");
  const submit = (t: string) => { if (t.trim()) { onAnswer(i, t.trim()); setTyped(""); } };

  return (
    <Card className="space-y-5 border-warn/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <HelpCircle className="size-5 text-warn" /> Which word is this?
          {hasDigit(w.text) && <span className="rounded-full bg-del-bg px-2 py-0.5 text-xs font-medium text-del-fg">number: never guessed</span>}
        </div>
        <span className="text-xs text-slate-400">{queue.length} question{queue.length > 1 ? "s" : ""} left on this page</span>
      </div>

      <p className="rounded-xl border border-line bg-page p-4 font-mono text-sm leading-relaxed text-slate-300">
        …{before} <span className="rounded-md border border-warn bg-warn-bg px-1.5 text-warn">{w.text}</span> {after}…
      </p>

      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <button key={o} onClick={() => submit(o)} className="min-w-20 rounded-xl border border-line bg-page px-4 py-2.5 font-mono text-sm text-slate-100 transition hover:border-brand hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {o}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <input className={inputCls} placeholder="Or type the correct word" value={typed}
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(typed)} />
        <Button onClick={() => submit(typed)} disabled={!typed.trim()}>Confirm</Button>
        <button onClick={() => onSkip(i)} title="Skip this word" aria-label="Skip this word" className="rounded-xl border border-line px-3 text-slate-300 hover:border-brand hover:text-slate-100">
          <SkipForward className="size-4" />
        </button>
      </div>

      <label className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-slate-400">
        Writer
        <input className={`${inputCls} max-w-48 py-1 text-xs`} value={writer} onChange={(e) => setWriter(e.target.value)} />
        <span>your answers are final and teach this writer's word list</span>
      </label>
    </Card>
  );
}

/** Word-level diff: highlights where the single-model baseline differs from ClearScript. */
function Compare({ baseline, ours }: { baseline: string; ours: string }) {
  const a = baseline.split(/\s+/).filter(Boolean);
  const b = ours.split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Set<number>(), keepB = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) { keepA.add(i++); keepB.add(j++); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const changed = a.length - keepA.size;
  const show = (ws: string[], keep: Set<number>, cls: string) =>
    ws.map((x, k) => <span key={k}><span className={keep.has(k) ? "" : `rounded px-1 ${cls}`}>{x}</span> </span>);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Baseline vs ClearScript</span>
        <span className="text-xs text-slate-400">{changed} word{changed === 1 ? "" : "s"} differ</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-400">One model, one pass</div>
          <p className="rounded-xl border border-line bg-page p-4 font-mono text-sm leading-relaxed">{show(a, keepA, "bg-del-bg text-del-fg line-through decoration-del-fg")}</p>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">ClearScript</div>
          <p className="rounded-xl border border-line bg-page p-4 font-mono text-sm leading-relaxed">{show(b, keepB, "bg-ok-bg text-ok-fg")}</p>
        </div>
      </div>
    </Card>
  );
}

function Readings({ readings, errors }: { readings: Record<string, string>; errors: Record<string, string> }) {
  return (
    <details className="rounded-2xl border border-line bg-panel p-5">
      <summary className="cursor-pointer text-sm font-medium">
        What each model read ({Object.keys(readings).length} answered{Object.keys(errors).length ? `, ${Object.keys(errors).length} failed` : ""})
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.entries(readings).map(([name, t]) => (
          <div key={name}>
            <div className="mb-1 truncate text-xs text-brand-soft">{name}</div>
            <pre className="whitespace-pre-wrap rounded-xl bg-page p-3 text-xs text-slate-300">{t}</pre>
          </div>
        ))}
        {Object.entries(errors).map(([name, e]) => (
          <div key={name}>
            <div className="mb-1 truncate text-xs text-del-fg">{name}</div>
            <pre className="whitespace-pre-wrap rounded-xl bg-del-bg p-3 text-xs text-del-fg">{e}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function download(text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = "clearscript.txt";
  a.click();
}
