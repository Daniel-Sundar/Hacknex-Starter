import { useRef } from "react";
import { Camera, ChevronDown, FileText, ImageUp, RefreshCw, ScanText, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { Button, DropZone, ErrorState, Input, Notice, Panel, Toggle } from "../../components/ui";
import { useT } from "../../i18n";
import { ApiError } from "../../lib/api";
import { ACCEPT, formatBytes, type Kind } from "../../lib/fileCheck";
import { DEFAULT_OPTIONS, type Options } from "../../lib/handwriting";

export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type Props = {
  file: Blob | null; name: string; preview: string | null; kind: Kind | null; problem: string | null; isSample: boolean;
  onFiles: (files: File[]) => void; onCamera: () => void; onSample: () => void; onRemove: () => void;
  opts: Options; setOpts: (o: Options) => void; writer: string; setWriter: (w: string) => void;
  running: boolean; hasResult: boolean; onDigitize: () => void; onStop: () => void; maxMb: number;
};

const TOGGLES = ["clean", "vote", "context", "baseline"] as const;

export function InputPanel(p: Props) {
  const { t } = useT();
  const replace = useRef<HTMLInputElement>(null);
  const off = TOGGLES.filter((k) => !p.opts[k]).length;
  const sticky = !!p.file && !p.hasResult; // on phones the main action stays in reach while scrolling

  return (
    <div className="space-y-4">
      <Panel title={t("cs.input.title")} bodyClassName="space-y-4 p-4">
        {p.isSample && !p.file && <Notice tone="info">{t("cs.input.sampleLoaded")}</Notice>}

        {p.file ? (
          <figure className="space-y-2">
            {p.kind === "pdf" ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-line bg-subtle px-4 text-center">
                <FileText className="size-6 text-muted" aria-hidden="true" />
                <span className="text-sm text-body">{t("cs.input.pdfNote")}</span>
              </div>
            ) : (
              p.preview && <img src={p.preview} alt={t("cs.input.previewAlt", { name: p.name })} className="max-h-80 w-full rounded-md border border-line bg-subtle object-contain" />
            )}
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="min-w-0 break-all">{p.name} · {formatBytes(p.file.size)}</span>
              <span className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden="true" />} disabled={p.running} onClick={() => replace.current?.click()}>
                  {t("cs.input.replace")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Camera className="size-4" aria-hidden="true" />} disabled={p.running} onClick={p.onCamera}>
                  {t("cs.input.retake")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden="true" />} disabled={p.running} onClick={p.onRemove}>
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
              <span aria-hidden="true" className="mt-2 inline-flex min-h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-ink">
                {t("cs.input.choose")}
              </span>
            </DropZone>
            <Button className="w-full" icon={<Camera className="size-4" aria-hidden="true" />} onClick={p.onCamera} disabled={p.running}>{t("cs.input.camera")}</Button>
          </>
        )}

        {p.problem && <ErrorState error={new ApiError(p.problem, "")} limits={{ maxUploadMb: p.maxMb }} />}
      </Panel>

      <details className="group rounded-lg border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />{t("cs.adv.title")}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted">
            {off ? t("cs.adv.someOff", { n: off }) : t("cs.adv.allOn")}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <div className="space-y-2 border-t border-line px-4 py-3">
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
            <Button size="sm" variant="ghost" disabled={p.running} onClick={() => p.setOpts(DEFAULT_OPTIONS)}>{t("cs.adv.reset")}</Button>
          )}
        </div>
      </details>

      <div className={`space-y-2 ${sticky ? "max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:-mx-4 max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:px-4 max-lg:py-3" : ""}`}
        style={sticky ? { paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" } : undefined}>
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
