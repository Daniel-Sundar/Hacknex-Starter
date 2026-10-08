// Types + helpers for the ClearScript (PS04) page. Matches POST /api/handwriting.

export type Word = {
  text: string;
  confidence?: number;
  flagged?: boolean;
  alternatives?: string[];
  resolved_by?: "context" | "human" | string;
  skipped?: boolean; // UI only: the human skipped this question
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

/** Flagged words to ask the human about: numbers/doses first, then lowest confidence. */
export function reviewQueue(words: Word[], max = 5): number[] {
  return words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.flagged)
    .sort((a, b) =>
      Number(hasDigit(b.w.text) || (b.w.alternatives ?? []).some(hasDigit)) -
        Number(hasDigit(a.w.text) || (a.w.alternatives ?? []).some(hasDigit)) ||
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
    w("Review"), w("after"), w("one", 0.67, false, ["ane"]), w("week"),
  ];
  return {
    text: joinWords(words),
    marked: "",
    words,
    readings: {
      gemini: "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxyclav 625 mg x 5 days\nReview after one week",
      "openrouter:gemma": "Rx Tab. Paracetemol 650 mg\n1 tab twice daily after food\nTab. Amoxicillin 625 mg x 5 days\nReview after ane week",
      "openrouter:nemotron": "Rx Tab. Paracetamol 500 mg\n1 tab twice daily after food\nTab. Amoxil 625 mg x 3 days\nReview after one week",
    },
    errors: {},
    flagged: words.filter((x) => x.flagged).length,
    stages: { clean: true, vote: true, context: true },
    baseline: "Rx Tab. Paracetemol 650 mg\n1 tab twice daily after food\nTab. Amoxil 625 mg x 3 days\nReview after ane week",
  };
})();
