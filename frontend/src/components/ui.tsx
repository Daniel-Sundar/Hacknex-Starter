import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-panel p-5 ${className}`}>{children}</div>;
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
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand-strong px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-50 ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>;
}

export const inputCls =
  "w-full rounded-xl border border-line bg-page px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/40";
