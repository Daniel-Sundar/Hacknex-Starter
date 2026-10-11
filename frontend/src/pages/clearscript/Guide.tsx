import { ScanText } from "lucide-react";
import { Panel } from "../../components/ui";
import { useT } from "../../i18n";
import { modelLabel } from "../../lib/progress";

/** Shown before the first result: the four steps, or what will happen with the chosen page. */
export function Guide({ ready, name, readers }: { ready: boolean; name: string; readers?: string[] }) {
  const { t } = useT();
  return (
    <div className="space-y-4">
      {ready ? (
        <Panel title={t("cs.ready.title")}>
          <div className="space-y-2 text-sm text-body">
            <p className="break-words">{t("cs.ready.body", { name })}</p>
            {readers && readers.length > 0 && (
              <p className="text-xs text-muted">{t("cs.ready.models", { models: readers.map(modelLabel).join(", ") })}</p>
            )}
          </div>
        </Panel>
      ) : (
        <Panel title={t("cs.guide.title")} className="@container">
          <ol className="grid gap-x-6 gap-y-4 @md:grid-cols-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex gap-3">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{n}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{t(`cs.guide.step${n}`)}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted">{t(`cs.guide.step${n}.hint`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <p className="flex items-start gap-2 px-1 text-xs text-muted"><ScanText className="mt-px size-4 shrink-0" aria-hidden="true" />{t("cs.guide.privacy")}</p>
    </div>
  );
}
