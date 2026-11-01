import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Command } from "../lib/commands";
import { fileName, fuzzyScore } from "../lib/tree";
import type { FileNode } from "../lib/types";
import type { PaletteMode } from "../state/workbench";
import { FileIcon } from "./FileIcon";
import { Keys } from "./ui";

interface CommandPaletteProps {
  mode: PaletteMode;
  commands: Command[];
  files: FileNode[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

interface Item {
  id: string;
  label: string;
  detail?: string;
  keys?: string;
  file?: FileNode;
  run: () => void;
}

const MAX_ITEMS = 60;

export function CommandPalette({ mode: initialMode, commands, files, onOpenFile, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState(initialMode === "commands" ? ">" : "");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mode: PaletteMode = query.startsWith(">") ? "commands" : "files";
  const term = mode === "commands" ? query.slice(1).trim() : query.trim();

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    if (mode === "commands") {
      return commands
        .map((c) => ({ c, score: fuzzyScore(term, `${c.category}: ${c.title}`) }))
        .filter((x): x is { c: Command; score: number } => x.score !== null)
        .sort((a, b) => (term ? b.score - a.score : 0))
        .slice(0, MAX_ITEMS)
        .map(({ c }) => ({
          id: c.id,
          label: `${c.category}: ${c.title}`,
          keys: c.keys?.split(" / ")[0],
          run: c.run,
        }));
    }
    return files
      .map((f) => ({ f, score: fuzzyScore(term, f.path) }))
      .filter((x): x is { f: FileNode; score: number } => x.score !== null)
      .sort((a, b) => (term ? b.score - a.score : a.f.path.localeCompare(b.f.path)))
      .slice(0, MAX_ITEMS)
      .map(({ f }) => ({
        id: f.path,
        label: fileName(f.path),
        detail: f.path.slice(0, f.path.lastIndexOf("/")),
        file: f,
        run: () => onOpenFile(f.path),
      }));
  }, [mode, term, commands, files, onOpenFile]);

  useEffect(() => setSelected(0), [mode, term]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setSelected((i) => Math.min(items.length - 1, i + 1));
    else if (event.key === "ArrowUp") setSelected((i) => Math.max(0, i - 1));
    else if (event.key === "Enter") choose(items[selected]);
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder={mode === "commands" ? "Type a command" : "Search files by name, type > for commands"}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef} role="listbox">
          {items.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === selected}
              className={`palette-item${index === selected ? " is-selected" : ""}`}
              onMouseMove={() => setSelected(index)}
              onClick={() => choose(item)}
            >
              {item.file && <FileIcon language={item.file.language} size={14} />}
              <span className="palette-label">{item.label}</span>
              {item.detail && <span className="palette-detail">{item.detail}</span>}
              {item.keys && <Keys keys={item.keys} />}
            </div>
          ))}
          {items.length === 0 && (
            <div className="palette-empty">
              {mode === "files" && files.length === 0 ? "Open a workspace to search files" : "No matches"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
