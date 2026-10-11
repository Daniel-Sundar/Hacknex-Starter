import { useRef } from "react";
import { Camera, Check, ChevronDown, FileText, ImageUp, RefreshCw, ScanText, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { Button, DropZone, ErrorState, Input, Notice, Panel, Toggle } from "../../components/ui";
import { useT } from "../../i18n";
import { ApiError } from "../../lib/api";
import { ACCEPT, formatBytes, type Kind } from "../../lib/fileCheck";
import { DEFAULT_OPTIONS, PAGE_TYPES, type Options } from "../../lib/handwriting";

export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type Props = {
  file: Blob | null; name: string; preview: string | null; kind: Kind | null; problem: string | null; isSample: boolean;
  onFiles: (files: File[]) => void; onCamera: () => void; onSample: () => void; onRemove: () => void;
  opts: Options; setOpts: (o: Options) => void; writer: string; setWriter: (w: string) => void;
  mode: "auto" | "review"; setMode: (m: "auto" | "review") => void;
  running: boolean; hasResult: boolean; onDigitize: () => void; onStop: () => void; maxMb: number;
};

const TOGGLES = ["clean", "vote", "context", "baseline"] as const;

export function InputPanel(p: Props) {
  const { t } = useT();
  const replace = useRef<HTMLInputElement>(null);
  const off = TOGGLES.filter((k) => !p.opts[k]).length;
  const sticky = !!p.file && !p.hasResult; // with a page chosen, the main action stays in reach while scrolling (short laptops too)

  return (
    // The primary pane of the workbench: page, options, then a pinned action footer (mode + Digitize).
    <div className="flex h-full min-w-0 flex-col">
      <Panel flat title={t("cs.input.title")} bodyClassName="space-y-6 p-5 sm:p-6">
        {p.isSample && !p.file && <Notice tone="info">{t("cs.input.sampleLoaded")}</Notice>}

        {p.file ? (
          <figure className="space-y-2">
            {p.kind === "pdf" ? (
              <div className="cs-well flex h-40 flex-col items-center justify-center gap-2 rounded-xl px-4 text-center">
                <FileText className="size-6 text-muted" aria-hidden="true" />
                <span className="text-sm text-body">{t("cs.input.pdfNote")}</span>
              </div>
            ) : (
              p.preview && (
                // The page sits on a recessed stage like a sheet of paper: crisp, never blurred or tinted.
                <div className="cs-well grid place-items-center rounded-xl p-3 sm:p-4">
                  <img src={p.preview} alt={t("cs.input.previewAlt", { name: p.name })}
                    className="max-h-80 w-auto max-w-full rounded-md bg-white object-contain shadow-[0_1px_2px_rgb(0_0_0/0.08),0_10px_24px_-10px_rgb(20_22_40/0.35)]" />
                </div>
              )
            )}
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="min-w-0 break-all">{p.name} · {formatBytes(p.file.size)}</span>
              <span className="flex flex-wrap gap-1">
                <Button size="sm" variant="quiet" icon={<RefreshCw className="size-4" aria-hidden="true" />} disabled={p.running} onClick={() => replace.current?.click()}>
                  {t("cs.input.replace")}
                </Button>
                <Button size="sm" variant="quiet" icon={<Camera className="size-4" aria-hidden="true" />} disabled={p.running} onClick={p.onCamera}>
                  {t("cs.input.retake")}
                </Button>
                <Button size="sm" variant="quiet" icon={<Trash2 className="size-4" aria-hidden="true" />} disabled={p.running} onClick={p.onRemove}>
                  {t("common.remove")}
                </Button>
              </span>
            </figcaption>
            <input ref={replace} type="file" accept={ACCEPT} hidden tabIndex={-1}
              onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) p.onFiles(f); }} />
          </figure>
        ) : (
          <>
            <DropZone
              accept={ACCEPT}
              onFiles={p.onFiles}
              disabled={p.running}
              icon={<ImageUp className="size-5" />}
              title={t("cs.input.drop")}
              hint={t("cs.input.dropHint", { mb: p.maxMb })}
            >
              <span aria-hidden="true" className="cs-primary mt-2 inline-flex min-h-10 items-center rounded-md px-5 text-sm font-semibold text-accent-fg">
                {t("cs.input.choose")}
              </span>
            </DropZone>
            <Button className="w-full" icon={<Camera className="size-4" aria-hidden="true" />} onClick={p.onCamera} disabled={p.running}>{t("cs.input.camera")}</Button>
          </>
        )}

        {p.problem && <ErrorState error={new ApiError(p.problem, "")} limits={{ maxUploadMb: p.maxMb }} />}

        <fieldset className="space-y-2" disabled={p.running}>
          <legend className="cs-label mb-2">{t("cs.page.label")}</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("cs.page.label")}>
            {PAGE_TYPES.map((k) => {
              const on = p.opts.page === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => p.setOpts({ ...p.opts, page: k })}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-150 disabled:opacity-50 ${on
                    ? "border-accent bg-accent-soft font-semibold text-accent-text shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]" : "cs-control font-medium text-body hover:text-ink"}`}>
                  {on && <Check className="size-4" aria-hidden="true" />}{t(`cs.page.${k}`)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">{t(`cs.page.${p.opts.page}.hint`)}</p>
        </fieldset>

      <details className="cs-well group rounded-xl">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--color-ink)_4%,transparent)] [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />{t("cs.adv.title")}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted">
            {off ? t("cs.adv.someOff", { n: off }) : t("cs.adv.allOn")}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <div className="cs-hair space-y-2 border-t px-4 py-3">
          {TOGGLES.map((k) => (
            <Toggle key={k} checked={p.opts[k]} disabled={p.running} onChange={(v) => p.setOpts({ ...p.opts, [k]: v })}
              label={t(`cs.adv.${k}`)} description={t(`cs.adv.${k}.hint`)} />
          ))}
          <Input
            label={<>{t("cs.writer.label")} <span className="font-normal text-muted">({t("common.optional")})</span></>}
            hint={t("cs.writer.hint")}
            value={p.writer}
            disabled={p.running}
            onChange={(e) => p.setWriter(e.target.value)}
            placeholder="dr-kumar"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className="pt-2"
          />
          {TOGGLES.some((k) => p.opts[k] !== DEFAULT_OPTIONS[k]) && (
            <Button size="sm" variant="quiet" disabled={p.running} onClick={() => p.setOpts(DEFAULT_OPTIONS)}>{t("cs.adv.reset")}</Button>
          )}
        </div>
      </details>
      </Panel>

      <div className={`cs-hair mt-auto space-y-3 rounded-b-[var(--radius-lg)] border-t px-5 py-4 sm:px-6 ${sticky ? "sticky bottom-0 z-20 bg-[var(--glass-2)] backdrop-blur-xl" : ""}`}
        style={sticky ? { paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" } : undefined}>
        <div role="radiogroup" aria-label={t("cs.mode.label")} className="cs-well grid grid-cols-2 gap-1 rounded-[0.875rem] p-1">
          {(["auto", "review"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={p.mode === m} disabled={p.running} onClick={() => p.setMode(m)}
              className={`min-h-10 rounded-[0.625rem] px-2 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ${p.mode === m ? "bg-[var(--control-hover)] font-semibold text-ink shadow-[var(--control-shadow),0_1px_4px_rgb(20_28_20/0.12)]" : "text-muted hover:text-ink"}`}>
              {t(m === "auto" ? "cs.mode.auto" : "cs.mode.review")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{t(p.mode === "auto" ? "cs.mode.autoHint" : "cs.mode.reviewHint")}</p>
        {p.running ? (
          <Button size="lg" className="w-full" icon={<Square className="size-4" aria-hidden="true" />} onClick={p.onStop}>{t("cs.run.stop")}</Button>
        ) : (
          <Button
            size="lg"
            variant="primary"
            className="w-full"
            icon={<ScanText className="size-5" aria-hidden="true" />}
            disabled={!p.file}
            onClick={p.onDigitize}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            aria-describedby="cs-digitize-hint"
          >
            {p.hasResult && p.file ? t("cs.digitize.again") : t("cs.digitize")}
          </Button>
        )}
        <p id="cs-digitize-hint" className="text-center text-xs text-muted">
          {p.running ? t("cs.run.hint") : p.file ? t("cs.digitize.hint", { key: MOD_KEY }) : t("cs.digitize.needFile")}
        </p>
      </div>
    </div>
  );
}
