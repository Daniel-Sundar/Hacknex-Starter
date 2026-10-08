import { FlaskConical, ScanText } from "lucide-react";
import { Badge, Button, Panel } from "../../components/ui";
import { useT } from "../../i18n";
import { modelLabel } from "../../lib/progress";

/** Shown before the first result: the four steps, and a small static example of how results read.
 *  The example is labelled as such; nothing here pretends to be the user's data. */
export function Guide({ onSample, ready, name, readers }: { onSample: () => void; ready: boolean; name: string; readers?: string[] }) {
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button icon={<FlaskConical className="size-4" aria-hidden="true" />} onClick={onSample}>{t("cs.input.sample")}</Button>
            <span className="text-xs text-muted">{t("cs.guide.sampleHint")}</span>
          </div>
        </Panel>
      )}

      <Panel title={<span className="flex items-center gap-2">{t("cs.example.title")} <Badge>{t("common.example")}</Badge></span>}>
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted">{t("cs.example.consensus")}</p>
            <p dir="ltr" className="transcript rounded-md bg-subtle px-3 text-ink">Tab. Paracetamol 500 mg</p>
            <p className="text-xs text-muted">{t("cs.example.consensus.hint")}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted">{t("cs.example.flag")}</p>
            <p dir="ltr" className="transcript rounded-md bg-subtle px-3 text-ink">
              Tab.{" "}
              <span className="rounded bg-flag-bg px-1 text-flag-fg underline decoration-flag-line decoration-dashed decoration-2 underline-offset-4">
                Amoxyclav<span aria-hidden="true" className="ms-0.5 align-super text-xs font-bold">?</span>
              </span>{" "}
              625 mg
            </p>
            <ul className="space-y-0.5 text-xs text-body">
              <li><span className="font-mono">{modelLabel("gemini:gemini-3.5-flash")}</span>: Amoxyclav</li>
              <li><span className="font-mono">{modelLabel("openrouter:google/gemma-4-31b-it:free")}</span>: Amoxicillin</li>
              <li><span className="font-mono">{modelLabel("groq:qwen/qwen3.8-27b")}</span>: Amoxil</li>
            </ul>
            <p className="text-xs text-muted">{t("cs.example.flag.hint")}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted">{t("cs.example.baseline")}</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p className="rounded-md bg-subtle px-3 py-2">
                <span className="block text-xs text-muted">{t("cs.compare.one")}</span>
                x <span className="rounded bg-danger-bg px-1 text-danger-fg line-through">3</span> days
              </p>
              <p className="rounded-md bg-subtle px-3 py-2">
                <span className="block text-xs text-muted">ClearScript</span>
                x <span className="rounded bg-flag-bg px-1 text-flag-fg">5?</span> days
              </p>
            </div>
            <p className="text-xs text-muted">{t("cs.example.baseline.hint")}</p>
          </div>
        </div>
      </Panel>
      <p className="flex items-center gap-2 text-xs text-muted"><ScanText className="size-4" aria-hidden="true" />{t("cs.guide.privacy")}</p>
    </div>
  );
}
