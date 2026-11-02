import type { CompletionCatalog, ScriptExport, ScriptMember } from "../types";
import type { Suggestion, SuggestionKind } from "./provider";
import { indexApi, membersOf, ScriptResolver } from "./scriptTypes";

/** Where the cursor sits in a script, enough to pick what to suggest. */
export interface ScriptContext {
  /**
   * "module" is an import path, "importName" a name inside `import { }`, "command" a
   * runCommand string, "member" a word after a dot.
   */
  kind: "word" | "member" | "string" | "module" | "importName" | "command";
  prefix: string;
  /** The replaced range, string contents only (quotes stay where they are). */
  start: number;
  end: number;
  /** The whole word under the cursor, so it isn't suggested back to itself. */
  typed: string;
  /** Members: where the dot is. Import names: the module named after `from`, if written yet. */
  dot?: number;
  module?: string | null;
}

const KEYWORDS = [
  "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete",
  "do", "else", "export", "extends", "false", "finally", "for", "from", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "of", "return", "static", "super",
  "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "yield",
];

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[\w$]/;

/**
 * Walks the script up to the cursor, skipping comments and following strings, then looks at
 * what is right before the cursor. Regex literals aren't tracked, a quote inside one can throw
 * the string state off until the line ends, which is fine for suggestions.
 */
export function scanScript(text: string, cursor: number): ScriptContext | null {
  let quote: string | null = null;
  let stringStart = 0;
  let i = 0;
  while (i < cursor) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      // hmm, only template strings may run over a newline
      else if (c === "\n" && quote !== "`") quote = null;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      if (end === -1 || end >= cursor) return null;
      i = end;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1 || end + 2 > cursor) return null;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      stringStart = i;
    }
    i++;
  }

  if (quote) {
    const inner = stringStart + 1;
    let end = cursor;
    while (end < text.length && text[end] !== quote && text[end] !== "\n") end++;
    const prefix = text.slice(inner, cursor);
    const before = text.slice(Math.max(0, stringStart - 40), stringStart);
    const typed = text.slice(inner, end);
    if (/(\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*$/.test(before)) {
      return { kind: "module", prefix, start: inner, end, typed };
    }
    if (/runCommand(Async)?\s*\(\s*$/.test(before)) {
      // the command name is the first word, after that it's arguments we know nothing about
      if (/\s/.test(prefix)) return null;
      const slash = prefix.startsWith("/") ? 1 : 0;
      const wordEnd = text.slice(cursor, end).search(/\s/);
      return {
        kind: "command",
        prefix: prefix.slice(slash),
        start: inner + slash,
        end: wordEnd === -1 ? end : cursor + wordEnd,
        typed,
      };
    }
    if (quote === "`") return null;
    return { kind: "string", prefix, start: inner, end, typed };
  }

  let start = cursor;
  while (start > 0 && IDENT.test(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && IDENT.test(text[end])) end++;
  const prefix = text.slice(start, cursor);
  if (prefix && !IDENT_START.test(prefix[0])) return null;
  const typed = text.slice(start, end);
  let dot = start - 1;
  while (dot >= 0 && /[ \t]/.test(text[dot])) dot--;
  if (text[dot] === "." && text[dot - 1] !== ".") return { kind: "member", prefix, start, end, typed, dot };
  // inside `import { a, b| } from "..."`, the module may come after the cursor
  if (/\bimport\s+(?:type\s+)?\{[^}"';]*$/.test(text.slice(Math.max(0, start - 400), start))) {
    const from = /^[^}"';]*\}\s*from\s*["']([^"']+)["']/.exec(text.slice(end, end + 400));
    return { kind: "importName", prefix, start, end, typed, module: from?.[1] ?? null };
  }
  return { kind: "word", prefix, start, end, typed };
}

/** Identifiers in the file, plus the ones written right after a dot, the cursor's own word left out. */
function documentWords(text: string, context: ScriptContext) {
  const words = new Set<string>();
  const members = new Set<string>();
  // strings and comments get swept too, a word from a comment is still a word worth offering
  const pattern = /([.]?)([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(pattern)) {
    const at = match.index + match[1].length;
    if (at === context.start) continue;
    const word = match[2];
    if (word.length < 2) continue;
    (match[1] ? members : words).add(word);
  }
  return { words, members };
}

const EXPORT_KINDS: Record<ScriptExport["kind"], SuggestionKind> = {
  class: "class",
  interface: "class",
  error: "class",
  enum: "enum",
  object: "variable",
  function: "method",
  constant: "constant",
};

const MEMBER_KINDS: Record<ScriptMember["kind"], SuggestionKind> = {
  method: "method",
  constructor: "method",
  property: "property",
  constant: "constant",
};

/** Modules the file imports from, by the path strings after `from`. */
function importedModules(text: string): Set<string> {
  return new Set([...text.matchAll(/\bfrom\s*["'](@minecraft\/[^"']+)["']/g)].map((match) => match[1]));
}

function exportSuggestions(catalog: CompletionCatalog, modules: Set<string> | null, group: number): Suggestion[] {
  const out: Suggestion[] = [];
  for (const module of catalog.scriptApi) {
    if (modules && !modules.has(module.name)) continue;
    for (const item of module.exports) {
      const detail = item.detail ? `${item.detail}  ${module.name}` : module.name;
      out.push({ label: item.name, kind: EXPORT_KINDS[item.kind], detail, group });
    }
  }
  return out;
}

/**
 * Suggestions for a JavaScript or TypeScript file. Module names and commands come from the
 * bedrock_addon catalog, `minecraft:` ids show up once a string has a colon in it (or on
 * Ctrl+Space), the rest is keywords and words of the file, like VS Code without a language
 * server.
 */
export function suggestScript(
  text: string,
  context: ScriptContext,
  catalog: CompletionCatalog | null,
  manual: boolean,
): Suggestion[] {
  const out: Suggestion[] = [];
  switch (context.kind) {
    case "module":
      for (const module of catalog?.manifest.scriptModules ?? []) {
        out.push({ label: module.name, kind: "module", detail: module.versions[0], group: 0 });
      }
      break;
    case "command":
      for (const command of catalog?.vanilla.commands ?? []) {
        out.push({ label: command.name, kind: "command", detail: command.usage, group: 0 });
        for (const alias of command.aliases) {
          out.push({ label: alias, kind: "command", detail: `alias of ${command.name}`, group: 1 });
        }
      }
      break;
    case "string": {
      if (!catalog || (!manual && !context.prefix.includes(":"))) break;
      const { vanilla } = catalog;
      const lists: [string[], string][] = [
        [vanilla.items, "item"],
        [vanilla.blocks, "block"],
        [vanilla.entities, "entity"],
        [vanilla.biomes, "biome"],
        [vanilla.effects, "effect"],
        [vanilla.enchantments, "enchantment"],
      ];
      for (const [ids, detail] of lists) {
        for (const id of ids) out.push({ label: id, kind: "value", detail, group: 1 });
      }
      break;
    }
    case "importName": {
      if (!catalog) break;
      const modules = context.module ? new Set([context.module]) : null;
      const written = /\{([^}]*)$/.exec(text.slice(0, context.start))?.[1] ?? "";
      const taken = new Set(written.split(",").map((name) => name.trim().split(/\s/)[0]));
      for (const item of exportSuggestions(catalog, modules, 0)) if (!taken.has(item.label)) out.push(item);
      break;
    }
    case "member": {
      if (catalog?.scriptApi.length && context.dot !== undefined) {
        const index = indexApi(catalog.scriptApi);
        const value = new ScriptResolver(index, text).resolveAt(context.dot);
        // a known type lists exactly its API, file words would only be noise next to it
        if (value && !value.many) {
          for (const member of membersOf(index, value.type, value.isStatic)) {
            out.push({ label: member.name, kind: MEMBER_KINDS[member.kind], detail: member.detail, group: 0 });
          }
          break;
        }
      }
      const { members } = documentWords(text, context);
      for (const word of members) out.push({ label: word, kind: "word", detail: "in this file", group: 0 });
      break;
    }
    case "word": {
      const { words } = documentWords(text, context);
      if (catalog) {
        const imported = importedModules(text);
        // nothing imported yet still gets @minecraft/server, the module every addon script starts with
        const modules = imported.size ? imported : new Set(["@minecraft/server"]);
        out.push(...exportSuggestions(catalog, modules, imported.size ? 0 : 2));
      }
      for (const keyword of KEYWORDS) out.push({ label: keyword, kind: "keyword", group: 1 });
      for (const word of words) out.push({ label: word, kind: "word", detail: "in this file", group: 3 });
      break;
    }
  }
  const seen = new Set<string>([context.typed]);
  return out.filter((item) => !seen.has(item.label) && (seen.add(item.label), true));
}
