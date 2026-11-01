import { useMemo, useRef, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { FileNode } from "../lib/types";
import { FileIcon } from "./FileIcon";

interface Row {
  node: FileNode;
  depth: number;
  parent: string | null;
}

interface FileTreeProps {
  nodes: FileNode[];
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
}

function visibleRows(nodes: FileNode[], expanded: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  const walk = (list: FileNode[], depth: number, parent: string | null) => {
    for (const node of list) {
      rows.push({ node, depth, parent });
      if (node.kind === "directory" && expanded[node.path] && node.children) {
        walk(node.children, depth + 1, node.path);
      }
    }
  };
  walk(nodes, 0, null);
  return rows;
}

export function FileTree(props: FileTreeProps) {
  const { nodes, expanded, selectedPath, activePath, dirtyPaths, onToggle, onOpen, onSelect } = props;
  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const listRef = useRef<HTMLDivElement>(null);

  const activate = (node: FileNode) => (node.kind === "directory" ? onToggle(node.path) : onOpen(node.path));

  const focusRow = (path: string) => {
    onSelect(path);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex((r) => r.node.path === selectedPath);
    const row = rows[index];
    switch (event.key) {
      case "ArrowDown":
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.node.path ?? rows[0].node.path);
        break;
      case "ArrowUp":
        focusRow(rows[Math.max(0, index - 1)]?.node.path ?? rows[0].node.path);
        break;
      case "ArrowRight":
        if (row?.node.kind === "directory") {
          if (!expanded[row.node.path]) onToggle(row.node.path);
          else if (rows[index + 1]?.parent === row.node.path) focusRow(rows[index + 1].node.path);
        }
        break;
      case "ArrowLeft":
        if (row?.node.kind === "directory" && expanded[row.node.path]) onToggle(row.node.path);
        else if (row?.parent) focusRow(row.parent);
        break;
      case "Enter":
      case " ":
        if (row) activate(row.node);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      ref={listRef}
      className="file-tree"
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Files"
    >
      {rows.map(({ node, depth }) => {
        const isDir = node.kind === "directory";
        const isOpen = isDir && !!expanded[node.path];
        const classes = [
          "tree-row",
          node.path === selectedPath && "is-selected",
          node.path === activePath && "is-active",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={node.path}
            data-path={node.path}
            role="treeitem"
            aria-expanded={isDir ? isOpen : undefined}
            aria-selected={node.path === selectedPath}
            className={classes}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => activate(node)}
          >
            {Array.from({ length: depth }, (_, i) => (
              <span key={i} className="indent-guide" style={{ left: 15 + i * 14 }} />
            ))}
            <span className="tree-chevron">
              {isDir && <ChevronRight size={13} className={isOpen ? "is-open" : ""} />}
            </span>
            <FileIcon language={node.language} directory={isDir} open={isOpen} />
            <span className="tree-label">{node.name}</span>
            {dirtyPaths.has(node.path) && <span className="dirty-dot" aria-label="Unsaved" />}
          </div>
        );
      })}
    </div>
  );
}
