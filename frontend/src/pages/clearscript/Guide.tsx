import { Check, ShieldCheck } from "lucide-react";
import { Panel } from "../../components/ui";
import { useT } from "../../i18n";
import { modelLabel } from "../../lib/progress";

/** The workbench's context pane: the four steps as a progress rail (driven by real state: no page yet,
 *  page ready, result shown), what will happen with the chosen page, and the processing notice. */
export function Guide({ stage, name, readers }: { stage: 1 | 2 | 3; name: string; readers?: string[] }) {
  const { t } = useT();
  return (
    <div className="flex h-full min-w-0 flex-col">
      <Panel flat title={t("cs.guide.title")} bodyClassName="space-y-5 p-5 sm:p-6">
        <ol className="space-y-0">
          {([1, 2, 3, 4] as const).map((n) => {
            const done = n < stage;
            const now = n === stage;
            return (
              <li key={n} className="relative flex gap-3 pb-5 last:pb-0" aria-current={now ? "step" : undefined}>
                {n < 4 && <span aria-hidden="true" className={`absolute start-[0.8125rem] top-8 bottom-1 w-px ${done ? "bg-accent" : "bg-line"}`} />}
                <span aria-hidden="true" className={`relative grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  done ? "bg-accent text-accent-fg" : now ? "bg-accent-soft text-accent-text ring-1 ring-accent" : "border border-line bg-surface text-muted"}`}>
                  {done ? <Check className="size-3.5" /> : n}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className={`block text-sm font-semibold ${now || done ? "text-ink" : "text-body"}`}>{t(`cs.guide.step${n}`)}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted">{t(`cs.guide.step${n}.hint`)}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {stage === 2 && (
          <div className="space-y-1 rounded-md bg-subtle p-3 text-sm" role="status">
            <p className="font-semibold text-ink">{t("cs.ready.title")}</p>
            <p className="break-words text-body">{t("cs.ready.body", { name })}</p>
            {readers && readers.length > 0 && (
              <p className="text-xs text-muted">{t("cs.ready.models", { models: readers.map(modelLabel).join(", ") })}</p>
            )}
          </div>
        )}
      </Panel>

      <div className="mt-auto space-y-1.5 border-t border-line px-5 py-4 sm:px-6">
        <p className="cs-label flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden="true" />{t("cs.guide.privacyTitle")}</p>
        <p className="text-xs leading-relaxed text-muted">
          {t("cs.guide.privacy")}{" "}
          <a href="#/privacy" className="font-medium text-accent-text underline-offset-2 hover:underline">{t("legal.footer.privacy")}</a>
        </p>
      </div>
    </div>
  );
}
