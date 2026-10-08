// Docs Q&A: API types, checks before upload, error copy and the citation plugin for the answer's Markdown.
import type { Root } from "mdast";
import { describeError, type Problem } from "../../lib/errors";
import type { MessageKey } from "../../i18n";

export type DocInfo = { source: string; chunks: number };
export type Source = { source: string; text: string };
export type AskResult = { answer: string; sources: Source[]; grounded?: boolean };
export type UploadResult = { file: string; chunks: number; total_chunks?: number; replaced?: boolean };

export const DOC_EXTS = [".pdf", ".txt", ".md", ".csv"];
export const DOC_ACCEPT = ".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv";
export const MAX_QUESTION = 1000;
export const COUNTER_FROM = 800; // show the character counter from here on

const problem = (code: string, title: MessageKey, body: MessageKey, vars?: Record<string, string | number>): Problem =>
  ({ code, title, body, vars, retryable: false });

/** Instant, specific answer before uploading. The backend repeats every check. null = fine. */
export async function checkDoc(f: File, limitMb: number): Promise<Problem | null> {
  const name = f.name.toLowerCase();
  if (!DOC_EXTS.some((x) => name.endsWith(x))) return problem("unsupported_type", "docs.check.type.title", "docs.check.type.body");
  if (f.size === 0) return problem("empty_file", "err.empty_file.title", "err.empty_file.body");
  if (f.size > limitMb * 1024 * 1024) {
    const size = Math.ceil((f.size / (1024 * 1024)) * 10) / 10;
    return problem("too_large", "err.too_large.title", "docs.check.size.body", { size, limit: limitMb });
  }
  if (name.endsWith(".pdf")) {
    let head = "";
    try {
      head = String.fromCharCode(...new Uint8Array(await f.slice(0, 5).arrayBuffer()));
    } catch {
      return problem("bad_file", "err.bad_file.title", "err.bad_file.body");
    }
    if (head !== "%PDF-") return problem("unsupported_type", "docs.check.pdf.title", "docs.check.pdf.body");
  }
  return null;
}

/** describeError(), with copy that fits documents where the shared copy talks about photos or pages. */
export function describeDocsError(e: unknown, limitMb: number): Problem {
  const p = describeError(e, { maxUploadMb: limitMb });
  switch (p.code) {
    case "too_large": return { ...p, body: "docs.err.tooLarge.body" };
    case "unsupported_type": return { ...p, title: "docs.check.type.title", body: "docs.check.type.body" };
    case "all_models_failed": return { ...p, title: "docs.err.model.title", body: "docs.err.model.body" };
    default: return p;
  }
}

// ---------- citations ----------

// [1], [2, 3] or [2; 3]. Up to three digits so years like [2024] are left alone.
const CITE = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g;

const numbersIn = (inner: string) => inner.split(/[,;]/).map((s) => Number(s.trim()));

/** Every citation number in the answer, in order of appearance (duplicates kept). */
export function citedNumbers(answer: string): number[] {
  return Array.from(answer.matchAll(CITE)).flatMap((m) => numbersIn(m[1]));
}

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[]; data?: Record<string, unknown> };

const text = (value: string): MdNode => ({ type: "text", value });
// The marker becomes a link node carrying data-cite; the answer's `a` renderer turns it into a citation button.
// Plain text in the answer can't produce data-cite (raw HTML is skipped), so only real markers become buttons.
const citeNode = (n: number): MdNode => ({
  type: "link", url: `#source-${n}`, children: [text(String(n))], data: { hProperties: { dataCite: n } },
});

function splitCites(value: string, count: number): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(CITE)) {
    const nums = numbersIn(m[1]);
    if (!nums.some((n) => n >= 1 && n <= count)) continue; // nothing to link: keep the text as written
    const at = m.index ?? 0;
    if (at > last) out.push(text(value.slice(last, at)));
    // A number the backend returned no source for stays plain text: never show a citation that doesn't exist.
    for (const n of nums) out.push(n >= 1 && n <= count ? citeNode(n) : text(`[${n}]`));
    last = at + m[0].length;
  }
  if (!out.length) return [text(value)];
  if (last < value.length) out.push(text(value.slice(last)));
  return out;
}

function walk(node: MdNode, count: number) {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return splitCites(child.value, count);
    walk(child, count);
    return [child];
  });
}

/** remark plugin: [n] markers that match one of the `count` returned sources become citation links. */
export function remarkCitations(options: { count: number }) {
  return (tree: Root) => {
    if (options.count > 0) walk(tree as unknown as MdNode, options.count);
  };
}
