/** A step into a JSON document, a member key or an array index. */
export type Segment = string | number;

/** Where the cursor sits in a JSON document, as far as completion cares. */
export interface JsonContext {
  /** "key" when a member name goes here, "value" for anything a value can be. */
  position: "key" | "value";
  /** Path to the object (for a key) or to the value being typed. */
  path: Segment[];
  /** What is already typed before the cursor, without the opening quote. */
  prefix: string;
  /** The whole word being typed, before and after the cursor. */
  typed: string;
  /** Offsets of the text a suggestion replaces, quotes included. */
  start: number;
  end: number;
  /** Whether the typed word sits inside quotes. */
  quoted: boolean;
  /** Keys of the object the cursor is in, the one being typed left out. */
  siblings: string[];
  /** A colon already follows the key being typed, so accepting must not add another. */
  colonAfter: boolean;
}

/** Everything a scan saw, used for suggestions taken from the document itself. */
export interface JsonScan {
  context: JsonContext | null;
  objects: { path: Segment[]; keys: string[] }[];
  values: { path: Segment[]; value: string }[];
}

interface Frame {
  kind: "object" | "array";
  /** Where an object is: waiting for a key, a colon, a value or the comma after it. */
  state: "key" | "colon" | "value" | "after";
  key: string | null;
  index: number;
  keys: string[];
  path: Segment[];
}

// no colon in here, `"a":1` must still split into a key, a colon and a value
const WORD = /[A-Za-z0-9_$@.+\-]/;

/**
 * Walks the whole text once with a forgiving tokenizer, so half typed documents still give a
 * useful answer. Comments and trailing commas are fine, like the game's reader. A string ends at
 * its line end, an unclosed quote while typing must not swallow the rest of the file.
 */
export function scanJson(text: string, cursor: number): JsonScan {
  const stack: Frame[] = [];
  const objects: JsonScan["objects"] = [];
  const values: JsonScan["values"] = [];
  let context: JsonContext | null = null;
  let cursorFrame: Frame | null = null;
  let typedKey: string | null = null;

  const top = () => stack[stack.length - 1];
  const childPath = (frame: Frame): Segment[] =>
    frame.kind === "object" ? [...frame.path, frame.key ?? ""] : [...frame.path, frame.index];

  /**
   * A string or bare word token, `start` and `end` cover the whole token. `inside` is the last
   * offset the cursor can be at and still be typing it, so right after a closing quote isn't.
   */
  const token = (value: string, start: number, end: number, quoted: boolean, inside: number, closed = true) => {
    const frame = top();
    // hmm, a key right after a value means a missing comma, still a key to whoever is typing it
    const isKey = frame?.kind === "object" && (frame.state === "key" || frame.state === "after");
    const inner = quoted ? start + 1 : start;
    if (!context && cursor >= inner && cursor <= inside) {
      // an unclosed quote runs to the line end, only the word under the cursor gets replaced
      if (!closed) {
        end = cursor;
        while (end < text.length && WORD.test(text[end])) end++;
      }
      context = {
        position: isKey ? "key" : "value",
        path: !frame ? [] : isKey ? frame.path : childPath(frame),
        prefix: text.slice(inner, cursor),
        typed: text.slice(inner, closed && quoted ? end - 1 : end),
        start,
        end,
        quoted,
        siblings: [],
        colonAfter: isKey && /^[ \t]*:/.test(text.slice(end)),
      };
      if (isKey) {
        cursorFrame = frame;
        typedKey = value;
      }
    }
    if (!frame) return;
    if (isKey) {
      frame.key = value;
      frame.keys.push(value);
      frame.state = "colon";
    } else if (frame.kind === "object") {
      if (quoted && frame.state === "value") values.push({ path: childPath(frame), value });
      frame.state = "after";
    } else if (quoted) {
      values.push({ path: childPath(frame), value });
    }
  };

  /** The cursor sits between tokens, the frame state says what may come next. */
  const gap = () => {
    if (context) return;
    const frame = top();
    if (!frame) return;
    // right after a key only a colon fits, right after a value only a comma
    if (frame.kind === "object" && (frame.state === "colon" || frame.state === "after")) return;
    const isKey = frame.kind === "object" && frame.state === "key";
    context = {
      position: isKey ? "key" : "value",
      path: isKey ? frame.path : childPath(frame),
      prefix: "",
      typed: "",
      start: cursor,
      end: cursor,
      quoted: false,
      siblings: [],
      colonAfter: false,
    };
    if (isKey) cursorFrame = frame;
  };

  let i = 0;
  while (i < text.length) {
    if (i === cursor) gap();
    const c = text[i];
    if (c === '"') {
      const start = i;
      let value = "";
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\" && i + 1 < text.length && text[i + 1] !== "\n") {
          value += text[i + 1];
          i += 2;
        } else {
          value += text[i++];
        }
      }
      const closed = text[i] === '"';
      // yeah, whatever trails an unclosed quote is mostly the rest of the line, keep the word
      if (!closed) value = /^[^\s{}[\],:]*/.exec(value)?.[0] ?? "";
      token(value, start, closed ? i + 1 : i, true, i, closed);
      if (closed) i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      if (cursor > i && (end === -1 || cursor <= end)) return { context: null, objects, values };
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      if (cursor > i && cursor < stop) return { context: null, objects, values };
      i = stop;
      continue;
    }
    if (WORD.test(c)) {
      const start = i;
      while (i < text.length && WORD.test(text[i])) i++;
      token(text.slice(start, i), start, i, false, i);
      continue;
    }
    switch (c) {
      case "{":
      case "[": {
        const parent = top();
        const path = parent ? childPath(parent) : [];
        if (parent?.kind === "object") parent.state = "after";
        stack.push({ kind: c === "{" ? "object" : "array", state: "key", key: null, index: 0, keys: [], path });
        break;
      }
      case "}":
      case "]": {
        const frame = stack.pop();
        if (frame?.kind === "object") objects.push({ path: frame.path, keys: frame.keys });
        break;
      }
      case ":": {
        const frame = top();
        if (frame?.kind === "object") frame.state = "value";
        break;
      }
      case ",": {
        const frame = top();
        if (frame?.kind === "object") frame.state = "key";
        else if (frame) frame.index++;
        break;
      }
    }
    i++;
  }
  if (cursor >= text.length) gap();
  // objects still open at the end of a half typed file count too
  for (const frame of stack) if (frame.kind === "object") objects.push({ path: frame.path, keys: frame.keys });

  const found = context as JsonContext | null;
  const owner = cursorFrame as Frame | null;
  if (found && owner) {
    let skipped = false;
    found.siblings = owner.keys.filter((key) => {
      if (!skipped && key === typedKey) {
        skipped = true;
        return false;
      }
      return true;
    });
  }
  return { context: found, objects, values };
}

/** Whether `path` matches `pattern`, where "*" in the pattern takes any key or index. */
export function matchesPath(path: Segment[], pattern: Segment[]): boolean {
  return path.length === pattern.length && pattern.every((step, i) => step === "*" || step === path[i]);
}

/** The path with every array index turned into "*", so items of one array compare equal. */
export function shapeOf(path: Segment[]): string {
  return path.map((step) => (typeof step === "number" ? "*" : step)).join("\u0000");
}
