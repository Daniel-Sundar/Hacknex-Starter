// Main column: the question form, the answer being fetched, and this session's earlier answers.
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FileQuestion, Info, Loader2, MessageSquareText } from "lucide-react";
import { Button, EmptyState, Panel, inputCls, useToast } from "../../components/ui";
import { ApiError, postJSON } from "../../lib/api";
import { useT, type MessageKey } from "../../i18n";
import { AnswerCard, type Answer } from "./AnswerCard";
import { COUNTER_FROM, MAX_QUESTION, describeDocsError, type AskResult } from "./lib";
import { ProblemState } from "./Problem";
import { useAnnouncer } from "./useDocuments";

/** What the documents side knows: decides whether Ask is available and which empty state shows. */
export type DocsStatus = "loading" | "empty" | "uploading" | "ready" | "unknown";

const KEEP = 10; // answers kept in this session
const WHY_DISABLED: Partial<Record<DocsStatus, MessageKey>> = {
  loading: "docs.ask.waitList",
  uploading: "docs.ask.waitUpload",
  empty: "docs.ask.needDocs",
};

type Current = { question: string; status: "pending" } | { question: string; status: "error"; error: unknown };

export function AskPanel({ status, limitMb, onNoDocs }: { status: DocsStatus; limitMb: number; onNoDocs: () => void }) {
  const { t, tn, num } = useT();
  const { toast } = useToast();
  const say = useAnnouncer();
  const [question, setQuestion] = useState("");
  const [inputError, setInputError] = useState<"empty" | "long" | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const nextId = useRef(1);
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const ids = useId();

  const pending = current?.status === "pending";
  const reason = WHY_DISABLED[status];
  const canAsk = !reason;
  const used = question.trim().length;
  const over = Math.max(0, used - MAX_QUESTION);

  async function ask(q: string) {
    setCurrent({ question: q, status: "pending" });
    try {
      const r = await postJSON<AskResult>("/api/docs/ask", { text: q });
      const sources = Array.isArray(r.sources) ? r.sources.filter((s) => s && typeof s.text === "string") : [];
      const entry: Answer = {
        // An older backend sends no `grounded`: then having sources is what grounds the answer.
        id: nextId.current++, question: q, answer: String(r.answer ?? ""), sources, grounded: (r.grounded ?? true) && sources.length > 0,
      };
      setAnswers((a) => [entry, ...a].slice(0, KEEP));
      setOpenIds(new Set([entry.id])); // newest open, earlier ones fold away
      setCurrent(null);
      setQuestion((now) => (now.trim() === q ? "" : now)); // keep anything typed while waiting
      say(entry.grounded ? tn("docs.ask.ready", entry.sources.length) : t("docs.ask.readyUngrounded"));
      // The tab stays mounted: if the user went elsewhere, tell them the answer is here.
      if (root.current?.closest("[hidden]")) toast(t("docs.ask.readyElsewhere"), "ok");
    } catch (e) {
      setCurrent({ question: q, status: "error", error: e });
      if (e instanceof ApiError && e.code === "no_docs") onNoDocs(); // the server lost them (restart): refresh the list
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    const problem = !q ? "empty" : q.length > MAX_QUESTION ? "long" : null;
    setInputError(problem);
    if (problem) { box.current?.focus(); return; }
    if (!canAsk || pending) return;
    void ask(q);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter asks; Shift+Enter is a new line. Never while an input method is composing (Indic and CJK keyboards).
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  const hintId = `${ids}-hint`;
  const countId = `${ids}-count`;
  const errId = `${ids}-err`;
  const whyId = `${ids}-why`;
  const showCounter = used >= COUNTER_FROM;
  const describedBy = [hintId, showCounter ? countId : "", inputError ? errId : ""].filter(Boolean).join(" ");

  return (
    <div ref={root} className="min-w-0 space-y-6">
      <Panel title={t("docs.ask.title")}>
        <form onSubmit={submit} noValidate className="space-y-2">
          <label htmlFor={`${ids}-q`} className="block text-sm font-medium text-ink">{t("docs.ask.label")}</label>
          <textarea
            ref={box}
            id={`${ids}-q`}
            rows={2}
            value={question}
            onChange={(e) => { setQuestion(e.target.value); if (inputError) setInputError(null); }}
            onKeyDown={onKeyDown}
            aria-describedby={describedBy}
            aria-invalid={inputError ? true : undefined}
            className={`${inputCls} block resize-y py-2 leading-relaxed`}
          />
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p id={hintId} className="text-xs text-muted">{t("docs.ask.hint")}</p>
            {showCounter && (
              <p id={countId} className={`text-xs ${over ? "font-medium text-danger-fg" : "text-muted"}`}>
                {over ? tn("docs.ask.over", over) : t("docs.ask.counter", { count: used, max: MAX_QUESTION })}
              </p>
            )}
          </div>
          {inputError && (
            <p id={errId} className="text-xs font-medium text-danger-fg">
              {inputError === "empty" ? t("docs.ask.empty") : t("docs.ask.tooLong", { max: MAX_QUESTION })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={!canAsk}
              aria-describedby={reason ? whyId : undefined}
              icon={<MessageSquareText className="size-4" aria-hidden="true" />}
            >
              {t("docs.ask.submit")}
            </Button>
            {reason && (
              <p id={whyId} className="flex min-w-0 flex-1 items-start gap-2 text-sm text-muted">
                <span className="flex h-5 shrink-0 items-center"><Info className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0">{t(reason)}</span>
              </p>
            )}
          </div>
        </form>
      </Panel>

      {current || answers.length ? (
        <section aria-labelledby={`${ids}-ah`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={`${ids}-ah`} className="text-sm font-semibold text-ink">{t("docs.answers.title")}</h2>
            <p className="text-xs text-muted">{t("docs.answers.note")}</p>
          </div>

          {current && (
            <article aria-labelledby={`${ids}-cq`} aria-busy={pending || undefined} className="min-w-0 rounded-lg border border-line bg-surface">
              <header className="space-y-1 border-b border-line px-4 py-3">
                <p className="text-xs text-muted">{t("docs.answer.asked")}</p>
                <h3 id={`${ids}-cq`} className="wrap-break-word text-base font-semibold text-ink">{current.question}</h3>
              </header>
              <div className="p-4">
                {current.status === "pending" ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />{t("docs.ask.pending")}
                  </p>
                ) : (
                  <ProblemState problem={describeDocsError(current.error, limitMb)} onRetry={() => void ask(current.question)} />
                )}
              </div>
            </article>
          )}

          {answers.length > 0 && (
            <ol role="list" className="space-y-3">
              {answers.map((a) => (
                <li key={a.id}>
                  <AnswerCard
                    entry={a}
                    open={openIds.has(a.id)}
                    collapsible={answers.length > 1}
                    onToggle={() => setOpenIds((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : status === "loading" ? null : status === "ready" || status === "unknown" ? (
        <EmptyState icon={<MessageSquareText className="size-5" />} title={t("docs.noAnswers.title")}>
          {t("docs.noAnswers.body")}
        </EmptyState>
      ) : (
        <EmptyState icon={<FileQuestion className="size-5" />} title={t("docs.empty.title")}>
          <ol role="list" className="space-y-3 text-start">
            {(["docs.empty.step1", "docs.empty.step2", "docs.empty.step3"] as const).map((k, i) => (
              <li key={k} className="flex items-start gap-3">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
                  {num(i + 1)}
                </span>
                <span className="min-w-0 leading-6 text-body">{t(k)}</span>
              </li>
            ))}
          </ol>
        </EmptyState>
      )}
    </div>
  );
}
