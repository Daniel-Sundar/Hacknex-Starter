// Types + helpers for the ClearScript (PS04) page. Matches POST /api/handwriting.

export type Word = {
  text: string;
  confidence?: number;
  flagged?: boolean;
  alternatives?: string[];
  resolved_by?: "context" | "human" | string;
  skipped?: boolean; // UI only: the human skipped this question
  lookalikes?: string[]; // other drugs this drug name could be mistaken for (flagged even if all readers agree)
};

export type HwResult = {
  text: string;
  marked: string;
  words: Word[];
  readings: Record<string, string>;
  errors: Record<string, string>;
  flagged: number;
  stages: { clean: boolean; vote: boolean; context: boolean };
  baseline?: string;
  doc_type?: "prescription" | "note";
};

/** One medicine from POST /api/handwriting/table. Numbers are shown exactly as returned. */
export type RxRow = {
  drug: string; strength: string; form: string; frequency: string; duration: string; flagged: boolean;
  warnings?: string[]; // dose sanity check: unusual strength, above the usual daily maximum
};

export const isNewline = (w: Word) => w.text === "\n";
export const hasDigit = (s: string) => /\d/.test(s);

/** Join words back into text the same way the backend's detok does (no space before punctuation). */
export function joinWords(words: Word[]): string {
  let out = "";
  for (const w of words) {
    if (isNewline(w)) { out = out.trimEnd() + "\n"; continue; }
    if (out && !out.endsWith("\n") && !/^[.,;:!?)\]]/.test(w.text)) out += " ";
    out += w.text;
  }
  return out.trim();
}

/** The `marked` text for the current words ([[word?]] around flagged ones), like the backend's render(). */
export function markWords(words: Word[]): string {
  return joinWords(words.map((w) => (w.flagged && !isNewline(w) ? { ...w, text: `[[${w.text}?]]` } : w)));
}

/** Flagged words to ask the human about: numbers/doses first, then look-alike drugs, then lowest confidence. */
export function reviewQueue(words: Word[], max = 5): number[] {
  return words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.flagged)
    .sort((a, b) =>
      Number(hasDigit(b.w.text) || (b.w.alternatives ?? []).some(hasDigit)) -
        Number(hasDigit(a.w.text) || (a.w.alternatives ?? []).some(hasDigit)) ||
      Number(!!b.w.lookalikes?.length) - Number(!!a.w.lookalikes?.length) ||
      (a.w.confidence ?? 0) - (b.w.confidence ?? 0),
    )
    .slice(0, max)
    .map(({ i }) => i);
}

/** Canned result so the UI can be demoed / developed with no API keys. Clearly labelled as a sample in the UI. */
export const SAMPLE: HwResult = (() => {
  const w = (text: string, confidence = 1, flagged = false, alternatives: string[] = [], resolved_by?: string): Word =>
    ({ text, confidence, flagged, alternatives, ...(resolved_by ? { resolved_by } : {}) });
  const words: Word[] = [
    w("Rx"), w("Tab."), w("Paracetamol", 0.67, false, ["Paracetemol"], "context"), w("500", 0.67, true, ["650"]), w("mg"),
    { text: "\n" },
    w("1"), w("tab"), w("twice"), w("daily"), w("after"), w("food"),
    { text: "\n" },
    w("Tab."), w("Amoxyclav", 0.33, true, ["Amoxicillin", "Amoxil"]), w("625", 1), w("mg"), w("x"), w("5", 0.67, true, ["3"]), w("days"),
    { text: "\n" },
    w("Tab."), { ...w("Amlodipine", 1, true), lookalikes: ["amiloride"] }, w("5"), w("mg"), w("0-0-1"),
    { text: "\n" },
    w("Review"), w("after"), w("one", 0.67, false, ["ane"]), w("week"),
    { text: "\n" },
    w("[margin]"), w("check"), w("BP"),
  ];
  return {
    text: joinWords(words),
    marked: "",
    words,
    readings: {
      gemini: "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxyclav 625 mg x 5 days\nTab. Amlodipine 5 mg 0-0-1\nReview after one week\n[margin] check BP",
      "openrouter:gemma": "Rx Tab. Paracetemol 650 mg\n1 tab twice daily after food\nTab. Amoxicillin 625 mg x 5 days\nTab. Amlodipine 5 mg 0-0-1\nReview after ane week\n[margin] check BP",
      "openrouter:nemotron": "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxil 625 mg x 3 days\nTab. Amlodipine 5 mg 0-0-1\nReview after one week\n[margin] check BP",
    },
    errors: {},
    flagged: words.filter((x) => x.flagged).length,
    stages: { clean: true, vote: true, context: true },
    baseline: "Rx Tab. Paracetemol 650 mg\n1 tab twice daily after food\nTab. Amoxil 625 mg x 3 days\nTab. Amlodipine 5 mg 0-0-1\nReview after ane week\n[margin] check BP",
    doc_type: "prescription",
  };
})();

/** Canned prescription table for SAMPLE, so the table works with no keys. */
export const SAMPLE_ROWS: RxRow[] = [
  { drug: "Paracetamol", strength: "500 mg", form: "Tab", frequency: "1 tab twice daily after food", duration: "", flagged: true },
  { drug: "Amoxyclav", strength: "625 mg", form: "Tab", frequency: "", duration: "5 days", flagged: true },
  { drug: "Amlodipine", strength: "5 mg", form: "Tab", frequency: "0-0-1", duration: "", flagged: true },
];
