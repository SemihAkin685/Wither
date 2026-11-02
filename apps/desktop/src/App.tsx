import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BottomPanel } from "./components/BottomPanel";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorArea } from "./components/EditorArea";
import { GameRunningDialog } from "./components/GameTestView";
import { ResizeHandle } from "./components/ResizeHandle";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { api } from "./lib/api";
import { commandForEvent, isTerminalPassthrough, type Command } from "./lib/commands";
import { commandEntry, editEntry, type Menu } from "./lib/menus";
import { previewKind } from "./lib/preview";
import { flattenFiles } from "./lib/tree";
import type { AppInfo, SearchMatch, Theme } from "./lib/types";
import { useGameTest } from "./state/useGameTest";
import { useGit } from "./state/useGit";
import { useSettings } from "./state/useSettings";
import { useWorkbench } from "./state/useWorkbench";
import { activeTab, gameTab, PANEL_HEIGHT, settingsTab, welcomeTab } from "./state/workbench";

const MIN_EDITOR_HEIGHT = 140;

export function App() {
  const { state, actions, pendingCloseTitle } = useWorkbench();
  const { dispatch, log } = actions;
  const onSettingsError = useCallback((message: string) => log(message, "error"), [log]);
  const { settings, update: updateSettings, reload: reloadSettings } = useSettings(onSettingsError);
  const showOutput = useCallback(() => dispatch({ type: "showPanelView", view: "output" }), [dispatch]);
  const game = useGameTest({
    lastTarget: settings.lastTestTarget,
    saveAll: actions.saveAll,
    log,
    showOutput,
    onSettingsChanged: reloadSettings,
  });
  const { repo, actions: git } = useGit(state.workspace?.root ?? null, log);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [terminalFocusToken, setTerminalFocusToken] = useState(0);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .appInfo()
      .then((info) => {
        setAppInfo(info);
        log(`${info.name} ${info.version} started`);
      })
      .catch(() => {});
  }, [log]);

  const tab = activeTab(state);
  useEffect(() => {
    const parts = [tab?.kind === "file" ? tab.title : null, state.workspace?.name, "Wither"];
    const title = parts.filter(Boolean).join(" · ");
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [tab, state.workspace?.name]);

  const setTheme = useCallback((theme: Theme) => updateSettings({ theme }), [updateSettings]);
  const toggleTheme = useCallback(
    () => setTheme(settings.theme === "dark" ? "light" : "dark"),
    [setTheme, settings.theme],
  );

  const showSearch = useCallback(() => {
    if (!(state.sidebar.visible && state.sidebar.view === "search")) {
      dispatch({ type: "showSidebarView", view: "search" });
    }
    setSearchFocusToken((n) => n + 1);
  }, [dispatch, state.sidebar.visible, state.sidebar.view]);

  const showTerminal = useCallback(() => {
    if (state.panel.visible && state.panel.view === "terminal") {
      dispatch({ type: "togglePanel" });
      return;
    }
    dispatch({ type: "showPanelView", view: "terminal" });
    setTerminalFocusToken((n) => n + 1);
  }, [dispatch, state.panel.visible, state.panel.view]);

  const openMatch = useCallback(
    (match: SearchMatch) => actions.openFile(match.path, match.line, match.column),
    [actions],
  );

  const zoomEditor = useCallback(
    (delta: number | null) =>
      updateSettings({ editorFontSize: delta === null ? 14 : settings.editorFontSize + delta }),
    [updateSettings, settings.editorFontSize],
  );

  const activeFile = tab?.kind === "file" ? tab.path : null;
  const openGameTab = useCallback(() => dispatch({ type: "openTab", tab: gameTab }), [dispatch]);
  // first run has no target yet, so it opens the view to pick one
  const testInGame = useCallback(() => {
    if (!game.runLast()) openGameTab();
  }, [game, openGameTab]);
  const commands = useMemo<Command[]>(() => {
    const activeId = state.activeTabId;
    return [
      { id: "palette.commands", category: "View", title: "Show All Commands", keys: "Ctrl+Shift+P / F1", run: () => dispatch({ type: "openPalette", mode: "commands" }) },
      { id: "palette.files", category: "File", title: "Go to File", keys: "Ctrl+P", run: () => dispatch({ type: "openPalette", mode: "files" }) },
      { id: "workspace.open", category: "Workspace", title: "Open Workspace", keys: "Ctrl+O", run: actions.openWorkspace },
      { id: "workspace.close", category: "Workspace", title: "Close Workspace", run: actions.closeWorkspace },
      { id: "addon.import", category: "Addon", title: "Import Addon or Pack", run: () => void actions.importArchive() },
      { id: "addon.export", category: "Addon", title: "Export as .mcaddon", run: () => void game.exportAddon() },
      { id: "addon.exportPack", category: "Addon", title: "Export Pack as .mcpack", run: openGameTab },
      { id: "game.open", category: "Addon", title: "Choose Where to Test", run: openGameTab },
      { id: "game.run", category: "Addon", title: "Test in Game", keys: "Ctrl+F5", run: testInGame },
      { id: "file.save", category: "File", title: "Save", keys: "Ctrl+S", run: () => void actions.save() },
      { id: "file.saveAll", category: "File", title: "Save All", keys: "Ctrl+Alt+S", run: () => void actions.saveAll() },
      { id: "editor.close", category: "Editor", title: "Close Tab", keys: "Ctrl+W", run: () => activeId && actions.requestCloseTab(activeId) },
      { id: "editor.closeOthers", category: "Editor", title: "Close Other Tabs", run: () => activeId && dispatch({ type: "closeOtherTabs", id: activeId }) },
      { id: "editor.closeAll", category: "Editor", title: "Close All Tabs", run: () => dispatch({ type: "closeAllTabs" }) },
      { id: "editor.next", category: "Editor", title: "Next Tab", keys: "Ctrl+Tab / Ctrl+PageDown", run: () => dispatch({ type: "cycleTab", delta: 1 }) },
      { id: "editor.prev", category: "Editor", title: "Previous Tab", keys: "Ctrl+Shift+Tab / Ctrl+PageUp", run: () => dispatch({ type: "cycleTab", delta: -1 }) },
      { id: "editor.zoomIn", category: "Editor", title: "Increase Font Size", keys: "Ctrl+=", run: () => zoomEditor(1) },
      { id: "editor.zoomOut", category: "Editor", title: "Decrease Font Size", keys: "Ctrl+-", run: () => zoomEditor(-1) },
      { id: "editor.zoomReset", category: "Editor", title: "Reset Font Size", keys: "Ctrl+0", run: () => zoomEditor(null) },
      { id: "view.sidebar", category: "View", title: "Toggle Sidebar", keys: "Ctrl+B", run: () => dispatch({ type: "toggleSidebar" }) },
      { id: "view.explorer", category: "View", title: "Show Explorer", keys: "Ctrl+Shift+E", run: () => dispatch({ type: "showSidebarView", view: "explorer" }) },
      { id: "view.search", category: "View", title: "Search in Workspace", keys: "Ctrl+Shift+F", run: showSearch },
      { id: "view.panel", category: "View", title: "Toggle Bottom Panel", keys: "Ctrl+J", run: () => dispatch({ type: "togglePanel" }) },
      { id: "view.terminal", category: "View", title: "Toggle Terminal", keys: "Ctrl+`", run: showTerminal },
      { id: "view.problems", category: "View", title: "Show Problems", keys: "Ctrl+Shift+M", run: () => dispatch({ type: "showPanelView", view: "problems" }) },
      { id: "view.output", category: "View", title: "Show Output", keys: "Ctrl+Shift+U", run: () => dispatch({ type: "showPanelView", view: "output" }) },
      { id: "jsonui.preview", category: "Editor", title: "Toggle Preview", keys: "Ctrl+Shift+V", run: () => activeFile && previewKind(activeFile) && dispatch({ type: "togglePreview", path: activeFile }) },
      { id: "theme.toggle", category: "Theme", title: "Toggle Light/Dark", run: toggleTheme },
      { id: "theme.dark", category: "Theme", title: "Dark", run: () => setTheme("dark") },
      { id: "theme.light", category: "Theme", title: "Light", run: () => setTheme("light") },
      { id: "settings.open", category: "Preferences", title: "Open Settings", keys: "Ctrl+,", run: () => dispatch({ type: "openTab", tab: settingsTab }) },
      { id: "help.welcome", category: "Help", title: "Welcome", run: () => dispatch({ type: "openTab", tab: welcomeTab }) },
      { id: "window.close", category: "Window", title: "Quit Wither", keys: "Ctrl+Q", run: () => void getCurrentWindow().close() },
    ];
  }, [actions, dispatch, state.activeTabId, activeFile, showSearch, showTerminal, toggleTheme, setTheme, zoomEditor, game, openGameTab, testInGame]);

  const menus = useMemo<Menu[]>(() => {
    const entry = (id: string, title?: string) => commandEntry(commands, id, title);
    return [
      {
        id: "file",
        title: "File",
        entries: [
          entry("workspace.open", "Open Workspace..."),
          { ...entry("workspace.close"), disabled: !state.workspace },
          "separator",
          entry("addon.import", "Import Addon or Pack..."),
          { ...entry("addon.export", "Export as .mcaddon..."), disabled: !state.workspace },
          { ...entry("addon.exportPack", "Export Pack as .mcpack..."), disabled: !state.workspace },
          "separator",
          entry("palette.files", "Go to File..."),
          "separator",
          entry("file.save"),
          entry("file.saveAll"),
          "separator",
          entry("settings.open", "Settings..."),
          "separator",
          entry("window.close", "Exit"),
        ],
      },
      {
        id: "edit",
        title: "Edit",
        entries: [
          editEntry("undo", "Undo", "Ctrl+Z"),
          editEntry("redo", "Redo", "Ctrl+Shift+Z"),
          "separator",
          editEntry("cut", "Cut", "Ctrl+X"),
          editEntry("copy", "Copy", "Ctrl+C"),
          editEntry("paste", "Paste", "Ctrl+V"),
          editEntry("selectAll", "Select All", "Ctrl+A"),
          "separator",
          entry("view.search", "Find in Workspace..."),
        ],
      },
      {
        id: "view",
        title: "View",
        entries: [
          entry("palette.commands", "Command Palette..."),
          "separator",
          entry("view.sidebar"),
          entry("view.explorer", "Explorer"),
          entry("view.search", "Search"),
          "separator",
          entry("view.panel"),
          entry("view.terminal", "Terminal"),
          entry("view.problems", "Problems"),
          entry("view.output", "Output"),
          "separator",
          entry("editor.zoomIn", "Zoom In"),
          entry("editor.zoomOut", "Zoom Out"),
          entry("editor.zoomReset", "Reset Zoom"),
          "separator",
          entry("theme.toggle", "Toggle Light/Dark Theme"),
        ],
      },
      {
        id: "go",
        title: "Go",
        entries: [entry("palette.files", "Go to File..."), "separator", entry("editor.next"), entry("editor.prev")],
      },
      {
        id: "run",
        title: "Run",
        entries: [
          { ...entry("game.run"), disabled: !state.workspace || game.busy },
          entry("game.open", "Choose Where to Test..."),
        ],
      },
      {
        id: "git",
        title: "Git",
        entries: state.workspace
          ? repo
            ? [{ id: "git.refresh", title: "Refresh Branches", run: git.refresh }]
            : [{ id: "git.init", title: "Create Git Repository...", disabled: repo === undefined, run: git.init }]
          : [{ id: "git.none", title: "Open a workspace first", disabled: true, run: () => {} }],
      },
      {
        id: "window",
        title: "Window",
        entries: [entry("editor.close"), entry("editor.closeOthers"), entry("editor.closeAll")],
      },
      { id: "help", title: "Help", entries: [entry("help.welcome"), entry("palette.commands", "Find Action...")] },
    ];
  }, [commands, state.workspace, repo, git, game.busy]);

  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const blocked = state.palette !== null || pendingCloseTitle !== null || game.pending !== null;

  useEffect(() => {
    if (blocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const inTerminal = event.target instanceof Element && event.target.closest(".terminal-host");
      if (inTerminal && !isTerminalPassthrough(event)) return;
      const command = commandForEvent(commandsRef.current, event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      command.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked]);

  const files = useMemo(() => (state.workspace ? flattenFiles(state.workspace.tree) : []), [state.workspace]);

  const resizePanel = useCallback(
    (height: number) => {
      const max = (centerRef.current?.clientHeight ?? 600) - MIN_EDITOR_HEIGHT;
      dispatch({ type: "resizePanel", height: Math.min(height, Math.max(PANEL_HEIGHT.min, max)) });
    },
    [dispatch],
  );

  return (
    <div className="workbench">
      <TitleBar
        projectName={state.workspace?.name ?? null}
        repo={repo}
        git={git}
        menus={menus}
        onOpenWorkspace={actions.openWorkspace}
        onPaletteClick={() => dispatch({ type: "openPalette", mode: "commands" })}
        onSettingsClick={() => dispatch({ type: "openTab", tab: settingsTab })}
      />

      <div className="workbench-main">
        {state.sidebar.visible && (
          <>
            <Sidebar state={state} actions={actions} searchFocusToken={searchFocusToken} onOpenMatch={openMatch} />
            <ResizeHandle
              axis="x"
              getSize={() => state.sidebar.width}
              onResize={(width) => dispatch({ type: "resizeSidebar", width })}
              onDoubleClick={() => dispatch({ type: "resizeSidebar", width: 260 })}
            />
          </>
        )}
        <div className="workbench-center" ref={centerRef}>
          <EditorArea
            state={state}
            actions={actions}
            settings={settings}
            appInfo={appInfo}
            onSettingsChange={updateSettings}
            onOpenPalette={() => dispatch({ type: "openPalette", mode: "commands" })}
            onOpenSettings={() => dispatch({ type: "openTab", tab: settingsTab })}
            game={game}
          />
          {state.panel.visible && (
            <ResizeHandle axis="y" invert getSize={() => state.panel.height} onResize={resizePanel} />
          )}
          <BottomPanel
            state={state}
            actions={actions}
            settings={settings}
            terminalFocusToken={terminalFocusToken}
          />
        </div>
      </div>

      <StatusBar
        state={state}
        actions={actions}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
        onShowSearch={showSearch}
        onShowTerminal={showTerminal}
        testing={game.busy}
        onTestInGame={testInGame}
      />

      {state.palette && (
        <CommandPalette
          mode={state.palette}
          commands={commands}
          files={files}
          onOpenFile={actions.openFile}
          onClose={() => dispatch({ type: "closePalette" })}
        />
      )}
      {pendingCloseTitle !== null && <ConfirmDialog fileName={pendingCloseTitle} onChoose={actions.confirmClose} />}
      {game.pending && <GameRunningDialog onChoose={game.confirm} />}
    </div>
  );
}
