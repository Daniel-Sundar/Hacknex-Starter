import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  Camera, Check, ClipboardCopy, Download, FlaskConical, HelpCircle, ImageUp, ShieldCheck, Sparkles, UserCheck, Wand2,
} from "lucide-react";
import { postForm, postJSON } from "../lib/api";
import { Button, Card, ErrorNote, Kbd, inputCls } from "../components/ui";
import { PenAnimation } from "../components/PenAnimation";
import { SAMPLE, hasDigit, isNewline, joinWords, reviewQueue, type HwResult, type Word } from "../lib/handwriting";

type Mode = "auto" | "review";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const OPTIONS = [
  ["clean", "Clean image", "Denoise, deskew, contrast"],
  ["vote", "Multi-model vote", "Disagreement raises a flag"],
  ["context", "Context fix", "Picks only from candidates"],
  ["baseline", "Compare baseline", "One model, one pass"],
] as const;

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
    if (!file || loading) return;
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

  // Ctrl/⌘ + Enter runs Digitize from anywhere on the page.
  const digitizeRef = useRef(digitize);
  digitizeRef.current = digitize;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); digitizeRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    <div className="grid grid-cols-12 gap-5">
      {/* ---------- left: input & preprocessing ---------- */}
      <Card className="col-span-12 space-y-4 self-start lg:sticky lg:top-16 lg:col-span-5 xl:col-span-4">
        <SectionLabel>Input</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          <label className={`${ghostBtn} cursor-pointer`}>
            <ImageUp className="size-3.5" /> Upload
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          <button onClick={() => setCamOn((v) => !v)} className={ghostBtn}>
            <Camera className="size-3.5" /> {camOn ? "Close" : "Camera"}
          </button>
          <button onClick={() => { setPreview(null); setFile(null); load(SAMPLE, true); }} className={ghostBtn}>
            <FlaskConical className="size-3.5" /> Sample
          </button>
        </div>

        {camOn && (
          <div className="space-y-2">
            <video ref={video} autoPlay playsInline className="w-full rounded-lg border border-line bg-black" />
            <Button onClick={snapshot} className="w-full"><Camera className="size-3.5" /> Capture</Button>
          </div>
        )}

        {preview ? (
          <img src={preview} alt="Uploaded handwriting" className="well max-h-[360px] w-full rounded-lg border border-line object-contain" />
        ) : !camOn && (
          <label className="well group grid h-40 cursor-pointer place-items-center rounded-lg border border-dashed border-line text-center text-[12px] text-muted transition-all duration-150 ease-in-out hover:border-brand hover:text-body">
            <span className="space-y-1.5">
              <ImageUp className="mx-auto size-5" />
              <span className="block">Drop in a photo of a prescription, form or note</span>
            </span>
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
        )}

        <SectionLabel>Pipeline</SectionLabel>
        <div className="space-y-1.5">
          {OPTIONS.map(([k, label, hint]) => (
            <Toggle key={k} on={opts[k]} onChange={(v) => setOpts({ ...opts, [k]: v })} label={label} hint={hint} />
          ))}
        </div>

        <Button onClick={digitize} loading={loading} disabled={!file} className="w-full justify-between">
          <span className="flex items-center gap-2"><Wand2 className="size-3.5" /> {loading ? "Reading with every model…" : "Digitize"}</span>
          {!loading && <span className="flex gap-1"><Kbd>{MOD}</Kbd><Kbd>↵</Kbd></span>}
        </Button>
        <ErrorNote error={error} />
      </Card>

      {/* ---------- right: analytics & verification ---------- */}
      <div className="col-span-12 space-y-4 lg:col-span-7 xl:col-span-8">
        {loading ? (
          <Card flush className="overflow-hidden">
            <PenAnimation page="musing" className="h-[420px]" />
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px]">
              <span className="title !text-[15px]">Consulting every model…</span>
              <span className="text-muted">Each model reads the page on its own, then they vote word by word</span>
            </div>
          </Card>
        ) : !result ? (
          <Card className="grid min-h-80 place-items-center text-center">
            <div className="max-w-sm space-y-3">
              <span className="elev mx-auto grid size-10 place-items-center rounded-lg text-body"><ShieldCheck className="size-5" /></span>
              <p className="title">Nothing digitized yet</p>
              <p className="text-[13px] leading-relaxed text-muted">
                Every word is read by several AI models. Where they disagree, ClearScript flags it instead of guessing.
              </p>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Words" value={real.length} dot="bg-muted" />
              <Stat label="Still flagged" value={flaggedLeft} dot={flaggedLeft ? "bg-warn" : "bg-ok"} />
              <Stat label="Avg agreement" value={`${Math.round(avgConf * 100)}%`} dot="bg-info" />
              <Stat label="Questions asked" value={asked} dot="bg-brand" hint={`${byContext} fixed by context`} />
            </div>

            <Card flush className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-1 rounded-lg bg-well p-0.5 text-[12px]">
                  {(["auto", "review"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium tracking-tight transition-all duration-150 ease-in-out ${mode === m ? "bg-brand-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]" : "text-muted hover:text-ink"}`}
                    >
                      {m === "auto" ? <Sparkles className="size-3.5" /> : <UserCheck className="size-3.5" />}
                      {m === "auto" ? "Auto" : "Ask the human"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {isSample && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">sample</span>}
                  <IconBtn title="Copy text" aria-label="Copy text" onClick={() => navigator.clipboard.writeText(text)}><ClipboardCopy className="size-3.5" /></IconBtn>
                  <IconBtn title="Download .txt" aria-label="Download text" onClick={() => download(text)}><Download className="size-3.5" /></IconBtn>
                </div>
              </div>
              <div className="space-y-3 px-4 pb-4">
                <WordText words={words} />
                <Legend />
              </div>
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

const ghostBtn =
  "elev inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium tracking-tight text-body hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="engraved text-muted">{children}</div>;
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`elev flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${on ? "!border-brand/60" : ""}`}
    >
      <span>
        <span className="block text-[13px] font-medium tracking-tight text-ink">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
      <span className={`relative h-[18px] w-8 shrink-0 rounded-full transition-all duration-150 ease-in-out ${on ? "bg-brand" : "bg-line"}`}>
        <span className={`absolute top-[3px] size-3 rounded-full bg-white shadow transition-all duration-150 ease-in-out ${on ? "left-[17px]" : "left-[3px]"}`} />
      </span>
    </button>
  );
}

function Stat({ label, value, hint, dot }: { label: string; value: string | number; hint?: string; dot: string }) {
  return (
    <div className="surface rounded-xl px-4 py-3">
      <div className="engraved flex items-center gap-1.5 text-muted">
        <span className={`size-1.5 rounded-full ${dot}`} />{label}
      </div>
      <div className="mt-2 font-display text-[24px] font-semibold leading-none tabular-nums text-ink">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function IconBtn(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="elev grid size-7 place-items-center rounded-md text-body hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" />;
}

function wordCls(w: Word) {
  if (w.flagged) return "border border-warn-line bg-warn-bg text-warn-fg underline decoration-warn decoration-wavy decoration-1 underline-offset-[4px]";
  if (w.resolved_by === "human") return "border border-ok-line bg-ok-bg text-ok-fg";
  if (w.resolved_by === "context") return "border border-info-line bg-info-bg text-info-fg";
  return "border border-transparent";
}

function WordText({ words }: { words: Word[] }) {
  return (
    <div className="well rounded-lg border border-line p-4 font-mono text-xs leading-relaxed text-ink [&>span]:my-[3px] [&>span]:mr-1 [&>span]:inline-block">
      {words.map((w, i) =>
        isNewline(w) ? <br key={i} /> : (
          <span key={i} className="group relative">
            <span className={`rounded-full px-1.5 py-px transition-all duration-150 ease-in-out ${wordCls(w)}`}>{w.text}</span>
            <span role="tooltip" className="surface pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 hidden w-max max-w-64 rounded-md px-2 py-1 font-sans text-[11px] leading-5 text-body shadow-xl group-hover:block">
              <span className="font-mono text-ink">{Math.round((w.confidence ?? 0) * 100)}%</span> of models agree
              {w.resolved_by && <> · fixed by {w.resolved_by}</>}
              {!!w.alternatives?.length && <><br />others read: <span className="font-mono">{w.alternatives.join(", ")}</span></>}
            </span>
          </span>
        ),
      )}
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5"><span className={`inline-block h-2.5 w-4 rounded-full ${cls}`} />{label}</span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-body">
      {item("border border-warn-line bg-warn-bg", "Needs check")}
      {item("border border-info-line bg-info-bg", "Fixed by context")}
      {item("border border-ok-line bg-ok-bg", "Confirmed")}
      <span className="ml-auto text-muted">Hover a word for details</span>
    </div>
  );
}

function ReviewPanel({ words, queue, writer, setWriter, onAnswer, onSkip }: {
  words: Word[]; queue: number[]; writer: string; setWriter: (s: string) => void;
  onAnswer: (i: number, text: string) => void; onSkip: (i: number) => void;
}) {
  const [typed, setTyped] = useState("");
  const i = queue[0];
  const w = i === undefined ? undefined : words[i];
  const options = w ? [...new Set([w.text, ...(w.alternatives ?? [])])].filter((x) => x && x !== "[?]") : [];
  const submit = (t: string) => { if (i !== undefined && t.trim()) { onAnswer(i, t.trim()); setTyped(""); } };

  // 1-9 picks a candidate, Esc skips. Digits are ignored while typing in a field.
  const keys = useRef({ submit, options, i, onSkip });
  keys.current = { submit, options, i, onSkip };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { submit, options, i, onSkip } = keys.current;
      if (i === undefined || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
      if (e.key === "Escape") { e.preventDefault(); onSkip(i); return; }
      if (!typing && /^[1-9]$/.test(e.key) && options[+e.key - 1]) { e.preventDefault(); submit(options[+e.key - 1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (i === undefined || !w) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-ok-line bg-ok-bg px-4 py-3 text-[13px] font-medium text-ok-fg">
        <Check className="size-4" /> Nothing left to ask. Every flagged word has been checked.
      </div>
    );
  }
  const before = words.slice(Math.max(0, i - 5), i).filter((x) => !isNewline(x)).map((x) => x.text).join(" ");
  const after = words.slice(i + 1, i + 6).filter((x) => !isNewline(x)).map((x) => x.text).join(" ");

  return (
    <Card flush className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="title flex items-center gap-2">
          <HelpCircle className="size-4 text-warn" /> Which word is this?
          {hasDigit(w.text) && (
            <span className="rounded-full border border-del-line bg-del-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-del-fg">number · never guessed</span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted">{queue.length} left</span>
      </div>

      <div className="space-y-4 px-4 pb-4">
        <p className="well rounded-lg border border-line px-3 py-2.5 font-mono text-xs leading-relaxed text-body">
          …{before} <span className="rounded-full border border-warn-line bg-warn-bg px-1.5 py-px text-warn-fg">{w.text}</span> {after}…
        </p>

        <div className="flex flex-wrap gap-2">
          {options.map((o, k) => (
            <button
              key={o}
              onClick={() => submit(o)}
              className="elev flex min-w-24 items-center justify-between gap-3 rounded-lg px-3 py-2 font-mono text-xs text-ink hover:!border-brand active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {o}
              {k < 9 && <span className="text-muted"><Kbd>{k + 1}</Kbd></span>}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input className={inputCls} placeholder="Or type the correct word" value={typed}
            onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(typed)} />
          <Button onClick={() => submit(typed)} disabled={!typed.trim()}>Confirm <Kbd>↵</Kbd></Button>
          <button onClick={() => onSkip(i)} title="Skip this word" aria-label="Skip this word" className={`${ghostBtn} !py-0`}>
            Skip <Kbd>Esc</Kbd>
          </button>
        </div>

        <label className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wider">Writer</span>
          <input className={`${inputCls} max-w-40 !py-1 font-mono !text-[11px]`} value={writer} onChange={(e) => setWriter(e.target.value)} />
          <span>Answers are final and teach this writer's word list</span>
        </label>
      </div>
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
    <Card flush>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="title">Baseline vs ClearScript</span>
        <span className="font-mono text-[11px]">
          <span className="text-del-fg">−{changed}</span> <span className="text-add-fg">+{b.length - keepB.size}</span>
        </span>
      </div>
      <div className="grid sm:grid-cols-2">
        <div className="border-line sm:border-r">
          <div className="border-b border-line px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">One model, one pass</div>
          <p className="px-4 py-3 font-mono text-xs leading-relaxed text-body">{show(a, keepA, "border border-del-line bg-del-bg text-del-fg line-through")}</p>
        </div>
        <div className="border-t border-line sm:border-t-0">
          <div className="border-b border-line px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">ClearScript</div>
          <p className="px-4 py-3 font-mono text-xs leading-relaxed text-body">{show(b, keepB, "border border-add-line bg-add-bg text-add-fg")}</p>
        </div>
      </div>
    </Card>
  );
}

function Readings({ readings, errors }: { readings: Record<string, string>; errors: Record<string, string> }) {
  return (
    <details className="surface group rounded-xl">
      <summary className="title flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
        What each model read
        <span className="font-mono text-[11px] text-muted">
          {Object.keys(readings).length} ok{Object.keys(errors).length ? ` · ${Object.keys(errors).length} failed` : ""}
          <span className="ml-2 inline-block transition-transform duration-150 group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
        {Object.entries(readings).map(([name, t]) => (
          <div key={name}>
            <div className="mb-1 truncate font-mono text-[11px] text-muted">{name}</div>
            <pre className="well whitespace-pre-wrap rounded-lg border border-line p-3 font-mono text-xs text-body">{t}</pre>
          </div>
        ))}
        {Object.entries(errors).map(([name, e]) => (
          <div key={name}>
            <div className="mb-1 truncate font-mono text-[11px] text-del-fg">{name}</div>
            <pre className="whitespace-pre-wrap rounded-lg border border-del-line bg-del-bg p-3 text-xs text-del-fg">{e}</pre>
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
