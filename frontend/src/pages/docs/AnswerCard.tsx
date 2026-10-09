// One answer: the question, the grounding indicator, the Markdown answer with [n] citation buttons, and the
// numbered sources those buttons jump to.
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Notice } from "../../components/ui";
import { useT } from "../../i18n";
import { citedNumbers, remarkCitations, type Source } from "./lib";

export type Answer = { id: number; question: string; answer: string; sources: Source[]; grounded: boolean };

// Answer typography. Markdown headings are rendered as bold paragraphs (below) so they can't break the page outline.
const MD =
  "space-y-3 text-sm leading-relaxed text-ink wrap-break-word " +
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:ps-6 " +
  "[&_strong]:font-semibold [&_code]:font-mono [&_code]:text-xs [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-subtle [&_:not(pre)>code]:px-1 " +
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-subtle [&_pre]:p-3 " +
  "[&_blockquote]:border-s-2 [&_blockquote]:border-line-strong [&_blockquote]:ps-3 [&_blockquote]:text-body [&_hr]:border-line";

const LONG_EXCERPT = 240;

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function AnswerCard({ entry, open, onToggle, collapsible }: {
  entry: Answer; open: boolean; onToggle: () => void; collapsible: boolean;
}) {
  const { t, num } = useT();
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  // Only a grounded answer with sources gets citations; otherwise every marker stays plain text.
  const sources = entry.grounded ? entry.sources : [];
  const grounded = sources.length > 0;
  const cited = useMemo(() => citedNumbers(entry.answer), [entry.answer]);
  const unmatched = grounded && cited.some((n) => n < 1 || n > sources.length);

  const srcId = (n: number) => `${uid}-src-${n}`;
  const cite = (n: number) => {
    setActive(n);
    setExpanded((s) => new Set(s).add(n));
    requestAnimationFrame(() => {
      const el = document.getElementById(srcId(n));
      el?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
      el?.focus({ preventScroll: true });
    });
  };
  const citeRef = useRef(cite);
  citeRef.current = cite;

  const components = useMemo<Components>(() => {
    const asText = ({ children }: { children?: ReactNode }) => <p className="font-semibold text-ink">{children}</p>;
    return {
      h1: asText, h2: asText, h3: asText, h4: asText, h5: asText, h6: asText,
      a: ({ node, href, children }) => {
        const n = Number(node?.properties?.dataCite);
        const src = n ? sources[n - 1] : undefined;
        if (src) {
          return (
            <button
              type="button"
              onClick={() => citeRef.current(n)}
              aria-label={t("docs.cite.label", { n, name: src.source })}
              title={t("docs.cite.label", { n, name: src.source })}
              aria-controls={`${uid}-src-${n}`}
              className="ms-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-md border border-accent bg-accent-soft px-1 align-baseline text-xs font-semibold leading-none text-accent-text hover:bg-accent hover:text-accent-fg"
            >
              {num(n)}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-accent-text underline underline-offset-2">
            {children}<span className="sr-only"> {t("docs.answer.newTab")}</span>
          </a>
        );
      },
    };
  }, [sources, t, num, uid]);

  const remarkPlugins = useMemo<Options["remarkPlugins"]>(() => [[remarkCitations, { count: sources.length }]], [sources.length]);
  const qId = `${uid}-q`;
  const bodyId = `${uid}-body`;

  return (
    <article aria-labelledby={qId} className="min-w-0 rounded-lg border border-line bg-surface">
      <header className={`flex flex-wrap items-start gap-3 px-4 py-3 ${open ? "border-b border-line" : ""}`}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-muted">{t("docs.answer.asked")}</p>
          <h3 id={qId} className="wrap-break-word text-base font-semibold text-ink">{entry.question}</h3>
        </div>
        {collapsible && (
          <Button variant="ghost" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            {open ? t("docs.answer.hide") : t("docs.answer.show")}
          </Button>
        )}
      </header>

      <div id={bodyId} hidden={!open} className="space-y-4 p-4">
        {grounded ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok" icon={<ShieldCheck className="size-3" aria-hidden="true" />}>{t("docs.answer.grounded")}</Badge>
            <p className="text-xs text-muted">{t("docs.answer.checkCited")}</p>
          </div>
        ) : (
          <Notice tone="flag" title={t("docs.answer.ungrounded.title")}>{t("docs.answer.ungrounded.body")}</Notice>
        )}

        <div className={MD}>
          <Markdown skipHtml disallowedElements={["img"]} remarkPlugins={remarkPlugins} components={components}>
            {entry.answer}
          </Markdown>
        </div>

        {grounded && !cited.length && <Notice tone="info">{t("docs.answer.noCites")}</Notice>}
        {unmatched && <Notice tone="flag">{t("docs.answer.badCites")}</Notice>}

        {grounded && (
          <section aria-labelledby={`${uid}-sh`} className="space-y-2 border-t border-line pt-4">
            <h4 id={`${uid}-sh`} className="text-sm font-semibold text-ink">{t("docs.sources.title")}</h4>
            <ol role="list" className="divide-y divide-line">
              {sources.map((s, i) => {
                const n = i + 1;
                const long = s.text.length > LONG_EXCERPT;
                const isOpen = !long || expanded.has(n);
                const exId = `${uid}-ex-${n}`;
                return (
                  <li key={n} id={srcId(n)} tabIndex={-1}
                    className={`scroll-mt-24 rounded-md px-3 py-3 transition-colors duration-150 ${active === n ? "bg-accent-soft" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span aria-hidden="true"
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${active === n ? "bg-accent text-accent-fg" : "bg-subtle text-ink"}`}>
                        {num(n)}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="wrap-anywhere text-sm font-medium text-ink">
                          <span className="sr-only">{t("docs.sources.number", { n })} </span>{s.source}
                          {s.page ? <span className="font-normal text-muted"> · {t("docs.sources.page", { page: s.page })}</span> : null}
                        </p>
                        <blockquote id={exId} className={`wrap-break-word border-s-2 border-line-strong ps-3 text-sm text-body ${isOpen ? "" : "line-clamp-3"}`}>
                          {s.text}
                        </blockquote>
                        {long && (
                          <Button variant="ghost" aria-expanded={isOpen} aria-controls={exId} className="-ms-4"
                            onClick={() => setExpanded((x) => { const y = new Set(x); if (y.has(n)) y.delete(n); else y.add(n); return y; })}>
                            {isOpen ? t("docs.sources.less") : t("docs.sources.more")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </article>
  );
}
