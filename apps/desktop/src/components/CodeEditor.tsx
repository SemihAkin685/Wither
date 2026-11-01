import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { highlight } from "../lib/highlight";
import type { Language } from "../lib/types";

interface CodeEditorProps {
  path: string;
  content: string;
  language: Language;
  fontSize: number;
  showLineNumbers: boolean;
  reveal: { line: number; column: number; seq: number } | null;
  onChange: (content: string) => void;
  onCursor: (line: number, column: number) => void;
}

interface ViewState {
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
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

function insert(textarea: HTMLTextAreaElement, text: string) {
  // execCommand is deprecated but it's the only way to keep the native undo stack in a textarea
  if (!document.execCommand("insertText", false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function CodeEditor(props: CodeEditorProps) {
  const { path, content, language, fontSize, showLineNumbers, reveal, onChange, onCursor } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const lineHeight = Math.round(fontSize * 1.6);

  const tokens = useMemo(() => highlight(content, language), [content, language]);
  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const gutterWidth = `${Math.max(2, String(lineCount).length) + 2}ch`;

  const syncCursor = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { line, column } = cursorOf(textarea.value, textarea.selectionStart);
    setCursorLine(line);
    onCursor(line, column);
    keepCaretVisible(line, column);
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.shiftKey) insert(textarea, INDENT);
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
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={i + 1 === cursorLine ? "is-current" : ""}>
                {i + 1}
              </div>
            ))}
          </div>
        )}
        <div className="code-surface">
          <div className="current-line" style={{ top: PADDING_Y + (cursorLine - 1) * lineHeight }} />
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
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onSelect={syncCursor}
          />
        </div>
      </div>
    </div>
  );
}
