import { api } from "../api";
import type { CompletionCatalog, Language } from "../types";
import { scanJson, type JsonContext } from "./context";
import { suggest, type Suggestion } from "./provider";
import { scanScript, suggestScript } from "./script";

export type { JsonContext } from "./context";
export type { Suggestion, SuggestionKind } from "./provider";

export interface Ranked extends Suggestion {
  /** Indices of the label characters the typed prefix matched, for highlighting. */
  matches: number[];
  score: number;
}

export interface Applied {
  text: string;
  /** Where the caret lands inside `text`. */
  caret: number;
  /** Open the list again right after, a picked JSON key goes on to its value. */
  retrigger: boolean;
}

export interface Completion {
  /** The range a picked suggestion replaces. */
  start: number;
  end: number;
  items: Ranked[];
  apply: (item: Suggestion) => Applied;
}

export function supportsCompletion(language: Language): boolean {
  return language === "json" || language === "javascript" || language === "typescript";
}

/** Long vanilla lists don't need to be rendered whole, nobody scrolls past this. */
const LIMIT = 200;

let catalog: Promise<CompletionCatalog | null> | null = null;

/**
 * The bedrock_addon catalog, asked for once. Null outside the desktop app (plain vite dev), a
 * failed ask is tried again on the next call instead of sticking.
 */
export function loadCatalog(): Promise<CompletionCatalog | null> {
  catalog ??= api.completionCatalog().catch((error) => {
    console.warn("completion catalog unavailable", error);
    catalog = null;
    return null;
  });
  return catalog;
}

/**
 * How well `query` matches `label`, or null when it doesn't. A plain prefix wins, then a prefix
 * of the part after the namespace (so `fric` finds `minecraft:friction`), then a substring, then
 * the letters in order with gaps, like VS Code's fuzzy match.
 */
export function score(label: string, query: string): { score: number; matches: number[] } | null {
  if (!query) return { score: 0, matches: [] };
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  const range = (from: number) => Array.from({ length: q.length }, (_, i) => from + i);
  if (lower.startsWith(q)) return { score: 4000 - label.length, matches: range(0) };
  const colon = lower.indexOf(":");
  if (colon !== -1 && lower.startsWith(q, colon + 1)) return { score: 3000 - label.length, matches: range(colon + 1) };
  const at = lower.indexOf(q);
  if (at !== -1) return { score: 2000 - at - label.length, matches: range(at) };
  const matches: number[] = [];
  let from = 0;
  for (const ch of q) {
    const found = lower.indexOf(ch, from);
    if (found === -1) return null;
    matches.push(found);
    from = found + 1;
  }
  const spread = matches[matches.length - 1] - matches[0];
  return { score: 1000 - spread - label.length, matches };
}

function rank(suggestions: Suggestion[], prefix: string): Ranked[] | null {
  const items: Ranked[] = [];
  for (const item of suggestions) {
    const hit = score(item.label, prefix);
    if (hit) items.push({ ...item, ...hit });
  }
  items.sort((a, b) => b.score - a.score || a.group - b.group || a.label.localeCompare(b.label));
  // hmm, the only suggestion being exactly what's typed is just noise
  if (!items.length || (items.length === 1 && items[0].label === prefix)) return null;
  return items.slice(0, LIMIT);
}

/**
 * Suggestions at `cursor`, filtered and sorted, or null when there is nothing to offer there.
 * `manual` is Ctrl+Space, which also opens lists that would be noise while just typing.
 */
export function complete(
  language: Language,
  path: string,
  text: string,
  cursor: number,
  data: CompletionCatalog | null,
  manual: boolean,
): Completion | null {
  if (language === "json") {
    const scan = scanJson(text, cursor);
    const context = scan.context;
    if (!context) return null;
    const items = rank(suggest(path, scan, data), context.prefix);
    if (!items) return null;
    return { start: context.start, end: context.end, items, apply: (item) => applyJson(context, item) };
  }
  if (!supportsCompletion(language)) return null;
  const context = scanScript(text, cursor);
  if (!context) return null;
  // a bare cursor in code with nothing typed only opens on request, like VS Code
  if (context.kind === "word" && !context.prefix && !manual) return null;
  const items = rank(suggestScript(text, context, data, manual), context.prefix);
  if (!items) return null;
  return {
    start: context.start,
    end: context.end,
    items,
    apply: (item) => ({ text: item.label, caret: item.label.length, retrigger: false }),
  };
}

/** The text replacing the key or value under the cursor, VS Code style `"key": {}` for keys. */
function applyJson(context: JsonContext, item: Suggestion): Applied {
  const label = JSON.stringify(item.label);
  if (context.position === "key") {
    if (context.colonAfter) return { text: label, caret: label.length, retrigger: false };
    const head = `${label}: `;
    switch (item.shape) {
      case "object":
        return { text: `${head}{}`, caret: head.length + 1, retrigger: false };
      case "array":
        return { text: `${head}[]`, caret: head.length + 1, retrigger: false };
      case "string":
        return { text: `${head}""`, caret: head.length + 1, retrigger: true };
      default:
        return { text: head, caret: head.length, retrigger: true };
    }
  }
  const text = item.quote === false ? item.label : label;
  return { text, caret: text.length, retrigger: false };
}
