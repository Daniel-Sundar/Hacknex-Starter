import { ScanText } from "lucide-react";
import { Notice } from "../../components/ui";
import { useT } from "../../i18n";
import { modelLabel } from "../../lib/progress";

/** Quiet contextual help: what will happen with the chosen page (if any), and the four steps.
 *  Deliberately not a competing panel — it reads as a caption to Add a page, not a second workflow. */
export function Guide({ ready, name, readers, className = "" }: { ready: boolean; name: string; readers?: string[]; className?: string }) {
  const { t } = useT();
  return (
    <div className={`space-y-6 ${className}`}>
      {ready && (
        <Notice tone="info" title={t("cs.ready.title")}>
          <p className="break-words">{t("cs.ready.body", { name })}</p>
          {readers && readers.length > 0 && (
            <p className="mt-1 text-xs text-muted">{t("cs.ready.models", { models: readers.map(modelLabel).join(", ") })}</p>
          )}
        </Notice>
      )}

      <div className="@container border-t border-line pt-6">
        <h2 className="text-sm font-semibold text-muted">{t("cs.guide.title")}</h2>
        <ol className="mt-3 grid gap-x-6 gap-y-4 @sm:grid-cols-2 @2xl:grid-cols-4">
          {([1, 2, 3, 4] as const).map((n) => (
            <li key={n} className="flex gap-2.5 @sm:block">
              <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-muted @sm:mb-2">{n}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-body">{t(`cs.guide.step${n}`)}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{t(`cs.guide.step${n}.hint`)}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="flex items-start gap-2 px-1 text-xs text-muted"><ScanText className="mt-px size-4 shrink-0" aria-hidden="true" />{t("cs.guide.privacy")}</p>
    </div>
  );
}
