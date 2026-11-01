export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a ui file the way the game tolerates it: line and block comments and
 * trailing commas are fine. Throws a SyntaxError on anything else.
 */
export function parseUiJson(text: string): Json {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // copy the whole string so comment markers inside it survive
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === ",") {
      if (!closesNext(text, i + 1)) out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out) as Json;
}

// a comma is trailing when only whitespace and comments sit between it and the closing bracket
function closesNext(text: string, from: number): boolean {
  let j = from;
  while (j < text.length) {
    if (/\s/.test(text[j])) j++;
    else if (text.startsWith("//", j)) j = text.indexOf("\n", j) === -1 ? text.length : text.indexOf("\n", j);
    else if (text.startsWith("/*", j)) j = text.indexOf("*/", j) === -1 ? text.length : text.indexOf("*/", j) + 2;
    else return text[j] === "}" || text[j] === "]";
  }
  return false;
}
