import { CircleX, Files, Moon, PanelBottom, Search, SquareTerminal, Sun, TriangleAlert } from "lucide-react";
import { languageLabel } from "../lib/tree";
import type { Theme } from "../lib/types";
import type { WorkbenchActions } from "../state/useWorkbench";
import { activeTab, problemCounts, type WorkbenchState } from "../state/workbench";
import { IconButton } from "./ui";

interface StatusBarProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
  theme: Theme;
  onToggleTheme: () => void;
  onShowSearch: () => void;
  onShowTerminal: () => void;
}

export function StatusBar({ state, actions, theme, onToggleTheme, onShowSearch, onShowTerminal }: StatusBarProps) {
  const { dispatch } = actions;
  const { sidebar, panel } = state;
  const tab = activeTab(state);
  const fileTab = tab?.kind === "file" ? tab : null;
  const buffer = fileTab ? state.buffers[fileTab.path] : undefined;
  const language = fileTab ? state.files[fileTab.path]?.language : undefined;
  const editing = buffer?.status === "ready";
  const counts = problemCounts(state.problems);

  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <IconButton
          label="Explorer (Ctrl+Shift+E)"
          active={sidebar.visible && sidebar.view === "explorer"}
          onClick={() => dispatch({ type: "showSidebarView", view: "explorer" })}
        >
          <Files size={14} />
        </IconButton>
        <IconButton
          label="Search (Ctrl+Shift+F)"
          active={sidebar.visible && sidebar.view === "search"}
          onClick={onShowSearch}
        >
          <Search size={14} />
        </IconButton>
        <span className="statusbar-divider" />
        <button
          type="button"
          className="statusbar-item"
          title="Problems (Ctrl+Shift+M)"
          onClick={() => dispatch({ type: "showPanelView", view: "problems" })}
        >
          <CircleX size={13} />
          {counts.errors}
          <TriangleAlert size={13} />
          {counts.warnings}
        </button>
      </div>

      <div className="statusbar-group">
        {editing && (
          <>
            <span className="statusbar-item is-static">
              Ln {state.cursor.line}, Col {state.cursor.column}
            </span>
            <span className="statusbar-item is-static">Spaces: 2</span>
            <span className="statusbar-item is-static">UTF-8</span>
            <span className="statusbar-item is-static">{language ? languageLabel[language] : "Plain Text"}</span>
            <span className="statusbar-divider" />
          </>
        )}
        <IconButton label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </IconButton>
        <IconButton
          label="Terminal (Ctrl+`)"
          active={panel.visible && panel.view === "terminal"}
          onClick={onShowTerminal}
        >
          <SquareTerminal size={14} />
        </IconButton>
        <IconButton
          label="Toggle panel (Ctrl+J)"
          active={panel.visible}
          onClick={() => dispatch({ type: "togglePanel" })}
        >
          <PanelBottom size={14} />
        </IconButton>
      </div>
    </footer>
  );
}
