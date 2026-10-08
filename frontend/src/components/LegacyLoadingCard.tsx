import { PenAnimation } from "./PenAnimation";
import "./legacy-loading.css";

/** The pen-writing card shown while models read a page. Kept exactly as before the redesign;
 *  live stage progress is shown next to it, not inside it. */
export function LegacyLoadingCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="legacy-loading">
      <PenAnimation page="musing" className="h-[420px]" />
      <div className="legacy-loading__bar">
        <span className="legacy-loading__title">{title}</span>
        <span className="legacy-loading__hint">{hint}</span>
      </div>
    </div>
  );
}
