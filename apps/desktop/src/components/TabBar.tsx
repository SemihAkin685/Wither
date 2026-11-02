import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { Gamepad2, House, Settings, X } from "lucide-react";
import type { FileNode } from "../lib/types";
import type { Tab } from "../state/workbench";
import { FileIcon } from "./FileIcon";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  files: Record<string, FileNode>;
  isDirty: (tab: Tab) => boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (from: number, to: number) => void;
}

function TabIcon({ tab, files }: { tab: Tab; files: Record<string, FileNode> }) {
  if (tab.kind === "welcome") return <House size={14} className="file-icon tone-accent" strokeWidth={1.75} />;
  if (tab.kind === "settings") return <Settings size={14} className="file-icon" strokeWidth={1.75} />;
  if (tab.kind === "game") return <Gamepad2 size={14} className="file-icon" strokeWidth={1.75} />;
  return <FileIcon language={files[tab.path]?.language} size={14} />;
}

export function TabBar({ tabs, activeTabId, files, isDirty, onActivate, onClose, onMove }: TabBarProps) {
  const dragIndex = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const onMouseDown = (event: MouseEvent, id: string) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose(id);
    }
  };

  const onDragOver = (event: DragEvent, index: number) => {
    if (dragIndex.current === null) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientX < rect.left + rect.width / 2 ? index : index + 1);
  };

  const onDrop = () => {
    const from = dragIndex.current;
    if (from !== null && dropIndex !== null) onMove(from, dropIndex > from ? dropIndex - 1 : dropIndex);
    dragIndex.current = null;
    setDropIndex(null);
  };

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab, index) => {
        const active = tab.id === activeTabId;
        const dirty = isDirty(tab);
        const classes = [
          "tab",
          active && "is-active",
          dirty && "is-dirty",
          dropIndex === index && "drop-before",
          dropIndex === tabs.length && index === tabs.length - 1 && "drop-after",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={classes}
            title={tab.kind === "file" ? tab.path : tab.title}
            draggable
            onClick={() => onActivate(tab.id)}
            onMouseDown={(e) => onMouseDown(e, tab.id)}
            onDragStart={(e) => {
              dragIndex.current = index;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => onDragOver(e, index)}
            onDrop={onDrop}
            onDragEnd={() => {
              dragIndex.current = null;
              setDropIndex(null);
            }}
          >
            <TabIcon tab={tab} files={files} />
            <span className="tab-title">{tab.title}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <span className="tab-dirty-dot" />
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div
        className="tabbar-filler"
        onDragOver={(e) => {
          if (dragIndex.current === null) return;
          e.preventDefault();
          setDropIndex(tabs.length);
        }}
        onDrop={onDrop}
      />
    </div>
  );
}
