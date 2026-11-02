/**
 * Small Markdown parser for the preview. Covers what READMEs and pack notes actually use
 * (headings, lists, task lists, quotes, fenced code, tables, emphasis, links, images),
 * not the whole CommonMark spec. Output is a tree, the preview turns it into React
 * elements, so nothing in a file ever ends up as raw HTML.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; src: string; alt: string }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** Set for task list items, `- [x] done`. */
  checked?: boolean;
  children: Block[];
}

export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.length - line.trimStart().length;

// lines that end a paragraph without a blank line in between
function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const indent = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
        i++;
      }
      i++; // closing fence, or past the end when the file never closes it
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, content: parseInline(heading[2] ?? "") });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      // lazy continuation: plain lines right after a quote line still belong to it
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
        body.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      blocks.push({ kind: "quote", children: parseBlocks(body) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      i = parseList(lines, i, blocks);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const align = splitRow(lines[i + 1]).map((cell): Align => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ kind: "table", align, head, rows });
      continue;
    }

    const para: string[] = [];
    let setext = 0;
    while (i < lines.length && !isBlank(lines[i])) {
      if (para.length && /^ {0,3}=+\s*$/.test(lines[i])) setext = 1;
      else if (para.length && /^ {0,3}-+\s*$/.test(lines[i])) setext = 2;
      if (setext) {
        i++;
        break;
      }
      if (para.length && startsBlock(lines[i])) break;
      para.push(lines[i]);
      i++;
    }
    const content = parseInline(para.map((l) => l.trimStart()).join("\n"));
    blocks.push(setext ? { kind: "heading", level: setext, content } : { kind: "paragraph", content });
  }
  return blocks;
}

/** Reads a whole list starting at `start`, pushes it and returns the first line after it. */
function parseList(lines: string[], start: number, out: Block[]): number {
  const first = LIST_ITEM.exec(lines[start])!;
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const marker = LIST_ITEM.exec(lines[i]);
    if (!marker || /\d/.test(marker[2]) !== ordered) break;
    // continuation lines have to be indented past the marker, a list nested in this one too
    const contentIndent = marker[1].length + marker[2].length + Math.max(1, Math.min(marker[3].length, 4));
    const body = [lines[i].slice(marker[0].length)];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (isBlank(next)) {
        // a blank line only stays in the item when indented content follows it
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) {
          body.push(...lines.slice(i, j).map(() => ""));
          i = j;
          continue;
        }
        break;
      }
      if (indentOf(next) >= contentIndent) body.push(next.slice(contentIndent));
      else if (!startsBlock(next) && !isBlank(body[body.length - 1])) body.push(next.trimStart());
      else break;
      i++;
    }
    let checked: boolean | undefined;
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (task) {
      checked = task[1] !== " ";
      body[0] = body[0].slice(task[0].length);
    }
    items.push({ checked, children: parseBlocks(body) });
    // a blank line between items is fine, anything else ends the list
    while (i < lines.length && isBlank(lines[i])) {
      if (i + 1 < lines.length && LIST_ITEM.test(lines[i + 1])) i++;
      else break;
    }
  }
  out.push({ kind: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items });
  return i;
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  // escaped pipes stay in the cell
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>"']/;
const URL_START = /https?:\/\/[^\s<]+/y;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length) {
      if (text[i + 1] === "\n") {
        push({ kind: "break" });
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(text[i + 1])) {
        buffer += text[i + 1];
        i += 2;
        continue;
      }
    }

    if (ch === "\n") {
      // two trailing spaces mean a hard break, otherwise it's just a space
      if (buffer.endsWith("  ")) {
        buffer = buffer.trimEnd();
        push({ kind: "break" });
      } else {
        buffer = buffer.trimEnd() + " ";
      }
      i++;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const fence = "`".repeat(run);
      const end = text.indexOf(fence, i + run);
      if (end !== -1) {
        let code = text.slice(i + run, end).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        push({ kind: "code", text: code });
        i = end + run;
        continue;
      }
      buffer += fence;
      i += run;
      continue;
    }

    if (ch === "!" && text[i + 1] === "[") {
      const link = readLink(text, i + 1);
      if (link) {
        push({ kind: "image", src: link.href, alt: link.label });
        i = link.end;
        continue;
      }
    }

    if (ch === "[") {
      const link = readLink(text, i);
      if (link) {
        push({ kind: "link", href: link.href, children: parseInline(link.label) });
        i = link.end;
        continue;
      }
    }

    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(text.slice(i));
      if (auto) {
        push({ kind: "link", href: auto[1], children: [{ kind: "text", text: auto[1] }] });
        i += auto[0].length;
        continue;
      }
    }

    if (ch === "h" && !/\w$/.test(buffer)) {
      URL_START.lastIndex = i;
      const bare = URL_START.exec(text);
      if (bare) {
        // trailing punctuation usually ends the sentence, not the url
        const url = bare[0].replace(/[.,:;!?)\]'"]+$/, "");
        push({ kind: "link", href: url, children: [{ kind: "text", text: url }] });
        i += url.length;
        continue;
      }
    }

    const emphasis = readEmphasis(text, i, buffer);
    if (emphasis) {
      push(emphasis.node);
      i = emphasis.end;
      continue;
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** `[label](href "title")` starting at the `[`. The title is accepted and dropped. */
function readLink(text: string, open: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close === -1 || text[close + 1] !== "(") return null;
  const target = /^\(\s*(<[^>]*>|[^\s)]*)(?:\s+("[^"]*"|'[^']*'))?\s*\)/.exec(text.slice(close + 1));
  if (!target) return null;
  return {
    label: text.slice(open + 1, close),
    href: target[1].replace(/^<|>$/g, ""),
    end: close + 1 + target[0].length,
  };
}

function readEmphasis(text: string, i: number, before: string): { node: Inline; end: number } | null {
  const ch = text[i];
  if (ch !== "*" && ch !== "_" && ch !== "~") return null;
  // snake_case_names shouldn't turn italic halfway through
  if (ch === "_" && /\w$/.test(before)) return null;

  const double = text[i + 1] === ch;
  if (ch === "~" && !double) return null;
  const delim = double ? ch + ch : ch;
  const from = i + delim.length;
  if (from >= text.length || /\s/.test(text[from])) return null;

  let search = from;
  while (search < text.length) {
    const end = text.indexOf(delim, search);
    if (end === -1) return null;
    // a closing `*` that is really half of `**` belongs to something else
    const doubledAfter = !double && text[end + 1] === ch;
    const tail = text[end + delim.length];
    if (end > from && !/\s/.test(text[end - 1]) && !doubledAfter && !(ch === "_" && tail && /\w/.test(tail))) {
      const kind = ch === "~" ? "del" : double ? "strong" : "em";
      return { node: { kind, children: parseInline(text.slice(from, end)) }, end: end + delim.length };
    }
    search = end + (doubledAfter ? 2 : 1);
  }
  return null;
}

/** Plain text of some inline content, for heading anchors and image fallbacks. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) =>
      n.kind === "text" || n.kind === "code"
        ? n.text
        : n.kind === "image"
          ? n.alt
          : n.kind === "break"
            ? " "
            : inlineText(n.children),
    )
    .join("");
}

/** GitHub style anchor, so `[see](#my-heading)` links inside the file work. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
