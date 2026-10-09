// Types + helpers for the ClearScript page. Matches POST /api/handwriting (and the `result` event of
// POST /api/handwriting/stream).

export type Word = {
  text: string;
  confidence?: number;          // share of models that read this word (agreement, not a probability)
  flagged?: boolean;
  alternatives?: string[];
  resolved_by?: "context" | "human" | string;
  evidence?: string;            // context fix: "lexicon" (dictionary-backed) | "guess" | "reread" | ...
  lookalikes?: string[];        // other drugs this drug name could be mistaken for (flagged even if all readers agree)
  votes?: Record<string, number>;
  readers?: number;
  by_model?: Record<string, string | null>; // what each model wrote here (null = nothing)
  original?: string;            // UI only: the text before a person corrected it
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

/** What kind of page it is. Sent as the `page` form field: the backend reads each type with its own instructions. */
export type PageType = "auto" | "note" | "form" | "prescription" | "legal";
export const PAGE_TYPES: PageType[] = ["auto", "note", "form", "prescription", "legal"];
export type Options = { clean: boolean; vote: boolean; context: boolean; baseline: boolean; page: PageType };
export const DEFAULT_OPTIONS: Options = { clean: true, vote: true, context: true, baseline: true, page: "auto" };

export const isNewline = (w: Word) => w.text === "\n";
export const isMarginTag = (w: Word) => w.text.toLowerCase() === "[margin]";
export const isUnreadable = (w: Word) => w.text === "[?]";
export const hasDigit = (s: string) => /\d/.test(s);

export type WordStatus = "agreed" | "flagged" | "lookalike" | "context" | "guess" | "human";

/** One status per word, in the order a reader must care about. */
export function wordStatus(w: Word): WordStatus {
  if (w.resolved_by === "human") return "human";
  if (w.flagged && w.lookalikes?.length) return "lookalike";
  if (w.flagged) return "flagged";
  if (w.resolved_by === "context") return w.evidence === "guess" ? "guess" : "context";
  return "agreed";
}

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

/** Flagged words in the order to check them: numbers/doses first, then look-alike drugs, then lowest agreement. */
export function reviewQueue(words: Word[]): number[] {
  return words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.flagged)
    .sort((a, b) =>
      Number(hasDigit(b.w.text) || (b.w.alternatives ?? []).some(hasDigit)) -
        Number(hasDigit(a.w.text) || (a.w.alternatives ?? []).some(hasDigit)) ||
      Number(!!b.w.lookalikes?.length) - Number(!!a.w.lookalikes?.length) ||
      (a.w.confidence ?? 0) - (b.w.confidence ?? 0) ||
      a.i - b.i,
    )
    .map(({ i }) => i);
}

/** Readings to offer for a word: what the models wrote first, then look-alike drugs. Never invented text. */
export function candidates(w: Word): string[] {
  const fromModels = w.by_model ? Object.values(w.by_model).filter((x): x is string => !!x) : [];
  const seen = new Set<string>();
  return [w.text, ...fromModels, ...(w.alternatives ?? []), ...(w.lookalikes ?? []), ...(w.original ? [w.original] : [])]
    .filter((x) => x && x !== "[?]" && x !== "\n")
    .filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase())); // "Metronidazole" = "metronidazole"
}

/** "2 of 3": how many models wrote exactly this word, out of how many read the page. */
export function agreement(w: Word, models: number): { votes: number; of: number } {
  if (w.by_model) {
    const all = Object.values(w.by_model);
    const same = all.filter((x) => x && x.toLowerCase() === w.text.toLowerCase()).length;
    return { votes: same, of: all.length };
  }
  const of = w.readers ?? models;
  return { votes: Math.round((w.confidence ?? 0) * of), of };
}

export function stats(words: Word[], result: HwResult | null) {
  const real = words.filter((w) => !isNewline(w) && !isMarginTag(w));
  const models = Object.keys(result?.readings ?? {}).length;
  const failed = Object.keys(result?.errors ?? {}).filter((k) => k !== "baseline").length;
  return {
    words: real.length,
    flagged: real.filter((w) => w.flagged).length,
    lookalikes: real.filter((w) => w.flagged && w.lookalikes?.length).length,
    human: real.filter((w) => w.resolved_by === "human").length,
    context: real.filter((w) => w.resolved_by === "context" && !w.flagged).length,
    agreement: real.length ? real.reduce((s, w) => s + (w.confidence ?? 0), 0) / real.length : 0,
    models,
    failed,
  };
}

/** Canned result so the UI can be demoed with no API keys. Always labelled as a sample in the UI. */
export const SAMPLE: HwResult = (() => {
  const M = ["gemini", "openrouter:gemma", "openrouter:nemotron"];
  const by = (a: string | null, b: string | null, c: string | null) => ({ [M[0]]: a, [M[1]]: b, [M[2]]: c });
  const w = (text: string, extra: Partial<Word> = {}): Word =>
    ({ text, confidence: 1, flagged: false, alternatives: [], by_model: by(text, text, text), ...extra });
  const words: Word[] = [
    w("Rx"), w("Tab."),
    w("Paracetamol", { confidence: 0.67, alternatives: ["Paracetemol"], resolved_by: "context", evidence: "lexicon", by_model: by("Paracetamol", "Paracetemol", "Paracetamol") }),
    w("500", { confidence: 0.67, flagged: true, alternatives: ["650"], by_model: by("500", "650", "500") }), w("mg"),
    { text: "\n" },
    w("1"), w("tab"), w("twice"), w("daily"), w("after"), w("food"),
    { text: "\n" },
    w("Tab."),
    w("Amoxyclav", { confidence: 0.33, flagged: true, alternatives: ["Amoxicillin", "Amoxil"], by_model: by("Amoxyclav", "Amoxicillin", "Amoxil") }),
    w("625"), w("mg"), w("x"),
    w("5", { confidence: 0.67, flagged: true, alternatives: ["3"], by_model: by("5", "5", "3") }), w("days"),
    { text: "\n" },
    w("Tab."), w("Amlodipine", { flagged: true, lookalikes: ["amiloride"] }), w("5"), w("mg"), w("0-0-1"),
    { text: "\n" },
    w("Review"), w("after"),
    w("one", { confidence: 0.67, alternatives: ["ane"], by_model: by("one", "ane", "one") }), w("week"),
    { text: "\n" },
    w("[margin]"), w("check"), w("BP"),
  ];
  return {
    text: joinWords(words),
    marked: markWords(words),
    words,
    readings: {
      [M[0]]: "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxyclav 625 mg x 5 days\nTab. Amlodipine 5 mg 0-0-1\nReview after one week\n[margin] check BP",
      [M[1]]: "Rx Tab. Paracetemol 650 mg\n1 tab twice daily after food\nTab. Amoxicillin 625 mg x 5 days\nTab. Amlodipine 5 mg 0-0-1\nReview after ane week\n[margin] check BP",
      [M[2]]: "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxil 625 mg x 3 days\nTab. Amlodipine 5 mg 0-0-1\nReview after one week\n[margin] check BP",
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
