import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Card({ children, className = "", flush = false }: { children: ReactNode; className?: string; flush?: boolean }) {
  // flush: no padding, for cards that draw their own header bar
  return <div className={`surface rounded-xl ${flush ? "" : "p-5"} ${className}`}>{children}</div>;
}

export function Button({
  loading,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-strong px-3.5 py-2 text-[13px] font-medium tracking-tight text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1)] transition-all duration-150 ease-in-out hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-50 disabled:active:scale-100 ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg border border-del-line bg-del-bg px-3 py-2 text-[13px] text-del-fg">{error}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export const inputCls =
  "w-full rounded-lg border border-line bg-well px-3 py-2 text-[13px] text-ink outline-none transition-all duration-150 ease-in-out placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30";
