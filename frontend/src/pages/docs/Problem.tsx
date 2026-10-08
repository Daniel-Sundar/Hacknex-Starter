// Same look as ErrorState in components/ui.tsx, but it takes an already-described Problem, so the Docs page can
// use copy written for documents (ErrorState always describes the error with the shared, photo-oriented copy).
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import type { Problem } from "../../lib/errors";

export function ProblemState({ problem, onRetry, className = "" }: { problem: Problem; onRetry?: () => void; className?: string }) {
  const { t } = useT();
  return (
    <div role="alert" className={`rounded-lg border border-danger-line bg-danger-bg p-4 ${className}`}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-1 size-5 shrink-0 text-danger-fg" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-danger-fg">{t(problem.title, problem.vars)}</p>
          <p className="text-sm text-ink">{t(problem.body, problem.vars)}</p>
          {problem.detail && <p className="wrap-break-word text-xs text-body">{t("err.serverSaid", { message: problem.detail })}</p>}
          {onRetry && problem.retryable && (
            <div className="pt-2"><Button onClick={onRetry}>{t("common.retry")}</Button></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact version for a row in a list (no box): what happened and what to do. */
export function InlineProblem({ problem }: { problem: Problem }) {
  const { t } = useT();
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-danger-fg">{t(problem.title, problem.vars)}</p>
      <p className="text-xs text-body">{t(problem.body, problem.vars)}</p>
      {problem.detail && <p className="wrap-break-word text-xs text-muted">{t("err.serverSaid", { message: problem.detail })}</p>}
    </div>
  );
}
