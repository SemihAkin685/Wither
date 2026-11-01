import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fileName } from "../lib/tree";
import type { FileNode, SearchMatch } from "../lib/types";
import { FileIcon } from "./FileIcon";

interface SearchViewProps {
  hasWorkspace: boolean;
  files: Record<string, FileNode>;
  focusToken: number;
  onOpenMatch: (match: SearchMatch) => void;
}

const DEBOUNCE_MS = 140;

export function SearchView({ hasWorkspace, files, focusToken, onOpenMatch }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  useEffect(() => {
    if (!hasWorkspace || !query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchWorkspace(query)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setError(null);
        })
        .catch((err) => !cancelled && setError(errorMessage(err)));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, hasWorkspace]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const match of results) {
      const list = map.get(match.path) ?? [];
      list.push(match);
      map.set(match.path, list);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <div className="search-view">
      <div className="search-input-wrap">
        <input
          ref={inputRef}
          className="text-input"
          placeholder={hasWorkspace ? "Search workspace" : "Open a workspace to search"}
          disabled={!hasWorkspace}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
      </div>
      {error && <p className="sidebar-message is-error">{error}</p>}
      {query.trim() && !error && (
        <p className="sidebar-message">
          {results.length === 0
            ? "No results"
            : `${results.length} result${results.length === 1 ? "" : "s"} in ${grouped.length} file${grouped.length === 1 ? "" : "s"}`}
        </p>
      )}
      <div className="search-results">
        {grouped.map(([path, matches]) => {
          const isCollapsed = collapsed[path];
          return (
            <div key={path} className="search-group">
              <div
                className="tree-row search-file"
                onClick={() => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}
              >
                <span className="tree-chevron">
                  <ChevronRight size={13} className={isCollapsed ? "" : "is-open"} />
                </span>
                <FileIcon language={files[path]?.language} />
                <span className="tree-label">{fileName(path)}</span>
                <span className="search-file-dir">{path.slice(0, path.lastIndexOf("/"))}</span>
                <span className="count-badge">{matches.length}</span>
              </div>
              {!isCollapsed &&
                matches.map((m) => (
                  <div
                    key={`${m.line}:${m.column}`}
                    className="tree-row search-match"
                    onClick={() => onOpenMatch(m)}
                    title={`${path}:${m.line}:${m.column}`}
                  >
                    <span className="search-line">{m.line}</span>
                    <span className="search-preview">
                      {m.preview.slice(0, m.matchStart)}
                      <mark>{m.preview.slice(m.matchStart, m.matchStart + m.matchLen)}</mark>
                      {m.preview.slice(m.matchStart + m.matchLen)}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
