import { ChevronsDownUp, FolderOpen, X } from "lucide-react";
import type { SearchMatch } from "../lib/types";
import type { WorkbenchActions } from "../state/useWorkbench";
import { activeTab, isDirty, type WorkbenchState } from "../state/workbench";
import { FileTree } from "./FileTree";
import { SearchView } from "./SearchView";
import { IconButton, Keys } from "./ui";

interface SidebarProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
  searchFocusToken: number;
  onOpenMatch: (match: SearchMatch) => void;
}

export function Sidebar({ state, actions, searchFocusToken, onOpenMatch }: SidebarProps) {
  const { workspace, sidebar } = state;
  const { dispatch } = actions;
  const tab = activeTab(state);
  const dirtyPaths = new Set(Object.keys(state.buffers).filter((p) => isDirty(state, p)));

  return (
    <aside className="sidebar" style={{ width: sidebar.width }}>
      <div className="sidebar-header">
        <span className="sidebar-title">{sidebar.view === "explorer" ? "Explorer" : "Search"}</span>
        <div className="sidebar-actions">
          {sidebar.view === "explorer" && workspace && (
            <IconButton label="Collapse folders" onClick={() => dispatch({ type: "collapseAll" })}>
              <ChevronsDownUp size={14} />
            </IconButton>
          )}
          <IconButton label="Close sidebar (Ctrl+B)" onClick={() => dispatch({ type: "toggleSidebar" })}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {sidebar.view === "explorer" &&
        (workspace ? (
          <>
            <div className="sidebar-section-title" title={workspace.root}>
              {workspace.name}
            </div>
            <FileTree
              nodes={workspace.tree}
              expanded={state.expanded}
              selectedPath={state.selectedPath}
              activePath={tab?.kind === "file" ? tab.path : null}
              dirtyPaths={dirtyPaths}
              onToggle={(path) => dispatch({ type: "toggleDir", path })}
              onOpen={actions.openFile}
              onSelect={(path) => dispatch({ type: "select", path })}
            />
          </>
        ) : (
          <div className="sidebar-empty">
            <p>No workspace is open.</p>
            <button type="button" className="button is-primary" onClick={actions.openWorkspace}>
              <FolderOpen size={14} />
              Open Workspace
            </button>
            <Keys keys="Ctrl+O" />
          </div>
        ))}

      {sidebar.view === "search" && (
        <SearchView
          hasWorkspace={!!workspace}
          files={state.files}
          focusToken={searchFocusToken}
          onOpenMatch={onOpenMatch}
        />
      )}
    </aside>
  );
}
