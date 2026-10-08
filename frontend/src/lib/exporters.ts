// Export formats. Rule: a word nobody verified is never exported as plain fact. Flagged words are
// always wrapped like [[word?]], and every format says how many are left.
import { isMarginTag, isNewline, markWords, stats, wordStatus, type HwResult, type RxRow, type Word } from "./handwriting";

export type ExportMeta = { name: string; ts: number; rows?: RxRow[] | null };

export function toText(words: Word[]): string {
  const flagged = stats(words, null).flagged;
  const body = markWords(words);
  return flagged
    ? `${body}\n\n---\n${flagged} word(s) in [[ ]] were not verified. Check them against the original.\n`
    : `${body}\n`;
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function toMarkdown(words: Word[], result: HwResult, meta: ExportMeta): string {
  const s = stats(words, result);
  const lines = markWords(words).split("\n").map((l) => l.replace(/\[\[(.+?)\?\]\]/g, "**[[$1?]]**"));
  const out = [
    "# ClearScript transcription",
    "",
    `- Source: ${meta.name}`,
    `- Digitized: ${new Date(meta.ts).toISOString()}`,
    `- Document type: ${result.doc_type ?? "note"}`,
    `- Models that read it: ${s.models}${s.failed ? ` (${s.failed} failed)` : ""}`,
    `- Unverified words: ${s.flagged}`,
    `- Corrected by a person: ${s.human}`,
    "",
    "## Text",
    "",
    lines.join("  \n"),
    "",
  ];
  if (s.flagged) {
    out.push("> Words in **[[ ]]** were not verified. Check them against the original before use.", "");
    out.push("## Needs verification", "", "| Word | Models read | Note |", "| --- | --- | --- |");
    for (const w of words.filter((x) => x.flagged && !isNewline(x))) {
      const read = w.by_model ? Object.entries(w.by_model).map(([m, t]) => `${m}: ${t ?? "(nothing)"}`).join("; ") : (w.alternatives ?? []).join(", ");
      const note = w.lookalikes?.length ? `Looks like: ${w.lookalikes.join(", ")}` : "";
      out.push(`| ${mdCell(w.text)} | ${mdCell(read)} | ${mdCell(note)} |`);
    }
    out.push("");
  }
  if (meta.rows?.length) {
    out.push("## Prescription", "", "| Drug | Strength | Form | Frequency | Duration | Check |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of meta.rows) {
      const check = r.warnings?.length ? `Check dose: ${r.warnings.join("; ")}` : r.flagged ? "Check" : "";
      out.push(`| ${[r.drug, r.strength, r.form, r.frequency, r.duration, check].map((x) => mdCell(x || "-")).join(" | ")} |`);
    }
    out.push("", "_Numbers are copied exactly as read, never corrected._", "");
  }
  return out.join("\n");
}

export function toJSON(words: Word[], result: HwResult, meta: ExportMeta): string {
  const s = stats(words, result);
  const status = { agreed: "agreed", flagged: "needs_verification", lookalike: "needs_verification", context: "fixed_by_context",
    guess: "fixed_by_context", human: "confirmed_by_person" } as const;
  return JSON.stringify({
    format: "clearscript/1",
    source: meta.name,
    digitized_at: new Date(meta.ts).toISOString(),
    exported_at: new Date().toISOString(),
    doc_type: result.doc_type ?? "note",
    text_marked: markWords(words),
    unverified_count: s.flagged,
    note: "text_marked wraps every unverified word as [[word?]]. Do not use unverified words without checking the original.",
    models: { answered: Object.keys(result.readings), failed: Object.fromEntries(Object.entries(result.errors).filter(([k]) => k !== "baseline")) },
    words: words.filter((w) => !isNewline(w)).map((w, i) => ({
      index: i,
      text: w.text,
      status: isMarginTag(w) ? "layout" : status[wordStatus(w)],
      verified: !w.flagged,
      agreement: w.confidence ?? null,
      readings_by_model: w.by_model ?? null,
      alternatives: w.alternatives ?? [],
      lookalikes: w.lookalikes ?? [],
      corrected_from: w.original ?? null,
    })),
    lines_marked: markWords(words).split("\n"),
    prescription: meta.rows ?? null,
    baseline: result.baseline ?? null,
  }, null, 2);
}

export function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const baseName = (name: string) => (name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || "clearscript");
