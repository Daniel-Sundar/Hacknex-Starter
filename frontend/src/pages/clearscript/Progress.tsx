import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, MinusCircle, Square, XCircle } from "lucide-react";
import { LegacyLoadingCard } from "../../components/LegacyLoadingCard";
import { Button, Progress } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import { modelLabel, STAGE_ORDER, type Reader, type Run, type StageId, type StageState } from "../../lib/progress";

/** While a page is being read: the pen card (unchanged) and, under it, the real stages as the backend reports them. */
export function ProcessingView({ run, startedAt, headingRef, onStop }: {
  run: Run; startedAt: number; headingRef?: React.Ref<HTMLHeadingElement>; onStop: () => void;
}) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));

  return (
    <div className="space-y-4">
      <LegacyLoadingCard title={t("cs.loading.title")} hint={t("cs.loading.hint")} />
      <section aria-labelledby="cs-progress-h" className="rounded-lg border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id="cs-progress-h" ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-ink outline-none">{t("cs.progress.title")}</h2>
          <span className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted">{t("cs.progress.elapsed", { seconds })}</span>
            <Button size="sm" icon={<Square className="size-3" aria-hidden="true" />} onClick={onStop}>{t("cs.run.stop")}</Button>
          </span>
        </header>
        <div className="p-4">
          {run.live ? (
            <ol className="space-y-3">
              {STAGE_ORDER.map((s) => (
                <li key={s}>
                  <StageRow state={run.stages[s]} label={stageLabel(t, s, run)} />
                  {s === "read" && run.readers.length > 0 && <Readers readers={run.readers} />}
                </li>
              ))}
              {run.baseline && (
                <li className="border-t border-line pt-3"><StageRow state={run.stages.baseline} label={t("cs.stage.baseline")} /></li>
              )}
            </ol>
          ) : (
            <p className="flex items-center gap-2 text-sm text-body">
              <Loader2 className="size-4 animate-spin text-accent-text" aria-hidden="true" />{t("cs.progress.noLive")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function stageLabel(t: (k: MessageKey, v?: Record<string, string | number>) => string, s: StageId, run: Run) {
  if (s === "read") return run.readers.length > 1 ? t("cs.stage.read", { n: run.readers.length }) : t("cs.stage.readOne");
  return t(`cs.stage.${s}` as MessageKey);
}

const ICON: Record<StageState, React.ReactNode> = {
  pending: <Circle className="size-4 text-muted" aria-hidden="true" />,
  active: <Loader2 className="size-4 animate-spin text-accent-text" aria-hidden="true" />,
  done: <CheckCircle2 className="size-4 text-ok-fg" aria-hidden="true" />,
  skipped: <MinusCircle className="size-4 text-muted" aria-hidden="true" />,
  failed: <XCircle className="size-4 text-danger-fg" aria-hidden="true" />,
};

function StageRow({ state, label }: { state: StageState; label: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 text-sm">
      {ICON[state]}
      <span className={state === "active" ? "font-medium text-ink" : state === "pending" || state === "skipped" ? "text-muted" : "text-body"}>{label}</span>
      <span className={`ms-auto text-xs ${state === "failed" ? "text-danger-fg" : "text-muted"}`}>{t(`cs.state.${state}`)}</span>
    </div>
  );
}

function Readers({ readers }: { readers: Reader[] }) {
  const { t } = useT();
  const finished = readers.filter((r) => r.state === "done" || r.state === "failed" || r.state === "timeout").length;
  const answered = readers.filter((r) => r.state === "done").length;
  return (
    <div className="mt-2 space-y-2 ps-6">
      <Progress value={finished} max={readers.length} label={t("cs.progress.readers", { done: answered, n: readers.length })} />
      <p className="text-xs text-muted">{t("cs.progress.readers", { done: answered, n: readers.length })}</p>
      <ul className="space-y-1">
        {readers.map((r) => (
          <li key={r.slot} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-mono text-body">{modelLabel(r.model)}</span>
            <span className={r.state === "failed" || r.state === "timeout" ? "text-danger-fg" : r.state === "done" ? "text-ok-fg" : "text-muted"}>
              {r.state === "done" && r.ms ? t("cs.reader.doneIn", { s: (r.ms / 1000).toFixed(1) }) : t(`cs.reader.${r.state}`)}
            </span>
            {r.replaced.length > 0 && <span className="text-muted">{t("cs.reader.replaced", { models: r.replaced.map(modelLabel).join(", ") })}</span>}
            {r.error && r.state !== "done" && <span className="w-full break-words text-muted">{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
