// History list shared by the docked sidebar (wide screens) and the History dialog (everywhere else):
// search, grouped by day (Today / Yesterday / Earlier), current result highlighted.
import { useMemo, useState, type ReactNode } from "react";
import { Cloud, FileText, HardDrive, Maximize2, PanelLeftClose, Search, Trash2 } from "lucide-react";
import { Badge, Button, IconButton, Notice, inputCls } from "../../components/ui";
import { useT } from "../../i18n";
import { stats } from "../../lib/handwriting";
import type { HistoryEntry } from "../../lib/history";

type ListProps = {
  entries: HistoryEntry[]; currentId: string | null; compact?: boolean;
  onOpen: (e: HistoryEntry) => void; onDelete: (id: string) => void;
};

const DAY = 86_400_000;

export function HistoryList({ entries, currentId, compact, onOpen, onDelete }: ListProps) {
  const { t, tn, date, locale } = useT();
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = needle
      ? entries.filter((e) => e.name.toLowerCase().includes(needle) || e.result.text?.toLowerCase().includes(needle))
      : entries;
    const today = new Date().setHours(0, 0, 0, 0);
    const out: { key: "cs.history.today" | "cs.history.yesterday" | "cs.history.earlier"; items: HistoryEntry[] }[] = [
      { key: "cs.history.today", items: [] }, { key: "cs.history.yesterday", items: [] }, { key: "cs.history.earlier", items: [] },
    ];
    for (const e of shown) out[e.ts >= today ? 0 : e.ts >= today - DAY ? 1 : 2].items.push(e);
    return out.filter((g) => g.items.length);
  }, [entries, q]);

  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }), [locale]);
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), [locale]);

  if (!entries.length) return <p className="px-1 text-sm text-muted">{t("cs.history.empty")}</p>;

  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">{t("cs.history.search")}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cs.history.search")} className={`${inputCls} ps-9`} />
      </label>

      {!groups.length && <p className="px-1 text-sm text-muted">{t("cs.history.noMatch", { q: q.trim() })}</p>}

      {groups.map((g) => (
        <section key={g.key} aria-label={t(g.key)}>
          <h3 className="mb-1 px-1 text-xs font-semibold tracking-wide text-muted uppercase">{t(g.key)}</h3>
          <ul className={compact ? "space-y-1" : "divide-y divide-line"}>
            {g.items.map((e) => {
              const s = stats(e.words, e.result);
              const current = e.id === currentId;
              const when = g.key === "cs.history.earlier" ? day.format(e.ts) : time.format(e.ts);
              const thumb = e.thumb
                ? <img src={e.thumb} alt="" className={`${compact ? "size-10" : "size-12"} shrink-0 rounded border border-line object-cover`} />
                : <span aria-hidden="true" className={`grid ${compact ? "size-10" : "size-12"} shrink-0 place-items-center rounded border border-line bg-subtle`}><FileText className="size-5 text-muted" /></span>;

              if (compact) {
                return (
                  <li key={e.id} className={`group flex items-center gap-1 rounded-md ${current ? "bg-accent-soft" : "hover:bg-subtle"}`}>
                    <button type="button" onClick={() => onOpen(e)} aria-current={current ? "true" : undefined}
                      aria-label={t("cs.history.openNamed", { name: e.name })}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-start">
                      {thumb}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${current ? "text-accent-text" : "text-ink"}`}>{e.name}</span>
                        <span className="flex items-center gap-2 text-xs text-muted">
                          <time dateTime={new Date(e.ts).toISOString()} title={date(e.ts)}>{when}</time>
                          {s.flagged
                            ? <span className="truncate text-flag-fg">{tn("cs.history.flagged", s.flagged)}</span>
                            : <span className="truncate text-ok-fg">{t("cs.history.verified")}</span>}
                        </span>
                      </span>
                    </button>
                    <IconButton size="sm" label={t("cs.history.deleteNamed", { name: e.name })} icon={<Trash2 className="size-4" />}
                      onClick={() => onDelete(e.id)} className="me-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100" />
                  </li>
                );
              }

              return (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  {thumb}
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium text-ink">{e.name}</p>
                    <p className="text-xs text-muted"><time dateTime={new Date(e.ts).toISOString()}>{date(e.ts)}</time></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{t(e.result.doc_type === "prescription" ? "cs.doc.prescription" : "cs.doc.note")}</Badge>
                      {s.flagged ? <Badge tone="flag">{tn("cs.history.unverified", s.flagged)}</Badge> : <Badge tone="ok">{t("cs.history.verified")}</Badge>}
                      {current && <Badge tone="accent">{t("cs.history.current")}</Badge>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onOpen(e)} aria-label={t("cs.history.openNamed", { name: e.name })}>{t("cs.history.open")}</Button>
                  <IconButton size="sm" label={t("cs.history.deleteNamed", { name: e.name })} icon={<Trash2 className="size-4" />} onClick={() => onDelete(e.id)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Where history is saved, plus the offer to move browser-only results into the account after sign-in. */
export function HistoryStatus({ account, canSignIn, localCount, importing, onImport }: {
  account: string | null; canSignIn: boolean; localCount: number; importing: boolean; onImport: () => void;
}) {
  const { t, tn } = useT();
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 px-1 text-xs text-muted">
        {account ? <Cloud className="mt-px size-4 shrink-0 text-accent-text" aria-hidden="true" /> : <HardDrive className="mt-px size-4 shrink-0" aria-hidden="true" />}
        <span>{account ? t("cs.history.cloud", { name: account }) : canSignIn ? `${t("cs.history.local")} ${t("cs.history.signInToSync")}` : t("cs.history.local")}</span>
      </p>
      {account && localCount > 0 && (
        <Notice tone="info">
          <p>{tn("cs.history.import", localCount)}</p>
          <Button size="sm" variant="primary" className="mt-2" loading={importing} onClick={onImport}>{t("cs.history.importYes")}</Button>
        </Notice>
      )}
    </div>
  );
}

/** The docked "task bar" on wide screens. */
export function HistorySidebar({ count, status, onHide, onManage, children }: {
  count: number; status: ReactNode; onHide: () => void; onManage: () => void; children: ReactNode;
}) {
  const { t } = useT();
  return (
    <aside aria-labelledby="cs-history-side" className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <h2 id="cs-history-side" className="me-auto text-sm font-semibold text-ink">{t("cs.history.title")} <span className="font-normal text-muted">({count})</span></h2>
        <IconButton size="sm" label={t("cs.history.manage")} icon={<Maximize2 className="size-4" />} onClick={onManage} />
        <IconButton size="sm" label={t("cs.history.hide")} icon={<PanelLeftClose className="size-4" />} onClick={onHide} />
      </div>
      <div className="space-y-3 overflow-y-auto p-2">
        {status}
        {children}
      </div>
    </aside>
  );
}
