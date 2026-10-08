import { ApiError } from "./api";
import type { MessageKey } from "../i18n";

export type Problem = {
  code: string;
  title: MessageKey;
  body: MessageKey;
  vars?: Record<string, string | number>;
  detail?: string;    // the server's own message, shown as secondary text
  technical?: string; // raw reason (e.g. each model's error), behind a disclosure
  retryable: boolean;
};

const KNOWN = new Set([
  "network", "timeout", "aborted", "too_large", "unsupported_type", "heic_unsupported", "empty_file", "corrupt",
  "bad_image", "bad_file", "all_models_failed", "rate_limited", "busy", "no_docs", "no_text", "bad_question", "server",
  "bad_request", "not_found",
]);
// Retrying the same request can help with these; the others need a different file or input.
const RETRYABLE = new Set(["network", "timeout", "aborted", "all_models_failed", "rate_limited", "busy", "server", "unknown", "pipeline_error"]);

/** Turn any thrown value into localized error copy: what happened, what to do, whether retry can help. */
export function describeError(e: unknown, limits: { maxUploadMb?: number } = {}): Problem {
  const err = e instanceof ApiError ? e : new ApiError("unknown", e instanceof Error ? e.message : String(e));
  const code = err.code === "pipeline_error" ? "server" : KNOWN.has(err.code) ? err.code : err.status >= 500 ? "server" : "unknown";
  const vars: Record<string, string | number> = {};
  if (code === "rate_limited") vars.seconds = err.retryAfter ?? 30;
  if (code === "too_large") vars.limit = Number(err.extra.max_mb) || limits.maxUploadMb || 15;
  // Show the server's wording only when it adds something to our own copy.
  const generic = ["network", "aborted", "timeout", "rate_limited", "busy", "too_large", "unsupported_type", "heic_unsupported", "empty_file", "corrupt", "all_models_failed"];
  return {
    code,
    title: `err.${code}.title` as MessageKey,
    body: `err.${code}.body` as MessageKey,
    vars,
    detail: generic.includes(code) || !err.message ? undefined : err.message,
    technical: typeof err.extra.reason === "string" && err.extra.reason ? err.extra.reason : undefined,
    retryable: RETRYABLE.has(err.code) || RETRYABLE.has(code),
  };
}
