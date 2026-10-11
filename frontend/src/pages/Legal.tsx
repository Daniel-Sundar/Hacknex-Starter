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

  return (
    <article className="cs-legal mx-auto max-w-prose space-y-6 text-sm leading-relaxed text-body">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href="#/clearscript" className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 font-medium text-accent-text underline-offset-2 hover:underline">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" /> {t("legal.back")}
        </a>
        <button type="button" onClick={() => window.print()}
          className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-muted hover:bg-subtle hover:text-ink">
          <Printer className="size-4" aria-hidden="true" /> {t("legal.print")}
        </button>
      </div>
      <header className="space-y-2">
        <p className="text-xs text-muted"><time dateTime={UPDATED}>{t("legal.updated", { date })}</time></p>
        <p>{t(k(`legal.${page}.intro`))}</p>
        <p role="note" className="rounded-md border border-line bg-subtle px-3 py-2 text-xs text-body">{t("legal.draft")}</p>
      </header>

      {page === "privacy" && (
        <section aria-labelledby="legal-short" className="space-y-2">
          <h2 id="legal-short" className="text-base font-semibold text-ink">{t("legal.privacy.short.title")}</h2>
          <ul className="list-disc space-y-1 ps-5">
            {SUMMARY.filter((s) => s !== "account" || supabaseEnabled).map((s) => <li key={s}>{t(k(`shell.privacy.${s}`))}</li>)}
          </ul>
        </section>
      )}

      {SECTIONS[page].map((n) => (
        <section key={n} aria-labelledby={`legal-${page}-${n}`} className="space-y-2">
          <h2 id={`legal-${page}-${n}`} className="text-base font-semibold text-ink">{t(k(`legal.${page}.s${n}.title`))}</h2>
          {Array.from({ length: PARAS[`${page}.${n}`] ?? 1 }, (_, i) => (
            <p key={i}>{t(k(`legal.${page}.s${n}.p${i + 1}`), { contact })}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
