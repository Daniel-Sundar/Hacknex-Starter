// ClearScript design system components. Tokens live in index.css (colours, type, focus); spacing uses only
// the 4/8/12/16/24/32 steps. Every control has a visible label or an aria-label, a 40px+ touch target and a
// visible focus ring.
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useT } from "../i18n";
import { describeError } from "../lib/errors";

// ---------- Button ----------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";
const VARIANT: Record<Variant, string> = {
  primary: "border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border-line-strong bg-surface text-ink hover:bg-subtle",
  ghost: "border-transparent bg-transparent text-body hover:bg-subtle hover:text-ink",
  danger: "border-danger-line bg-surface text-danger-fg hover:bg-danger-bg",
};
const SIZE: Record<Size, string> = {
  sm: "min-h-8 gap-1 px-3 text-xs",
  md: "min-h-10 gap-2 px-4 text-sm",
  lg: "min-h-12 gap-2 px-6 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, children, className = "", disabled, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "children"> & { label: string; icon: ReactNode }>(
  function IconButton({ label, icon, size = "md", variant = "ghost", className = "", ...rest }, ref) {
    const box = size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10";
    return (
      <Button ref={ref} aria-label={label} title={label} variant={variant} {...rest} className={`${box} !gap-0 !px-0 ${className}`}>
        {icon}
      </Button>
    );
  },
);

// ---------- Inputs ----------

export const inputCls =
  "min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:opacity-50";

export function Input({ label, hint, error, className = "", id, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode; hint?: ReactNode; error?: string | null;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const describe = [hint ? `${inputId}-hint` : "", error ? `${inputId}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">{label}</label>
      <input id={inputId} aria-describedby={describe} aria-invalid={error ? true : undefined} className={inputCls} {...rest} />
      {hint && <p id={`${inputId}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${inputId}-err`} className="text-xs font-medium text-danger-fg">{error}</p>}
    </div>
  );
}

/** On/off switch with a visible label. Clicking the label toggles it too. */
export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-ink">{label}</label>
        {description && <p id={`${id}-d`} className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50 ${checked ? "border-accent bg-accent" : "border-line-strong bg-subtle"}`}
      >
        <span
          aria-hidden="true"
          className={`absolute size-4 rounded-full shadow-sm transition-transform duration-150 ${checked ? "translate-x-6 bg-white rtl:-translate-x-6" : "translate-x-1 bg-muted rtl:-translate-x-1"}`}
          style={{ insetInlineStart: 0 }}
        />
      </button>
    </div>
  );
}

// ---------- DropZone ----------

/** The one place to drop or pick files. The whole zone is a keyboard-operable button (Enter / Space). */
export function DropZone({ accept, multiple, onFiles, title, hint, icon, disabled, className = "", children }: {
  accept: string; multiple?: boolean; onFiles: (files: File[]) => void; title: ReactNode; hint?: ReactNode;
  icon?: ReactNode; disabled?: boolean; className?: string; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const open = () => !disabled && input.current?.click();
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-describedby={hint ? hintId : undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 ${over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent hover:bg-subtle"} ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
    >
      {icon && <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-text">{icon}</span>}
      <span className="text-base font-semibold text-ink">{title}</span>
      {hint && <span id={hintId} className="text-xs text-muted">{hint}</span>}
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // picking the same file again still fires
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

// ---------- Panel / Badge / Progress ----------

export function Panel({ title, actions, children, className = "", bodyClassName = "p-4", level = 2, id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; level?: 2 | 3; id?: string;
}) {
  const auto = useId();
  const headingId = id ?? auto;
  const H = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={title ? headingId : undefined} className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <H id={headingId} className="text-sm font-semibold text-ink">{title}</H>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "flag" | "danger" | "info" | "ok" | "accent";
const TONE: Record<Tone, string> = {
  neutral: "border-line bg-subtle text-body",
  flag: "border-flag-line bg-flag-bg text-flag-fg",
  danger: "border-danger-line bg-danger-bg text-danger-fg",
  info: "border-info-line bg-info-bg text-info-fg",
  ok: "border-ok-line bg-ok-bg text-ok-fg",
  accent: "border-transparent bg-accent-soft text-accent-text",
};
export const toneCls = (tone: Tone) => TONE[tone];

export function Badge({ tone = "neutral", icon, children, className = "", title }: {
  tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string;
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

/** Determinate only: pass real counts. For unknown duration show a status line instead. */
export function Progress({ value, max, label, className = "" }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
      className={`h-2 overflow-hidden rounded-full bg-subtle ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------- Empty / error states ----------

export function EmptyState({ icon, title, children, action, className = "" }: {
  icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-8 text-center ${className}`}>
      {icon && <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-subtle text-muted">{icon}</span>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

/** What happened, what to do, whether retrying can help, and whether the user's work is safe. */
export function ErrorState({ error, onRetry, preserved, limits, className = "" }: {
  error: unknown; onRetry?: () => void; preserved?: boolean; limits?: { maxUploadMb?: number }; className?: string;
}) {
  const { t } = useT();
  const p = describeError(error, limits);
  return (
    <div role="alert" className={`rounded-lg border border-danger-line bg-danger-bg p-4 ${className}`}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger-fg" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-danger-fg">{t(p.title, p.vars)}</p>
          <p className="text-sm text-ink">{t(p.body, p.vars)}</p>
          {p.detail && <p className="break-words text-xs text-body">{t("err.serverSaid", { message: p.detail })}</p>}
          {preserved && <p className="text-xs text-body">{t("err.preserved")}</p>}
          {p.technical && (
            <details className="text-xs text-body">
              <summary className="cursor-pointer py-1 font-medium">{t("err.technical")}</summary>
              <p className="whitespace-pre-wrap break-words font-mono">{p.technical}</p>
            </details>
          )}
          {onRetry && p.retryable && (
            <div className="pt-2"><Button size="sm" onClick={onRetry}>{t("common.retry")}</Button></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline notice (not an error): tone + icon + text. */
export function Notice({ tone = "info", children, className = "", title }: { tone?: Tone; children: ReactNode; className?: string; title?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "info" || tone === "neutral" || tone === "accent" ? Info : AlertTriangle;
  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${TONE[tone]} ${className}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">{title && <p className="font-semibold">{title}</p>}<div className="text-ink">{children}</div></div>
    </div>
  );
}

// ---------- Dialog ----------

/** Native <dialog>: focus moves in, Esc closes, focus returns to the opener. Bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, children, footer, width = "32rem", initialFocus }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode;
  width?: string; initialFocus?: string; // CSS selector inside the dialog to focus first
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const toastHost = useRef<HTMLDivElement>(null);
  const id = useId();
  useToastHost(open, toastHost);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (initialFocus) d.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && d.open) d.close();
  }, [open, initialFocus]);
  return (
    <dialog
      ref={ref}
      className="cs-dialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onClose={() => open && onClose()}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ "--dialog-w": width } as CSSProperties}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
            <div className="min-w-0 pt-2">
              <h2 id={`${id}-t`} className="text-base font-semibold text-ink">{title}</h2>
              {description && <p id={`${id}-d`} className="text-xs text-muted">{description}</p>}
            </div>
            <IconButton label={t("common.close")} icon={<X className="size-4" />} onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </div>
      )}
      <div ref={toastHost} />
    </dialog>
  );
}

// ---------- Toasts + screen-reader announcements ----------

type ToastItem = { id: number; tone: Tone; message: string };
type ToastApi = {
  toast: (message: string, tone?: Tone) => void;
  announce: (message: string) => void;
  setHosts: (fn: (hs: HTMLElement[]) => HTMLElement[]) => void;
};
const ToastCtx = createContext<ToastApi | null>(null);

/** A modal dialog makes the rest of the page inert, so while one is open, toasts and screen-reader
 *  announcements render inside it (or they would be hidden from assistive tech). */
function useToastHost(open: boolean, el: React.RefObject<HTMLElement | null>) {
  const ctx = useContext(ToastCtx);
  const setHosts = ctx?.setHosts;
  useEffect(() => {
    const node = el.current;
    if (!open || !node || !setHosts) return;
    setHosts((hs) => [...hs, node]);
    return () => setHosts((hs) => hs.filter((h) => h !== node));
  }, [open, el, setHosts]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const [spoken, setSpoken] = useState("");
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const announce = useCallback((message: string) => {
    setSpoken("");
    window.setTimeout(() => setSpoken(message), 50); // re-announce even when the text repeats
  }, []);
  const toast = useCallback((message: string, tone: Tone = "neutral") => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, tone, message }]);
  }, []);
  const layer = (
    <>
      <div role="status" aria-live="polite" className="sr-only">{spoken}</div>
      <div role="region" aria-label={t("common.notifications")} aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        {items.map((x) => <Toast key={x.id} item={x} onDone={dismiss} />)}
      </div>
    </>
  );
  const host = hosts[hosts.length - 1];
  return (
    <ToastCtx.Provider value={{ toast, announce, setHosts }}>
      {children}
      {host ? createPortal(layer, host) : layer}
    </ToastCtx.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const { t } = useT();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDone(item.id), 6000);
    return () => window.clearTimeout(timer);
  }, [paused, onDone, item.id]);
  return (
    <div
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border bg-surface py-2 ps-4 pe-2 text-sm text-ink shadow-[var(--shadow-pop)] ${item.tone === "neutral" ? "border-line" : TONE[item.tone]}`}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      <IconButton size="sm" label={t("common.dismiss")} icon={<X className="size-4" />} onClick={() => onDone(item.id)} />
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast() outside <ToastProvider>");
  return ctx;
}
