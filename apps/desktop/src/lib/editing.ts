/**
 * Line edits behind the editor shortcuts, as plain functions over the text and the selection.
 * Each returns one replacement plus the selection after it, so the editor can apply it with a
 * single insertText and the native undo stack keeps working.
 */
export interface Edit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** The full lines a selection touches. A selection ending right at a line start leaves that line out. */
export function lineBlock(text: string, selectionStart: number, selectionEnd: number) {
  const last = selectionEnd > selectionStart && text[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
  const start = text.lastIndexOf("\n", selectionStart - 1) + 1;
  const newline = text.indexOf("\n", last);
  return { start, end: newline === -1 ? text.length : newline };
}

/** Ctrl+Shift+K, drops the lines with their line break and leaves the caret on the next line. */
export function deleteLines(text: string, selectionStart: number, selectionEnd: number): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  if (block.end < text.length) {
    return { start: block.start, end: block.end + 1, text: "", selectionStart: block.start, selectionEnd: block.start };
  }
  // the last line has no break after it, so the one before it goes and the caret moves up
  const start = Math.max(0, block.start - 1);
  const caret = text.lastIndexOf("\n", start - 1) + 1;
  return { start, end: block.end, text: "", selectionStart: caret, selectionEnd: caret };
}

/** Alt+Up / Alt+Down, swaps the lines with the one above or below. Null at the edge of the file. */
export function moveLines(text: string, selectionStart: number, selectionEnd: number, down: boolean): Edit | null {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const lines = text.slice(block.start, block.end);
  if (down) {
    if (block.end === text.length) return null;
    const nextEnd = text.indexOf("\n", block.end + 1);
    const end = nextEnd === -1 ? text.length : nextEnd;
    const next = text.slice(block.end + 1, end);
    const shift = next.length + 1;
    return {
      start: block.start,
      end,
      text: `${next}\n${lines}`,
      selectionStart: selectionStart + shift,
      selectionEnd: selectionEnd + shift,
    };
  }
  if (block.start === 0) return null;
  const prevStart = text.lastIndexOf("\n", block.start - 2) + 1;
  const prev = text.slice(prevStart, block.start - 1);
  const shift = prev.length + 1;
  return {
    start: prevStart,
    end: block.end,
    text: `${lines}\n${prev}`,
    selectionStart: selectionStart - shift,
    selectionEnd: selectionEnd - shift,
  };
}

/** Shift+Alt+Up / Shift+Alt+Down, duplicates the lines and selects the copy in that direction. */
export function copyLines(text: string, selectionStart: number, selectionEnd: number, down: boolean): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const lines = text.slice(block.start, block.end);
  const shift = down ? lines.length + 1 : 0;
  return {
    start: block.end,
    end: block.end,
    text: `\n${lines}`,
    selectionStart: selectionStart + shift,
    selectionEnd: selectionEnd + shift,
  };
}

/**
 * Ctrl+/, comments the lines out at their shared indent, or takes the comment off when every
 * non blank line already has one.
 */
export function toggleLineComment(text: string, selectionStart: number, selectionEnd: number, marker: string): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const lines = text.slice(block.start, block.end).split("\n");
  const filled = lines.filter((line) => line.trim());
  const commented = filled.length > 0 && filled.every((line) => line.trimStart().startsWith(marker));
  const indent = Math.min(...filled.map((line) => line.length - line.trimStart().length), Infinity);
  let firstDelta = 0;
  const out = lines.map((line, i) => {
    if (!line.trim()) return line;
    let next: string;
    if (commented) {
      const at = line.indexOf(marker);
      const width = marker.length + (line[at + marker.length] === " " ? 1 : 0);
      next = line.slice(0, at) + line.slice(at + width);
    } else {
      const at = Number.isFinite(indent) ? indent : 0;
      next = `${line.slice(0, at)}${marker} ${line.slice(at)}`;
    }
    if (i === 0) firstDelta = next.length - line.length;
    return next;
  });
  const replaced = out.join("\n");
  const delta = replaced.length - (block.end - block.start);
  return {
    start: block.start,
    end: block.end,
    text: replaced,
    selectionStart: Math.max(block.start, selectionStart + firstDelta),
    selectionEnd: Math.max(block.start, selectionEnd + (selectionEnd === selectionStart ? firstDelta : delta)),
  };
}

/** Tab on a multi line selection or Ctrl+], one indent step in front of every line. */
export function indentLines(text: string, selectionStart: number, selectionEnd: number, indent: string): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const lines = text.slice(block.start, block.end).split("\n");
  const out = lines.map((line) => (line ? indent + line : line)).join("\n");
  return {
    start: block.start,
    end: block.end,
    text: out,
    selectionStart: selectionStart + (lines[0] ? indent.length : 0),
    selectionEnd: selectionEnd + out.length - (block.end - block.start),
  };
}

/** Shift+Tab or Ctrl+[, takes one indent step (or a tab) off every line that has one. */
export function outdentLines(text: string, selectionStart: number, selectionEnd: number, indent: string): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const lines = text.slice(block.start, block.end).split("\n");
  const removed = lines.map((line) => {
    if (line.startsWith("\t")) return 1;
    let n = 0;
    while (n < indent.length && line[n] === " ") n++;
    return n;
  });
  const out = lines.map((line, i) => line.slice(removed[i])).join("\n");
  const caretLine = text.slice(block.start, selectionStart);
  return {
    start: block.start,
    end: block.end,
    text: out,
    selectionStart: Math.max(block.start, selectionStart - Math.min(removed[0], caretLine.length)),
    selectionEnd: Math.max(block.start, selectionEnd - (block.end - block.start - out.length)),
  };
}

/** Ctrl+Enter / Ctrl+Shift+Enter, opens an empty line below or above with the same indent. */
export function insertLine(text: string, selectionStart: number, selectionEnd: number, below: boolean): Edit {
  const block = lineBlock(text, selectionStart, selectionEnd);
  const line = text.slice(block.start, block.end);
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (below) {
    const caret = block.end + 1 + indent.length;
    return { start: block.end, end: block.end, text: `\n${indent}`, selectionStart: caret, selectionEnd: caret };
  }
  const caret = block.start + indent.length;
  return { start: block.start, end: block.start, text: `${indent}\n`, selectionStart: caret, selectionEnd: caret };
}

/** The comment marker Ctrl+/ uses for a language, null when it has no line comments. */
export function lineCommentFor(language: string): string | null {
  switch (language) {
    case "json":
    case "javascript":
    case "typescript":
      return "//";
    case "lang":
      return "##";
    default:
      return null;
  }
}
