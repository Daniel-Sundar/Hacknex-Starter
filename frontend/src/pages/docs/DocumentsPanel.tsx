// Start column: the upload DropZone, per-file upload states, and the documents loaded on the server.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Clock, FileText, FileUp, Info, Loader2, Trash2, X } from "lucide-react";
import { Badge, Button, Dialog, DropZone, ErrorState, IconButton, Panel } from "../../components/ui";
import { useT } from "../../i18n";
import { DOC_ACCEPT } from "./lib";
import { InlineProblem } from "./Problem";
import type { DocumentsState, Upload } from "./useDocuments";

export function DocumentsPanel({ d }: { d: DocumentsState }) {
  const { t, tn } = useT();
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<unknown>(null);
  const [toClear, setToClear] = useState<string[]>([]); // fixed when the dialog opens, so it doesn't change under the user
  const dropWrap = useRef<HTMLDivElement>(null);
  const removeBtns = useRef(new Map<string, HTMLButtonElement>());
  const follow = useRef<{ id: number; name: string } | null>(null); // a retried upload whose row has focus
  const rowIds = useId();

  const hasDocs = d.docs.length > 0;
  const focusDropZone = () => dropWrap.current?.querySelector<HTMLElement>('[role="button"]')?.focus();

  function retry(id: number, name: string) {
    follow.current = { id, name };
    d.retry(id);
    // The Retry button disappears while the file uploads again: keep focus on its row.
    requestAnimationFrame(() => document.getElementById(`${rowIds}-${id}`)?.focus());
  }

  // When that row goes away (the upload succeeded), hand focus to the new document's Remove button.
  useEffect(() => {
    const f = follow.current;
    if (!f || d.uploads.some((u) => u.id === f.id)) return;
    follow.current = null;
    if (document.activeElement && document.activeElement !== document.body) return; // the user has moved on
    const btn = removeBtns.current.get(f.name);
    if (btn) btn.focus();
    else focusDropZone();
  }, [d.uploads]);

  async function removeOne(source: string) {
    const names = d.docs.map((x) => x.source);
    const at = names.indexOf(source);
    if (!(await d.remove(source))) return;
    // The row is gone: move focus to the next document's Remove button, else the previous one, else the drop zone.
    const next = names[at + 1] ?? names[at - 1];
    requestAnimationFrame(() => {
      const btn = next ? removeBtns.current.get(next) : undefined;
      if (btn) btn.focus();
      else focusDropZone();
    });
  }

  async function clearAll() {
    setClearing(true);
    setClearError(null);
    try {
      await d.clear();
      setConfirm(false);
      requestAnimationFrame(focusDropZone);
    } catch (e) {
      setClearError(e);
    } finally {
      setClearing(false);
    }
  }

  return (
    <Panel
      title={t("docs.files.title")}
      actions={hasDocs && (
        <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => { setClearError(null); setToClear(d.docs.map((x) => x.source)); setConfirm(true); }}>
          {t("docs.files.removeAll")}
        </Button>
      )}
      bodyClassName="space-y-4 p-4"
    >
      <div ref={dropWrap}>
        <DropZone
          accept={DOC_ACCEPT}
          multiple
          onFiles={(fs) => void d.add(fs)}
          icon={<FileUp className="size-5" />}
          title={hasDocs ? t("docs.upload.titleMore") : t("docs.upload.title")}
          hint={t("docs.upload.hint", { limit: d.limitMb })}
          className={hasDocs ? "!py-4" : "min-h-48"}
        />
      </div>

      {d.uploads.length > 0 && (
        <ul role="list" aria-label={t("docs.upload.listLabel")} className="divide-y divide-line">
          {d.uploads.map((u) => (
            <UploadRow key={u.id} id={`${rowIds}-${u.id}`} u={u} onRetry={() => retry(u.id, u.name)} onDismiss={() => d.dismiss(u.id)} />
          ))}
        </ul>
      )}

      {d.list === "error" && <ErrorState error={d.listError} onRetry={() => void d.load()} />}

      {hasDocs ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">{tn("docs.files.count", d.docs.length)}</p>
          <ul role="list" aria-label={t("docs.files.listLabel")} className="divide-y divide-line border-y border-line">
            {d.docs.map((doc) => {
              const busy = d.removing.includes(doc.source);
              const note = d.notes[doc.source];
              return (
                <li key={doc.source} className="flex items-start gap-3 py-2">
                  <RowIcon><FileText className="size-4 text-muted" aria-hidden="true" /></RowIcon>
                  <div className="min-w-0 flex-1 py-2">
                    <p className="wrap-anywhere text-sm font-medium text-ink">{doc.source}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {tn("docs.files.passages", doc.chunks)}
                      {note && <Badge tone="ok">{t(note === "added" ? "docs.files.added" : "docs.files.replaced")}</Badge>}
                    </p>
                  </div>
                  <IconButton
                    ref={(el) => { if (el) removeBtns.current.set(doc.source, el); else removeBtns.current.delete(doc.source); }}
                    label={t("docs.files.remove", { name: doc.source })}
                    icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    disabled={busy}
                    onClick={() => void removeOne(doc.source)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : d.list === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("docs.files.loading")}
        </p>
      ) : d.list === "ready" && (
        <p className="text-sm text-muted">{t("docs.files.none")}</p>
      )}

      {d.removeError && <ErrorState error={d.removeError.error} onRetry={() => void removeOne(d.removeError!.source)} />}

      <p className="flex gap-2 text-xs text-muted">
        <Info className="size-4 shrink-0" aria-hidden="true" />
        <span>{d.serverList ? t("docs.files.memoryNote") : t("docs.files.localNote")}</span>
      </p>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("docs.clear.title")}
        description={tn("docs.clear.body", toClear.length)}
        initialFocus="[data-autofocus]"
        footer={(
          <>
            <Button data-autofocus onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" loading={clearing} onClick={() => void clearAll()}>{t("docs.clear.confirm")}</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <ul role="list" className="space-y-1 text-sm text-body">
            {toClear.map((name) => (
              <li key={name} className="flex items-start gap-2">
                <span className="flex h-5 shrink-0 items-center"><FileText className="size-4 text-muted" aria-hidden="true" /></span>
                <span className="wrap-anywhere min-w-0">{name}</span>
              </li>
            ))}
          </ul>
          {clearError != null && <ErrorState error={clearError} onRetry={() => void clearAll()} />}
        </div>
      </Dialog>
    </Panel>
  );
}

/** Lines a row's icon up with the first line of its text (text starts 8px down, next to a 40px button). */
const RowIcon = ({ children }: { children: ReactNode }) => <span className="mt-2 flex h-5 shrink-0 items-center">{children}</span>;

function UploadRow({ id, u, onRetry, onDismiss }: { id: string; u: Upload; onRetry: () => void; onDismiss: () => void }) {
  const { t } = useT();
  const failed = u.status === "failed";
  return (
    <li id={id} tabIndex={-1} className="flex items-start gap-3 py-2">
      <RowIcon>
        {failed ? <AlertTriangle className="size-4 text-danger-fg" aria-hidden="true" />
          : u.status === "uploading" ? <Loader2 className="size-4 animate-spin text-accent-text" aria-hidden="true" />
          : <Clock className="size-4 text-muted" aria-hidden="true" />}
      </RowIcon>
      <div className="min-w-0 flex-1 space-y-1 py-2">
        <p className="wrap-anywhere text-sm font-medium text-ink">{u.name}</p>
        {failed && u.problem ? <InlineProblem problem={u.problem} />
          : <p className="text-xs text-muted">{t(u.status === "uploading" ? "docs.upload.uploading" : "docs.upload.waiting")}</p>}
        {failed && u.problem?.retryable && (
          <div className="pt-1">
            <Button onClick={onRetry} aria-label={t("docs.upload.retry", { name: u.name })}>{t("common.retry")}</Button>
          </div>
        )}
      </div>
      {failed && <IconButton label={t("docs.upload.dismiss", { name: u.name })} icon={<X className="size-4" />} onClick={onDismiss} />}
    </li>
  );
}
