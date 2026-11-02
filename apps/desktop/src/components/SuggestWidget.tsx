import { useLayoutEffect, useRef } from "react";
import {
  Box,
  Braces,
  ListOrdered,
  Package,
  Shapes,
  SquareFunction,
  SquareTerminal,
  ToggleLeft,
  Type,
  Variable,
  WholeWord,
} from "lucide-react";
import type { Ranked, SuggestionKind } from "../lib/completion";

interface SuggestWidgetProps {
  items: Ranked[];
  selected: number;
  top: number;
  left: string;
  /** Opens upwards, `top` is then the bottom edge. */
  above: boolean;
  rowHeight: number;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}

export const SUGGEST_ROWS = 10;

const ICONS: Record<SuggestionKind, typeof Box> = {
  component: Box,
  property: Braces,
  value: Type,
  keyword: ToggleLeft,
  module: Package,
  command: SquareTerminal,
  word: WholeWord,
  method: SquareFunction,
  class: Shapes,
  enum: ListOrdered,
  constant: ListOrdered,
  variable: Variable,
};

function Label({ text, matches }: { text: string; matches: number[] }) {
  if (!matches.length) return <>{text}</>;
  const hit = new Set(matches);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit.has(i)) last.text += text[i];
    else parts.push({ text: text[i], hit: hit.has(i) });
  }
  return (
    <>
      {parts.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
    </>
  );
}

/** The suggestion list under the caret. Clicks don't steal focus from the editor textarea. */
export function SuggestWidget({ items, selected, top, left, above, rowHeight, onHover, onPick }: SuggestWidgetProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  return (
    <div
      ref={listRef}
      className="suggest"
      role="listbox"
      style={{
        left,
        ...(above ? { bottom: `calc(100% - ${top}px)` } : { top }),
        maxHeight: rowHeight * SUGGEST_ROWS + 8,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={`${item.kind}:${item.label}`}
            role="option"
            aria-selected={index === selected}
            className={`suggest-item is-${item.kind}${index === selected ? " is-selected" : ""}${item.deprecated ? " is-deprecated" : ""}`}
            style={{ height: rowHeight }}
            onMouseMove={() => index !== selected && onHover(index)}
            onClick={() => onPick(index)}
          >
            <Icon className="suggest-icon" size={14} aria-hidden />
            <span className="suggest-label">
              <Label text={item.label} matches={item.matches} />
            </span>
            {item.detail && <span className="suggest-detail">{item.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
