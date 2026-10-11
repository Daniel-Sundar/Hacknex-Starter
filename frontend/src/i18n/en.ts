// English is the source language: every key must exist here. Other languages (./locales/*.ts) may leave
// keys out; t() then falls back to English. Keys are grouped by screen, one file each.
import common from "./en/common";
import clearscript from "./en/clearscript";
import docs from "./en/docs";
import legal from "./en/legal";

export const en = { ...common, ...clearscript, ...docs, ...legal };
export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
