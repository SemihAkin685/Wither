import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Copy, Minus, Search, Settings, Square, X } from "lucide-react";
import { Logo } from "./Logo";
import { IconButton, Keys } from "./ui";

interface TitleBarProps {
  projectName: string | null;
  onProjectClick: () => void;
  onPaletteClick: () => void;
  onSettingsClick: () => void;
}

export function TitleBar({ projectName, onProjectClick, onPaletteClick, onSettingsClick }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const sync = () => win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    win.onResized(sync).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  const win = () => getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <Logo size={18} className="titlebar-logo" />
        <button type="button" className="titlebar-chip" onClick={onProjectClick}>
          <span className={projectName ? "" : "is-placeholder"}>{projectName ?? "Open a workspace"}</span>
          <ChevronDown size={13} />
        </button>
      </div>

      <button type="button" className="titlebar-search" onClick={onPaletteClick}>
        <Search size={13} />
        <span>Search commands</span>
        <Keys keys="Ctrl+Shift+P" />
      </button>

      <div className="titlebar-right" data-tauri-drag-region>
        <IconButton label="Settings" onClick={onSettingsClick}>
          <Settings size={15} />
        </IconButton>
        <div className="window-controls">
          <button type="button" aria-label="Minimize" onClick={() => win().minimize()}>
            <Minus size={15} />
          </button>
          <button
            type="button"
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => win().toggleMaximize()}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button type="button" aria-label="Close" className="is-close" onClick={() => win().close()}>
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
