// Privacy policy (#/privacy) and terms of use (#/terms). The copy lives in i18n/en/legal.ts.
import { ArrowLeft, Printer } from "lucide-react";
import { supabaseEnabled } from "../lib/supabase";
import { useT, type MessageKey } from "../i18n";

export type LegalPage = "privacy" | "terms";

const UPDATED = "2026-10-11";
const SECTIONS: Record<LegalPage, number[]> = {
  privacy: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  terms: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};
// How many paragraphs each section has (keys legal.<page>.s<n>.p1 ... pN).
const PARAS: Partial<Record<string, number>> = { "privacy.2": 7, "privacy.4": 2 };
const SUMMARY = ["models", "images", "writer", "history", "account", "docs", "medical"] as const;

export function Legal({ page }: { page: LegalPage }) {
  const { t, locale } = useT();
  const k = (key: string) => key as MessageKey;
  const contact = t("legal.contact");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${UPDATED}T00:00:00`));

  const jump = (id: string) => {
    const h = document.getElementById(id);
    if (!h) return;
    h.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    h.focus({ preventScroll: true });
  };
  const toc = [
    ...(page === "privacy" ? [{ id: "legal-short", label: t("legal.privacy.short.title") }] : []),
    ...SECTIONS[page].map((n) => ({ id: `legal-${page}-${n}`, label: t(k(`legal.${page}.s${n}.title`)) })),
  ];

  return (
    // A contents rail on subtle glass beside one opaque reading sheet (legal text needs maximum legibility).
    <div className="mx-auto grid max-w-[62rem] gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label={t("legal.toc")} className="cs-glass-subtle hidden rounded-2xl p-2 lg:sticky lg:top-6 lg:block print:hidden">
        <p className="cs-label px-3 pt-2 pb-1">{t("legal.toc")}</p>
        <ul className="space-y-0.5">
          {toc.map((x) => (
            <li key={x.id}>
              {/* Routing uses the hash, so these scroll instead of changing it. */}
              <a href={`#/${page}`} onClick={(e) => { e.preventDefault(); jump(x.id); }}
                className="flex min-h-9 items-center rounded-lg px-3 text-[0.8125rem] leading-snug text-body transition-colors duration-150 hover:bg-[var(--control)] hover:text-ink">
                {x.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="cs-legal cs-solid min-w-0 space-y-8 rounded-2xl px-5 py-6 text-[0.9375rem] leading-7 text-body sm:px-10 sm:py-9">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <a href="#/clearscript" className="-ms-2 inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-accent-text underline-offset-2 hover:underline">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" /> {t("legal.back")}
          </a>
          <button type="button" onClick={() => window.print()}
            className="cs-control inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium text-body hover:text-ink">
            <Printer className="size-4" aria-hidden="true" /> {t("legal.print")}
          </button>
        </div>
        <header className="space-y-3">
          <p className="text-xs font-medium tracking-wide text-muted uppercase"><time dateTime={UPDATED}>{t("legal.updated", { date })}</time></p>
          <p className="text-base leading-7 text-ink">{marked(t(k(`legal.${page}.intro`)))}</p>
          <p role="note" className="rounded-xl border border-flag-line bg-flag-bg px-4 py-3 text-sm leading-6 text-ink">{t("legal.draft")}</p>
        </header>

        {page === "privacy" && (
          <section aria-labelledby="legal-short" className="cs-well space-y-2 rounded-xl px-5 py-4">
            <h2 id="legal-short" tabIndex={-1} className="scroll-mt-24 text-base font-semibold text-ink outline-none">{t("legal.privacy.short.title")}</h2>
            <ul className="list-disc space-y-1 ps-5 marker:text-accent-text">
              {SUMMARY.filter((s) => s !== "account" || supabaseEnabled).map((s) => <li key={s}>{marked(t(k(`shell.privacy.${s}`)))}</li>)}
            </ul>
          </section>
        )}

        {SECTIONS[page].map((n) => (
          <section key={n} aria-labelledby={`legal-${page}-${n}`} className="space-y-2">
            <h2 id={`legal-${page}-${n}`} tabIndex={-1} className="flex scroll-mt-24 items-baseline gap-3 text-lg font-semibold tracking-tight text-ink outline-none">
              <span aria-hidden="true" className="w-6 shrink-0 text-sm font-medium tabular-nums text-muted">{n}</span>
              {t(k(`legal.${page}.s${n}.title`))}
            </h2>
            {Array.from({ length: PARAS[`${page}.${n}`] ?? 1 }, (_, i) => (
              <p key={i} className="sm:ps-9">{marked(t(k(`legal.${page}.s${n}.p${i + 1}`), { contact }))}</p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}

/** Text in [square brackets] is a placeholder the team still has to fill in: highlight it so nobody mistakes it
 *  for a settled statement (the draft note above says what the highlight means). */
function marked(text: string) {
  return text.split(/(\[[^\]]+\])/).map((part, i) =>
    /^\[[^\]]+\]$/.test(part)
      ? <mark key={i} className="rounded bg-flag-bg px-1 text-flag-fg ring-1 ring-flag-line/40">{part}</mark>
      : part);
}
