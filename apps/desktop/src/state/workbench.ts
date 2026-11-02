import type { FileNode, Problem, Workspace } from "../lib/types";
import { fileName, flattenFiles, parentDirs } from "../lib/tree";

export type SidebarView = "explorer" | "search";
export type PanelView = "problems" | "output" | "terminal";
export type PaletteMode = "commands" | "files";

export type Tab =
  | { id: "welcome"; kind: "welcome"; title: string }
  | { id: "settings"; kind: "settings"; title: string }
  | { id: string; kind: "file"; title: string; path: string };

export interface Buffer {
  content: string;
  saved: string;
  status: "loading" | "ready" | "error";
  error?: string;
}

export interface OutputLine {
  id: number;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface WorkbenchState {
  workspace: Workspace | null;
  files: Record<string, FileNode>;
  tabs: Tab[];
  activeTabId: string | null;
  buffers: Record<string, Buffer>;
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  sidebar: { visible: boolean; width: number; view: SidebarView };
  panel: { visible: boolean; height: number; view: PanelView };
  cursor: { line: number; column: number };
  palette: PaletteMode | null;
  output: OutputLine[];
  reveal: { path: string; line: number; column: number; seq: number } | null;
  /** Files showing the JSON UI preview next to the editor. */
  previews: Record<string, boolean>;
  /** Latest check of the workspace, unsaved edits included. */
  problems: Problem[];
}

export const SIDEBAR_WIDTH = { min: 180, max: 520, initial: 260 };
export const PANEL_HEIGHT = { min: 120, initial: 220 };
const MAX_OUTPUT_LINES = 500;

export const welcomeTab: Tab = { id: "welcome", kind: "welcome", title: "Welcome" };
export const settingsTab: Tab = { id: "settings", kind: "settings", title: "Settings" };

export const fileTabId = (path: string) => `file:${path}`;

export const initialState: WorkbenchState = {
  workspace: null,
  files: {},
  tabs: [welcomeTab],
  activeTabId: welcomeTab.id,
  buffers: {},
  expanded: {},
  selectedPath: null,
  sidebar: { visible: true, width: SIDEBAR_WIDTH.initial, view: "explorer" },
  panel: { visible: false, height: PANEL_HEIGHT.initial, view: "output" },
  cursor: { line: 1, column: 1 },
  palette: null,
  output: [],
  reveal: null,
  previews: {},
  problems: [],
};

export type Action =
  | { type: "workspaceOpened"; workspace: Workspace }
  | { type: "workspaceClosed" }
  | { type: "openTab"; tab: Tab }
  | { type: "openFile"; path: string; line?: number; column?: number }
  | { type: "closeTab"; id: string }
  | { type: "closeOtherTabs"; id: string }
  | { type: "closeAllTabs" }
  | { type: "activateTab"; id: string }
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "moveTab"; from: number; to: number }
  | { type: "bufferLoaded"; path: string; content: string }
  | { type: "bufferFailed"; path: string; error: string }
  | { type: "edit"; path: string; content: string }
  | { type: "saved"; path: string; content: string }
  | { type: "toggleDir"; path: string }
  | { type: "collapseAll" }
  | { type: "select"; path: string | null }
  | { type: "toggleSidebar" }
  | { type: "showSidebarView"; view: SidebarView }
  | { type: "resizeSidebar"; width: number }
  | { type: "togglePanel" }
  | { type: "showPanelView"; view: PanelView }
  | { type: "resizePanel"; height: number }
  | { type: "setCursor"; line: number; column: number }
  | { type: "togglePreview"; path: string }
  | { type: "openPalette"; mode: PaletteMode }
  | { type: "closePalette" }
  | { type: "problemsChecked"; problems: Problem[] }
  | { type: "log"; line: OutputLine }
  | { type: "clearOutput" };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function indexFiles(workspace: Workspace): Record<string, FileNode> {
  return Object.fromEntries(flattenFiles(workspace.tree).map((node) => [node.path, node]));
}

function withTab(state: WorkbenchState, tab: Tab): WorkbenchState {
  const exists = state.tabs.some((t) => t.id === tab.id);
  if (exists) return { ...state, activeTabId: tab.id };
  const activeIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const tabs = [...state.tabs];
  tabs.splice(activeIndex + 1, 0, tab);
  return { ...state, tabs, activeTabId: tab.id };
}

function withoutTabs(state: WorkbenchState, keep: (tab: Tab) => boolean): WorkbenchState {
  const tabs = state.tabs.filter(keep);
  let activeTabId = state.activeTabId;
  if (!tabs.some((t) => t.id === activeTabId)) {
    const oldIndex = state.tabs.findIndex((t) => t.id === activeTabId);
    activeTabId = tabs[Math.min(oldIndex, tabs.length - 1)]?.id ?? null;
  }
  const openPaths = new Set(tabs.flatMap((t) => (t.kind === "file" ? [t.path] : [])));
  const buffers = Object.fromEntries(
    Object.entries(state.buffers).filter(([path]) => openPaths.has(path)),
  );
  return { ...state, tabs, activeTabId, buffers };
}

export function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case "workspaceOpened": {
      const expanded = Object.fromEntries(
        action.workspace.tree.filter((n) => n.kind === "directory").map((n) => [n.path, true]),
      );
      // the welcome tab is the project picker, once a project is open it has done its job
      return {
        ...withoutTabs(state, (t) => t.kind === "settings"),
        workspace: action.workspace,
        files: indexFiles(action.workspace),
        expanded,
        selectedPath: null,
        buffers: {},
        problems: [],
        sidebar: { ...state.sidebar, visible: true, view: "explorer" },
      };
    }
    case "workspaceClosed":
      return {
        ...withoutTabs(state, (t) => t.kind !== "file"),
        workspace: null,
        files: {},
        expanded: {},
        selectedPath: null,
        previews: {},
        problems: [],
      };
    case "openTab":
      return withTab(state, action.tab);
    case "openFile": {
      const { path } = action;
      const expanded = { ...state.expanded };
      for (const dir of parentDirs(path)) expanded[dir] = true;
      const reveal = action.line
        ? { path, line: action.line, column: action.column ?? 1, seq: (state.reveal?.seq ?? 0) + 1 }
        : state.reveal;
      const next = withTab(
        { ...state, expanded, selectedPath: path, reveal },
        { id: fileTabId(path), kind: "file", title: fileName(path), path },
      );
      if (next.buffers[path]) return next;
      return {
        ...next,
        buffers: { ...next.buffers, [path]: { content: "", saved: "", status: "loading" } },
      };
    }
    case "closeTab":
      return withoutTabs(state, (t) => t.id !== action.id);
    case "closeOtherTabs":
      return withoutTabs(state, (t) => t.id === action.id);
    case "closeAllTabs":
      return withoutTabs(state, () => false);
    case "activateTab": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab) return state;
      return {
        ...state,
        activeTabId: tab.id,
        selectedPath: tab.kind === "file" ? tab.path : state.selectedPath,
      };
    }
    case "cycleTab": {
      if (state.tabs.length < 2) return state;
      const index = state.tabs.findIndex((t) => t.id === state.activeTabId);
      const next = state.tabs[(index + action.delta + state.tabs.length) % state.tabs.length];
      return reducer(state, { type: "activateTab", id: next.id });
    }
    case "moveTab": {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(action.from, 1);
      if (!moved) return state;
      tabs.splice(clamp(action.to, 0, tabs.length), 0, moved);
      return { ...state, tabs };
    }
    case "bufferLoaded":
      if (!state.buffers[action.path]) return state;
      return {
        ...state,
        buffers: {
          ...state.buffers,
          [action.path]: { content: action.content, saved: action.content, status: "ready" },
        },
      };
    case "bufferFailed":
      if (!state.buffers[action.path]) return state;
      return {
        ...state,
        buffers: {
          ...state.buffers,
          [action.path]: { content: "", saved: "", status: "error", error: action.error },
        },
      };
    case "edit": {
      const buffer = state.buffers[action.path];
      if (!buffer || buffer.status !== "ready") return state;
      return {
        ...state,
        buffers: { ...state.buffers, [action.path]: { ...buffer, content: action.content } },
      };
    }
    case "saved": {
      const buffer = state.buffers[action.path];
      if (!buffer) return state;
      return {
        ...state,
        buffers: { ...state.buffers, [action.path]: { ...buffer, saved: action.content } },
      };
    }
    case "toggleDir":
      return {
        ...state,
        selectedPath: action.path,
        expanded: { ...state.expanded, [action.path]: !state.expanded[action.path] },
      };
    case "collapseAll":
      return { ...state, expanded: {} };
    case "select":
      return { ...state, selectedPath: action.path };
    case "toggleSidebar":
      return { ...state, sidebar: { ...state.sidebar, visible: !state.sidebar.visible } };
    case "showSidebarView": {
      const { sidebar } = state;
      const hide = sidebar.visible && sidebar.view === action.view;
      return { ...state, sidebar: { ...sidebar, view: action.view, visible: !hide } };
    }
    case "resizeSidebar":
      return {
        ...state,
        sidebar: {
          ...state.sidebar,
          width: clamp(action.width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
        },
      };
    case "togglePanel":
      return { ...state, panel: { ...state.panel, visible: !state.panel.visible } };
    case "showPanelView":
      return { ...state, panel: { ...state.panel, view: action.view, visible: true } };
    case "resizePanel":
      return { ...state, panel: { ...state.panel, height: Math.max(PANEL_HEIGHT.min, action.height) } };
    case "setCursor":
      if (state.cursor.line === action.line && state.cursor.column === action.column) return state;
      return { ...state, cursor: { line: action.line, column: action.column } };
    case "togglePreview":
      return { ...state, previews: { ...state.previews, [action.path]: !state.previews[action.path] } };
    case "openPalette":
      return { ...state, palette: action.mode };
    case "closePalette":
      return { ...state, palette: null };
    case "problemsChecked":
      return { ...state, problems: action.problems };
    case "log":
      return { ...state, output: [...state.output, action.line].slice(-MAX_OUTPUT_LINES) };
    case "clearOutput":
      return { ...state, output: [] };
  }
}

export function activeTab(state: WorkbenchState): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

export function problemCounts(problems: Problem[]) {
  let errors = 0;
  let warnings = 0;
  for (const problem of problems) {
    if (problem.severity === "error") errors++;
    else if (problem.severity === "warning") warnings++;
  }
  return { errors, warnings };
}

export function isDirty(state: WorkbenchState, path: string): boolean {
  const buffer = state.buffers[path];
  return !!buffer && buffer.status === "ready" && buffer.content !== buffer.saved;
}
