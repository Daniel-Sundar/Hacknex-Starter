import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Badge, Button, Dialog, Notice, type Tone } from "../../components/ui";
import { useT } from "../../i18n";
import { agreement, candidates, hasDigit, isMarginTag, isNewline, wordStatus, type Word, type WordStatus } from "../../lib/handwriting";
import { modelLabel } from "../../lib/progress";

const TONE: Record<WordStatus, Tone> = { agreed: "ok", likely: "neutral", flagged: "flag", lookalike: "danger", context: "info", guess: "info", human: "ok" };

/** One word up close: what each model read, why it is (or isn't) flagged, and the person's final answer.
 *  In review mode it steps through the flagged words. */
export function WordDialog({ open, index, words, models, writer, review, onClose, onConfirm, onSkip }: {
  open: boolean; index: number | null; words: Word[]; models: number; writer: string;
  review: { pos: number; total: number } | null;
  onClose: () => void; onConfirm: (i: number, text: string) => void; onSkip: () => void;
}) {
  const { t } = useT();
  const [typed, setTyped] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTyped("");
    // In review mode the dialog stays open while the word changes: move focus to the new first choice.
    if (open) box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [index, open]);
  const w = index !== null ? words[index] : undefined;
  if (!w || index === null) return <Dialog open={false} onClose={onClose} title=""><span /></Dialog>;

  const st = wordStatus(w);
  const options = candidates(w);
  const { votes, of } = agreement(w, models);
  const ctx = (from: number, to: number) =>
    words.slice(Math.max(0, from), Math.max(0, to)).filter((x) => !isNewline(x) && !isMarginTag(x)).map((x) => x.text).join(" ");
  const before = ctx(index - 6, index);
  const after = ctx(index + 1, index + 7);
  const number = hasDigit(w.text) || options.some(hasDigit);

  const submit = (e: FormEvent) => { e.preventDefault(); if (typed.trim()) onConfirm(index, typed.trim()); };
  const onKey = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const pick = options[Number(e.key) - 1];
    if (pick) { e.preventDefault(); onConfirm(index, pick); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="36rem"
      initialFocus="[data-autofocus]"
      title={review ? t("cs.word.reviewTitle", { pos: review.pos, total: review.total }) : st === "agreed" || st === "human" ? t("cs.word.editTitle") : t("cs.word.checkTitle")}
      description={t("cs.word.keys")}
      footer={review ? (
        <>
          <Button variant="ghost" onClick={onClose}>{t("cs.review.stop")}</Button>
          <Button onClick={onSkip}>{t("cs.review.skip")}</Button>
        </>
      ) : <Button onClick={onClose}>{t("common.cancel")}</Button>}
    >
      <div ref={box} className="space-y-4" onKeyDown={onKey}>
        <p dir="auto" className="transcript rounded-md bg-subtle px-3 text-body">
          {before && <>…{before} </>}
          <mark className={`rounded px-1 ${st === "lookalike" ? "bg-danger-bg text-danger-fg" : st === "flagged" ? "bg-flag-bg text-flag-fg" : "bg-accent-soft text-accent-text"}`}>{w.text}</mark>
          {after && <> {after}…</>}
        </p>

        <div className="flex flex-wrap gap-2">
          <Badge tone={TONE[st]}>{t(`cs.status.${st}`)}</Badge>
          {number && <Badge tone="danger">{t("cs.word.number")}</Badge>}
          {of > 1 && <Badge>{t("cs.word.agree", { votes, of })}</Badge>}
        </div>

        {st === "lookalike" && (
          <Notice tone="danger">{t("cs.word.lookalike", { word: w.text, others: (w.lookalikes ?? []).join(", ") })}</Notice>
        )}
        {number && w.flagged && <Notice tone="flag">{t("cs.word.numberNote")}</Notice>}
        {w.resolved_by === "context" && (
          <Notice tone="info">{w.evidence === "lexicon" ? t("cs.word.byLexicon") : t("cs.word.byGuess")}</Notice>
        )}
        {w.resolved_by === "human" && w.original && w.original !== w.text && (
          <p className="text-xs text-muted">{t("cs.word.wasRead", { text: w.original })}</p>
        )}

        {w.by_model && Object.keys(w.by_model).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="pb-1 text-start text-xs font-semibold text-muted">{t("cs.word.models")}</caption>
              <tbody>
                {Object.entries(w.by_model).map(([m, read]) => {
                  const same = !!read && read.toLowerCase() === w.text.toLowerCase();
                  return (
                    <tr key={m} className="border-t border-line">
                      <th scope="row" className="py-2 pe-3 text-start align-top font-mono text-xs font-normal text-muted">{modelLabel(m)}</th>
                      <td className="py-2 align-top">
                        {read ? <span className="font-medium text-ink">{read}</span> : <span className="italic text-muted">{t("cs.word.nothing")}</span>}
                        {same && <span className="ms-2 inline-flex items-center gap-1 text-xs text-ok-fg"><Check className="size-3" aria-hidden="true" />{t("cs.word.shown")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (w.alternatives?.length ?? 0) > 0 && (
          <p className="text-sm text-body">{t("cs.word.others", { list: (w.alternatives ?? []).join(", ") })}</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">{t("cs.word.choose")}</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((o, k) => (
              <Button
                key={o}
                data-autofocus={k === 0 ? "" : undefined}
                variant={o === w.text ? "primary" : "secondary"}
                aria-keyshortcuts={k < 9 ? String(k + 1) : undefined}
                onClick={() => onConfirm(index, o)}
              >
                <span className="text-xs opacity-80" aria-hidden="true">{k + 1}</span>
                {o === w.text ? t("cs.word.keep", { text: o }) : o}
              </Button>
            ))}
          </div>
        </fieldset>

        <form onSubmit={submit} className="space-y-1">
          <label htmlFor="cs-word-input" className="block text-sm font-semibold text-ink">{t("cs.word.type")}</label>
          <div className="flex gap-2">
            <input id="cs-word-input" className="min-h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
              value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={80} />
            <Button type="submit" variant="primary" disabled={!typed.trim()}>{t("common.confirm")}</Button>
          </div>
        </form>

        <p className="border-t border-line pt-3 text-xs text-muted">
          {writer.trim() ? t("cs.word.savesTo", { writer: writer.trim() }) : t("cs.word.noProfile")}
        </p>
      </div>
    </Dialog>
  );
}
