import type { Language } from "./types";

export type TokenKind =
  | "key"
  | "string"
  | "number"
  | "keyword"
  | "constant"
  | "comment"
  | "punct"
  | "function"
  | "heading"
  | "code";

export interface Token {
  text: string;
  kind?: TokenKind;
}

type Rule = [RegExp, TokenKind];

const JS_KEYWORDS =
  "import|export|from|const|let|var|function|return|if|else|for|of|in|while|do|switch|case|break|continue|new|class|extends|async|await|try|catch|finally|throw|typeof|instanceof|default|this|yield";

const rules: Partial<Record<Language, Rule[]>> = {
  json: [
    [/"(?:\\.|[^"\\\n])*"(?=\s*:)/y, "key"],
    [/"(?:\\.|[^"\\\n])*"/y, "string"],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, "number"],
    [/\b(?:true|false|null)\b/y, "constant"],
    [/[{}[\],:]/y, "punct"],
  ],
  javascript: [
    [/\/\/[^\n]*/y, "comment"],
    [/\/\*[\s\S]*?(?:\*\/|$)/y, "comment"],
    [/`(?:\\.|[^`\\])*`?/y, "string"],
    [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, "string"],
    [new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, "y"), "keyword"],
    [/\b(?:true|false|null|undefined)\b/y, "constant"],
    [/\b\d+(?:\.\d+)?\b/y, "number"],
    [/[A-Za-z_$][\w$]*(?=\s*\()/y, "function"],
    [/[{}()[\];,.]|=>/y, "punct"],
  ],
  lang: [
    [/^##[^\n]*/my, "comment"],
    [/^[^=\n#]+(?==)/my, "key"],
    [/=/y, "punct"],
  ],
  markdown: [
    [/^#{1,6} [^\n]*/my, "heading"],
    [/`[^`\n]+`/y, "code"],
    [/^\s*[-*] /my, "punct"],
  ],
};
rules.typescript = rules.javascript;

/** Small regex lexer, good enough for the file types Bedrock addons use. */
export function highlight(text: string, language: Language): Token[] {
  const active = rules[language];
  if (!active) return [{ text }];

  const tokens: Token[] = [];
  let plainStart = 0;
  let pos = 0;
  outer: while (pos < text.length) {
    for (const [regex, kind] of active) {
      regex.lastIndex = pos;
      const match = regex.exec(text);
      if (!match || match[0].length === 0) continue;
      if (plainStart < pos) tokens.push({ text: text.slice(plainStart, pos) });
      tokens.push({ text: match[0], kind });
      pos += match[0].length;
      plainStart = pos;
      continue outer;
    }
    pos += 1;
  }
  if (plainStart < text.length) tokens.push({ text: text.slice(plainStart) });
  return tokens;
}
