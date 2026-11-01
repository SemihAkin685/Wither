import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Copy, GitBranch, Minus, Search, Settings, Square, X } from "lucide-react";
import type { Menu } from "../lib/menus";
import type { GitRepo } from "../lib/types";
import type { GitActions } from "../state/useGit";
import { GitPopup } from "./GitPopup";
import { Logo } from "./Logo";
import { MenuBar } from "./MenuBar";
import { IconButton, Keys } from "./ui";

interface TitleBarProps {
  projectName: string | null;
  repo: GitRepo | null | undefined;
  git: GitActions;
  menus: Menu[];
  onOpenWorkspace: () => void;
  onPaletteClick: () => void;
  onSettingsClick: () => void;
}

type Popup = "menu" | "git" | null;

export function TitleBar(props: TitleBarProps) {
  const { projectName, repo, git, menus, onOpenWorkspace, onPaletteClick, onSettingsClick } = props;
  const [maximized, setMaximized] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const closePopup = useCallback(() => setPopup(null), []);

  useEffect(() => {
    if (!popup) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!leftRef.current?.contains(event.target as Node)) setPopup(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && popup === "git") {
        event.stopPropagation();
        setPopup(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [popup]);

  // the workspace can go away while the git popup is open
  useEffect(() => {
    if (!projectName) setPopup((p) => (p === "git" ? null : p));
  }, [projectName]);

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
      <div className="titlebar-left" ref={leftRef} data-tauri-drag-region>
        <button
          type="button"
          className={`titlebar-logo${popup === "menu" ? " is-active" : ""}`}
          aria-label="Main menu"
          title="Main menu"
          aria-expanded={popup === "menu"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPopup(popup === "menu" ? null : "menu")}
        >
          <Logo size={18} />
        </button>
        {popup === "menu" ? (
          <MenuBar menus={menus} onClose={closePopup} />
        ) : (
          <div className="titlebar-anchor">
            <button
              type="button"
              className={`titlebar-chip${popup === "git" ? " is-active" : ""}`}
              aria-expanded={popup === "git"}
              onClick={() => (projectName ? setPopup(popup === "git" ? null : "git") : onOpenWorkspace())}
            >
              <span className={projectName ? "" : "is-placeholder"}>{projectName ?? "Open a workspace"}</span>
              {repo && (
                <span className="titlebar-branch" title={repo.detached ? "Detached HEAD" : `Branch ${repo.head}`}>
                  <GitBranch size={13} />
                  {repo.head}
                </span>
              )}
              <ChevronDown size={13} />
            </button>
            {popup === "git" && <GitPopup repo={repo} actions={git} onClose={closePopup} />}
          </div>
        )}
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
