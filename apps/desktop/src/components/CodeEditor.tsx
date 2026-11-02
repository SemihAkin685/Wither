import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { complete, loadCatalog, supportsCompletion, type Completion } from "../lib/completion";
import {
  copyLines,
  deleteLines,
  indentLines,
  insertLine,
  lineBlock,
  lineCommentFor,
  moveLines,
  outdentLines,
  toggleLineComment,
  type Edit,
} from "../lib/editing";
import { highlight } from "../lib/highlight";
import type { CompletionCatalog, Language, Problem } from "../lib/types";
import { SUGGEST_ROWS, SuggestWidget } from "./SuggestWidget";

interface CodeEditorProps {
  path: string;
  content: string;
  language: Language;
  fontSize: number;
  showLineNumbers: boolean;
  reveal: { line: number; column: number; seq: number } | null;
  /** Problems in this file only. */
  problems: Problem[];
  onChange: (content: string) => void;
  onCursor: (line: number, column: number) => void;
}

interface ViewState {
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
}

interface SuggestState {
  completion: Completion;
  selected: number;
  top: number;
  left: string;
  above: boolean;
}

const INDENT = "  ";
const PADDING_Y = 8;
const PADDING_X = 16;
const viewStates = new Map<string, ViewState>();

function cursorOf(text: string, offset: number) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function offsetOf(text: string, line: number, column: number) {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  return Math.min(offset + column - 1, lineEnd === -1 ? text.length : lineEnd);
}

/** Where `column` lands on screen, tabs stop every INDENT.length columns like the textarea. */
function visualColumn(lineText: string, column: number) {
  let visual = 0;
  for (let i = 0; i < column - 1 && i < lineText.length; i++) {
    visual = lineText[i] === "\t" ? visual + INDENT.length - (visual % INDENT.length) : visual + 1;
  }
  return visual + Math.max(0, column - 1 - lineText.length);
}

interface ProblemMark {
  key: string;
  line: number;
  severity: Problem["severity"];
  start: number;
  /** The marked characters, drawn transparent so only their wavy underline shows. */
  text: string;
}

interface LineProblems {
  severity: Problem["severity"];
  messages: string[];
  /** Visual width of the line, the inline message goes right after it. */
  end: number;
}

/** Underline boxes and per line summaries, in visual columns. */
function layoutProblems(content: string, problems: Problem[]) {
  const lines = content.split("\n");
  const marks: ProblemMark[] = [];
  const byLine = new Map<number, LineProblems>();
  problems.forEach((problem, i) => {
    const text = lines[problem.line - 1];
    if (text === undefined) return;
    const start = visualColumn(text, problem.column);
    // a span running onto later lines is only underlined up to the end of its first line
    const endColumn = problem.endLine > problem.line ? text.length + 1 : problem.endColumn;
    const marked = text.slice(problem.column - 1, Math.max(problem.column, endColumn) - 1).replace(/\t/g, INDENT);
    // an empty mark (end of line, end of file) still gets one cell so there is something to see
    marks.push({ key: `${i}`, line: problem.line, severity: problem.severity, start, text: marked || " " });
    const entry = byLine.get(problem.line);
    if (entry) {
      entry.messages.push(problem.message);
      if (problem.severity === "error") entry.severity = "error";
    } else {
      byLine.set(problem.line, {
        severity: problem.severity,
        messages: [problem.message],
        end: visualColumn(text, text.length + 1),
      });
    }
  });
  return { marks, byLine };
}

/** Replaces a range and sets the selection after it, still through insertText so undo works. */
function applyEdit(textarea: HTMLTextAreaElement, edit: Edit) {
  textarea.setSelectionRange(edit.start, edit.end);
  // yeah, insertText with "" doesn't delete in every webkit build, delete does
  if (edit.text || edit.start === edit.end || !document.execCommand("delete")) insert(textarea, edit.text);
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}

/** Matches a letter shortcut by key or by physical key, so it still works on non latin layouts. */
function isKey(event: KeyboardEvent<HTMLTextAreaElement>, letter: string) {
  return event.key.toLowerCase() === letter || event.code === `Key${letter.toUpperCase()}`;
}

function insert(textarea: HTMLTextAreaElement, text: string) {
  // execCommand is deprecated but it's the only way to keep the native undo stack in a textarea
  if (!document.execCommand("insertText", false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function CodeEditor(props: CodeEditorProps) {
  const { path, content, language, fontSize, showLineNumbers, reveal, problems, onChange, onCursor } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  // ok so key handlers and input events need the list synchronously, the state only drives render
  const suggestRef = useRef<SuggestState | null>(null);
  const catalogRef = useRef<CompletionCatalog | null>(null);
  // set while the editor itself writes into the textarea, those inputs shouldn't open suggestions
  const programmaticRef = useRef(false);
  const lineHeight = Math.round(fontSize * 1.6);

  const tokens = useMemo(() => highlight(content, language), [content, language]);
  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const { marks, byLine } = useMemo(() => layoutProblems(content, problems), [content, problems]);
  const gutterWidth = `${Math.max(2, String(lineCount).length) + 2}ch`;

  useEffect(() => {
    if (!supportsCompletion(language)) return;
    let live = true;
    loadCatalog().then((catalog) => {
      if (live) catalogRef.current = catalog;
    });
    return () => {
      live = false;
    };
  }, [language]);

  const showSuggest = (next: SuggestState | null) => {
    suggestRef.current = next;
    setSuggest(next);
  };

  /**
   * Recomputes suggestions at the caret. Without `open` it only refreshes a list that is already
   * up, `manual` is Ctrl+Space.
   */
  const refreshSuggest = (open: boolean, manual = false) => {
    const textarea = textareaRef.current;
    const scroller = scrollRef.current;
    if (!textarea || !scroller || !supportsCompletion(language)) return;
    if (!open && !suggestRef.current) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return showSuggest(null);
    if (!catalogRef.current) {
      // the catalog can still be on its way on the first keystrokes, ask again once it lands
      loadCatalog().then((catalog) => {
        if (!catalog || catalogRef.current) return;
        catalogRef.current = catalog;
        if (document.activeElement === textareaRef.current) refreshSuggest(open, manual);
      });
    }
    const text = textarea.value;
    const completion = complete(language, path, text, textarea.selectionStart, catalogRef.current, manual);
    if (!completion) return showSuggest(null);
    const { line, column } = cursorOf(text, completion.start);
    const lineText = text.split("\n", line)[line - 1] ?? "";
    const lineTop = PADDING_Y + (line - 1) * lineHeight;
    const height = Math.min(completion.items.length, SUGGEST_ROWS) * lineHeight + 8;
    // flip above the line when there's no room under it but there is over it
    const above =
      lineTop + lineHeight + height > scroller.scrollTop + scroller.clientHeight && lineTop - height >= scroller.scrollTop;
    showSuggest({
      completion,
      selected: 0,
      top: above ? lineTop : lineTop + lineHeight,
      left: `calc(${PADDING_X}px + ${visualColumn(lineText, column)}ch)`,
      above,
    });
  };

  const acceptSuggest = (index: number) => {
    const textarea = textareaRef.current;
    const current = suggestRef.current;
    const item = current?.completion.items[index];
    if (!textarea || !current || !item) return;
    const { start, end, apply } = current.completion;
    const { text, caret, retrigger } = apply(item);
    showSuggest(null);
    runEdit({ start, end, text, selectionStart: start + caret, selectionEnd: start + caret });
    // like VS Code, a picked key goes straight on to its value suggestions
    if (retrigger) refreshSuggest(true);
  };

  const runEdit = (edit: Edit | null) => {
    const textarea = textareaRef.current;
    if (!textarea || !edit) return;
    programmaticRef.current = true;
    applyEdit(textarea, edit);
    programmaticRef.current = false;
    syncCursor();
  };

  /** Typing a word character or a quote opens the list, deleting only narrows an open one. */
  const afterInput = (event: Event) => {
    if (programmaticRef.current || !supportsCompletion(language)) return;
    // the setRangeText fallback in insert() fires a plain Event, no inputType on it
    const type = (event as InputEvent).inputType ?? "";
    const data = (event as InputEvent).data ?? "";
    if (type === "insertText" && /^[\w"'`$@.:/\-]$/.test(data)) refreshSuggest(true);
    else if (type.startsWith("delete")) refreshSuggest(false);
    else showSuggest(null);
  };

  const syncCursor = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { line, column } = cursorOf(textarea.value, textarea.selectionStart);
    setCursorLine(line);
    onCursor(line, column);
    keepCaretVisible(line, column);
    const open = suggestRef.current;
    if (open) {
      // hmm, select can fire before the input event, so one past the end still counts as typing
      const { start, end } = open.completion;
      const caret = textarea.selectionStart;
      if (textarea.selectionEnd !== caret || caret < start || caret > end + 1) showSuggest(null);
    }
  };

  const keepCaretVisible = (line: number, column: number, center = false) => {
    const scroller = scrollRef.current;
    const charWidth = measureRef.current?.getBoundingClientRect().width ?? fontSize * 0.6;
    if (!scroller) return;
    const top = PADDING_Y + (line - 1) * lineHeight;
    const gutter = showLineNumbers ? (scroller.querySelector(".gutter")?.clientWidth ?? 0) : 0;
    const left = (column - 1) * charWidth;
    if (center) {
      scroller.scrollTop = top - scroller.clientHeight / 2;
    } else if (top < scroller.scrollTop) {
      scroller.scrollTop = top - PADDING_Y;
    } else if (top + lineHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + lineHeight + PADDING_Y - scroller.clientHeight;
    }
    const visibleWidth = scroller.clientWidth - gutter - PADDING_X * 2;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (left > scroller.scrollLeft + visibleWidth) scroller.scrollLeft = left - visibleWidth;
  };

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const textarea = textareaRef.current;
    const saved = viewStates.get(path);
    if (scroller && textarea && saved) {
      scroller.scrollTop = saved.scrollTop;
      scroller.scrollLeft = saved.scrollLeft;
      textarea.setSelectionRange(saved.selectionStart, saved.selectionEnd);
    }
    textarea?.focus({ preventScroll: true });
    if (textarea) {
      const { line, column } = cursorOf(textarea.value, textarea.selectionStart);
      setCursorLine(line);
      onCursor(line, column);
    }
    return () => {
      if (scroller && textarea) {
        viewStates.set(path, {
          scrollTop: scroller.scrollTop,
          scrollLeft: scroller.scrollLeft,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd,
        });
      }
    };
    // ok so this only runs once per file, cursor updates after that go through syncCursor
  }, [path]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!reveal || !textarea) return;
    const offset = offsetOf(textarea.value, reveal.line, reveal.column);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset);
    setCursorLine(reveal.line);
    onCursor(reveal.line, reveal.column);
    keepCaretVisible(reveal.line, reveal.column, true);
  }, [reveal?.seq]);

  /**
   * The VS Code editing shortcuts. Undo, redo and the clipboard go through execCommand so they
   * share the textarea's native undo stack. True when the key was handled.
   */
  const handleShortcut = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const textarea = event.currentTarget;
    const { selectionStart: from, selectionEnd: to, value } = textarea;
    const ctrl = event.ctrlKey || event.metaKey;
    const { shiftKey: shift, altKey: alt } = event;

    if (ctrl && !alt) {
      if (isKey(event, "z")) {
        document.execCommand(shift ? "redo" : "undo");
        return true;
      }
      if (isKey(event, "y") && !shift) {
        document.execCommand("redo");
        return true;
      }
      if ((isKey(event, "x") || isKey(event, "c")) && !shift) {
        const cut = isKey(event, "x");
        if (from === to) {
          // nothing selected copies or cuts the whole line, break included, like VS Code
          const block = lineBlock(value, from, to);
          programmaticRef.current = true;
          textarea.setSelectionRange(block.start, Math.min(value.length, block.end + 1));
          document.execCommand(cut ? "cut" : "copy");
          programmaticRef.current = false;
          if (!cut) textarea.setSelectionRange(from, to);
          syncCursor();
        } else {
          document.execCommand(cut ? "cut" : "copy");
        }
        return true;
      }
      if (isKey(event, "v") && !shift) {
        // hmm, webkit refuses execCommand("paste") from script, the async clipboard api works
        navigator.clipboard
          .readText()
          .then((text) => insert(textarea, text))
          .catch(() => document.execCommand("paste"));
        return true;
      }
      if (isKey(event, "k") && shift) {
        runEdit(deleteLines(value, from, to));
        return true;
      }
      if (isKey(event, "l") && !shift) {
        const block = lineBlock(value, from, to);
        textarea.setSelectionRange(block.start, Math.min(value.length, block.end + 1));
        syncCursor();
        return true;
      }
      if (event.key === "/" || event.code === "NumpadDivide") {
        const marker = lineCommentFor(language);
        if (marker) runEdit(toggleLineComment(value, from, to, marker));
        return true;
      }
      if (event.key === "]" && !shift) {
        runEdit(indentLines(value, from, to, INDENT));
        return true;
      }
      if (event.key === "[" && !shift) {
        runEdit(outdentLines(value, from, to, INDENT));
        return true;
      }
      if (event.key === "Enter") {
        runEdit(insertLine(value, from, to, !shift));
        return true;
      }
    }
    if (alt && !ctrl && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const down = event.key === "ArrowDown";
      runEdit(shift ? copyLines(value, from, to, down) : moveLines(value, from, to, down));
      return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    if (event.ctrlKey && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      refreshSuggest(true, true);
      return;
    }
    if (handleShortcut(event)) {
      event.preventDefault();
      showSuggest(null);
      return;
    }
    const open = suggestRef.current;
    if (open && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const count = open.completion.items.length;
      const move = (to: number) => {
        event.preventDefault();
        showSuggest({ ...open, selected: to });
      };
      switch (event.key) {
        case "ArrowDown":
          return move((open.selected + 1) % count);
        case "ArrowUp":
          return move((open.selected - 1 + count) % count);
        case "PageDown":
          return move(Math.min(count - 1, open.selected + SUGGEST_ROWS));
        case "PageUp":
          return move(Math.max(0, open.selected - SUGGEST_ROWS));
        case "Enter":
        case "Tab":
          if (event.shiftKey) break;
          event.preventDefault();
          acceptSuggest(open.selected);
          return;
        case "Escape":
          event.preventDefault();
          showSuggest(null);
          return;
      }
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const { selectionStart: from, selectionEnd: to, value } = textarea;
      if (event.shiftKey) runEdit(outdentLines(value, from, to, INDENT));
      else if (value.slice(from, to).includes("\n")) runEdit(indentLines(value, from, to, INDENT));
      else insert(textarea, INDENT);
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const before = textarea.value.slice(0, textarea.selectionStart);
      const lineStart = before.lastIndexOf("\n") + 1;
      const indent = /^[ \t]*/.exec(before.slice(lineStart))?.[0] ?? "";
      const opensBlock = /[{[(]\s*$/.test(before);
      insert(textarea, `\n${indent}${opensBlock ? INDENT : ""}`);
    }
  };

  return (
    <div
      ref={scrollRef}
      className="code-editor"
      style={{
        fontSize,
        lineHeight: `${lineHeight}px`,
        ["--line-height" as string]: `${lineHeight}px`,
      }}
    >
      <span ref={measureRef} className="char-measure" aria-hidden>
        M
      </span>
      <div className="code-inner" style={{ minHeight: lineCount * lineHeight + PADDING_Y * 2 }}>
        {showLineNumbers && (
          <div className="gutter" style={{ width: gutterWidth }} aria-hidden>
            {Array.from({ length: lineCount }, (_, i) => {
              const lineProblems = byLine.get(i + 1);
              const classes = [i + 1 === cursorLine ? "is-current" : "", lineProblems ? `has-${lineProblems.severity}` : ""];
              return (
                <div key={i} className={classes.join(" ").trim()} title={lineProblems?.messages.join("\n")}>
                  {i + 1}
                </div>
              );
            })}
          </div>
        )}
        <div className="code-surface">
          <div className="current-line" style={{ top: PADDING_Y + (cursorLine - 1) * lineHeight }} />
          <div className="problem-layer" aria-hidden>
            {/* ok so the font is monospace, ch lines these up with the text without measuring */}
            {marks.map((mark) => (
              <div
                key={mark.key}
                className={`problem-mark is-${mark.severity}`}
                style={{ top: PADDING_Y + (mark.line - 1) * lineHeight, left: `calc(${PADDING_X}px + ${mark.start}ch)` }}
              >
                {mark.text}
              </div>
            ))}
            {[...byLine].map(([line, entry]) => (
              <div
                key={line}
                className={`problem-inline is-${entry.severity}`}
                style={{ top: PADDING_Y + (line - 1) * lineHeight, left: `calc(${PADDING_X}px + ${entry.end + 3}ch)` }}
              >
                {entry.messages[0]}
                {entry.messages.length > 1 && ` (+${entry.messages.length - 1})`}
              </div>
            ))}
          </div>
          <pre className="code-highlight" aria-hidden>
            {tokens.map((token, i) =>
              token.kind ? (
                <span key={i} className={`tok-${token.kind}`}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )}
            {"\n"}
          </pre>
          <textarea
            ref={textareaRef}
            className="code-input"
            value={content}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label={`Editor for ${path}`}
            onChange={(e) => {
              onChange(e.target.value);
              afterInput(e.nativeEvent);
            }}
            onKeyDown={onKeyDown}
            onSelect={syncCursor}
            onBlur={() => showSuggest(null)}
          />
          {suggest && (
            <SuggestWidget
              items={suggest.completion.items}
              selected={suggest.selected}
              top={suggest.top}
              left={suggest.left}
              above={suggest.above}
              rowHeight={lineHeight}
              onHover={(index) => showSuggest({ ...suggest, selected: index })}
              onPick={acceptSuggest}
            />
          )}
        </div>
      </div>
    </div>
  );
}
