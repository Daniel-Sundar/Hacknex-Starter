import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ClipboardCopy, FileJson, FileText, FileType2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button, Dialog, Notice } from "../../components/ui";
import { useT } from "../../i18n";
import { stats, type HwResult, type RxRow, type Word } from "../../lib/handwriting";
import { baseName, download, toJSON, toMarkdown, toText } from "../../lib/exporters";
import { HISTORY_MAX, type HistoryEntry } from "../../lib/history";
import { CLOUD_MAX } from "../../lib/cloudHistory";
import { HistoryList } from "./HistoryPanel";
import { MOD_KEY } from "./InputPanel";

// ---------- camera: open -> capture -> preview -> retake / use ----------

type CamState = "starting" | "live" | "captured" | "error";

export function CameraDialog({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (f: File) => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>("starting");
  const [problem, setProblem] = useState("unknown");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  const stop = () => { stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; };

  const start = useCallback(async () => {
    setState("starting");
    setShot((s) => { if (s) URL.revokeObjectURL(s.url); return null; });
    if (!window.isSecureContext) { setProblem("insecure"); setState("error"); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setProblem("unsupported"); setState("error"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setState("live");
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied"
        : name === "NotFoundError" || name === "OverconstrainedError" ? "notfound"
        : name === "NotReadableError" || name === "AbortError" ? "busy" : "unknown");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (open) start();
    return stop; // camera light goes off as soon as the dialog closes
  }, [open, start]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      setShot({ blob: b, url: URL.createObjectURL(b) });
      setState("captured");
      stop();
    }, "image/jpeg", 0.92);
  };

  const use = () => {
    if (!shot) return;
    onUse(new File([shot.blob], `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`, { type: "image/jpeg" }));
    URL.revokeObjectURL(shot.url);
    setShot(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="40rem"
      title={t("cs.camera.title")}
      description={t("cs.camera.tips")}
      footer={
        state === "captured" ? (
          <>
            <Button icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={start}>{t("cs.camera.retake")}</Button>
            <Button variant="primary" onClick={use} data-autofocus="">{t("cs.camera.use")}</Button>
          </>
        ) : state === "error" ? (
          <Button onClick={onClose}>{t("cs.camera.chooseFile")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" icon={<Camera className="size-4" aria-hidden="true" />} disabled={state !== "live"} onClick={capture}>
              {t("cs.camera.capture")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className={state === "live" || state === "starting" ? "" : "hidden"}>
          <video ref={video} playsInline muted aria-label={t("cs.camera.live")} className="max-h-[60dvh] w-full rounded-md border border-line bg-black object-contain" />
        </div>
        {state === "starting" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("cs.camera.starting")}</p>
        )}
        {state === "captured" && shot && (
          <img src={shot.url} alt={t("cs.camera.previewAlt")} className="max-h-[60dvh] w-full rounded-md border border-line bg-black object-contain" />
        )}
        {state === "error" && (
          <Notice tone="danger" title={t(`cs.camera.err.${problem}` as "cs.camera.err.unknown")}>{t("cs.camera.err.hint")}</Notice>
        )}
      </div>
    </Dialog>
  );
}

// ---------- export ----------

export function ExportDialog({ open, onClose, words, result, name, ts, rows, onCopy }: {
  open: boolean; onClose: () => void; words: Word[]; result: HwResult; name: string; ts: number; rows: RxRow[] | null; onCopy: () => void;
}) {
  const { t, tn } = useT();
  const { flagged } = stats(words, result);
  const base = baseName(name);
  const meta = { name, ts, rows };
  const formats = [
    { id: "txt", icon: FileText, run: () => download(toText(words), `${base}.txt`, "text/plain;charset=utf-8") },
    { id: "md", icon: FileType2, run: () => download(toMarkdown(words, result, meta), `${base}.md`, "text/markdown;charset=utf-8") },
    { id: "json", icon: FileJson, run: () => download(toJSON(words, result, meta), `${base}.json`, "application/json") },
  ] as const;
  return (
    <Dialog open={open} onClose={onClose} title={t("cs.export.title")} description={t("cs.export.desc")}>
      <div className="space-y-4">
        {flagged > 0
          ? <Notice tone="flag">{tn("cs.export.unverified", flagged)}</Notice>
          : <Notice tone="ok">{t("cs.export.allVerified")}</Notice>}
        <ul className="space-y-2">
          {formats.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={f.run}
                className="flex min-h-12 w-full items-center gap-3 rounded-md border border-line-strong bg-surface px-4 py-2 text-start hover:bg-subtle">
                <f.icon className="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t(`cs.export.${f.id}`)}</span>
                  <span className="block text-xs text-muted">{t(`cs.export.${f.id}.hint`)}</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onCopy}
              className="flex min-h-12 w-full items-center gap-3 rounded-md border border-line-strong bg-surface px-4 py-2 text-start hover:bg-subtle">
              <ClipboardCopy className="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t("cs.export.copy")}</span>
                <span className="block text-xs text-muted">{t("cs.export.copy.hint")}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

// ---------- history ----------

export function HistoryDialog({ open, onClose, entries, currentId, onOpen, onDelete, onClear, cloud, status }: {
  open: boolean; onClose: () => void; entries: HistoryEntry[]; currentId: string | null;
  onOpen: (e: HistoryEntry) => void; onDelete: (id: string) => void; onClear: () => void;
  cloud: boolean; status: ReactNode;
}) {
  const { t } = useT();
  const [confirmAll, setConfirmAll] = useState(false);
  useEffect(() => { if (!open) setConfirmAll(false); }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="40rem"
      title={t("cs.history.title")}
      description={cloud ? t("cs.history.descCloud", { max: CLOUD_MAX }) : t("cs.history.desc", { max: HISTORY_MAX })}
      footer={entries.length > 0 ? (
        confirmAll ? (
          <>
            <span className="me-auto self-center text-sm text-body">{t("cs.history.clearConfirm")}</span>
            <Button onClick={() => setConfirmAll(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => { onClear(); setConfirmAll(false); }}>{t("cs.history.clearYes")}</Button>
          </>
        ) : <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => setConfirmAll(true)}>{t("cs.history.clear")}</Button>
      ) : undefined}
    >
      <div className="space-y-4">
        {status}
        <HistoryList entries={entries} currentId={currentId} onOpen={onOpen} onDelete={onDelete} />
      </div>
    </Dialog>
  );
}

// ---------- keyboard shortcuts ----------

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const rows: [string, string][] = [
    [`${MOD_KEY} + Enter`, t("cs.keys.digitize")],
    ["Ctrl + V", t("cs.keys.paste")],
    ["← → ↑ ↓", t("cs.keys.move")],
    ["Enter", t("cs.keys.open")],
    ["1 – 9", t("cs.keys.pick")],
    ["Esc", t("cs.keys.close")],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("cs.keys.title")}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t("cs.keys.title")}</caption>
        <tbody>
          {rows.map(([k, what]) => (
            <tr key={k} className="border-t border-line first:border-t-0">
              <th scope="row" className="py-2 pe-4 text-start font-mono text-xs font-medium whitespace-nowrap text-ink">{k}</th>
              <td className="py-2 text-body">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
