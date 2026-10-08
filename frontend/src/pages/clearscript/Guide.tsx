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
        <Panel title={t("cs.guide.title")}>
          <ol className="grid gap-3 sm:grid-cols-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex gap-3">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{n}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t(`cs.guide.step${n}`)}</span>
                  <span className="block text-xs text-muted">{t(`cs.guide.step${n}.hint`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <p className="flex items-center gap-2 text-xs text-muted"><ScanText className="size-4" aria-hidden="true" />{t("cs.guide.privacy")}</p>
    </div>
  );
}
