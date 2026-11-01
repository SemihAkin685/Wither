import { ChevronRight, CircleAlert, Loader } from "lucide-react";
import type { AppInfo, Settings, SettingsPatch } from "../lib/types";
import type { WorkbenchActions } from "../state/useWorkbench";
import { activeTab, isDirty, type WorkbenchState } from "../state/workbench";
import { CodeEditor } from "./CodeEditor";
import { FileIcon } from "./FileIcon";
import { Logo } from "./Logo";
import { SettingsView } from "./SettingsView";
import { TabBar } from "./TabBar";
import { WelcomeScreen } from "./WelcomeScreen";
import { Keys } from "./ui";

interface EditorAreaProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
  settings: Settings;
  appInfo: AppInfo | null;
  onSettingsChange: (patch: SettingsPatch) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

function Breadcrumbs({ path, workspaceName }: { path: string; workspaceName?: string }) {
  const parts = path.split("/");
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumbs">
      {workspaceName && (
        <>
          <span>{workspaceName}</span>
          <ChevronRight size={12} />
        </>
      )}
      {parts.map((part, i) => (
        <span key={i} className={i === parts.length - 1 ? "is-current" : ""}>
          {part}
          {i < parts.length - 1 && <ChevronRight size={12} />}
        </span>
      ))}
    </nav>
  );
}

function EmptyEditor() {
  return (
    <div className="editor-empty">
      <Logo size={64} className="editor-empty-logo" />
      <div className="editor-empty-hints">
        <span>Show all commands</span>
        <Keys keys="Ctrl+Shift+P" />
        <span>Open file</span>
        <Keys keys="Ctrl+P" />
        <span>Open workspace</span>
        <Keys keys="Ctrl+O" />
      </div>
    </div>
  );
}

export function EditorArea(props: EditorAreaProps) {
  const { state, actions, settings, appInfo, onSettingsChange, onOpenPalette, onOpenSettings } = props;
  const { dispatch } = actions;
  const tab = activeTab(state);

  const body = (() => {
    if (!tab) return <EmptyEditor />;
    if (tab.kind === "welcome") {
      return (
        <WelcomeScreen
          appInfo={appInfo}
          theme={settings.theme}
          workspaceName={state.workspace?.name ?? null}
          onOpenWorkspace={actions.openWorkspace}
          onOpenPalette={onOpenPalette}
          onOpenSettings={onOpenSettings}
          onToggleTheme={() => onSettingsChange({ theme: settings.theme === "dark" ? "light" : "dark" })}
        />
      );
    }
    if (tab.kind === "settings") {
      return <SettingsView settings={settings} appInfo={appInfo} onChange={onSettingsChange} />;
    }

    const buffer = state.buffers[tab.path];
    const node = state.files[tab.path];
    let content;
    if (!buffer || buffer.status === "loading") {
      content = (
        <div className="editor-placeholder">
          <Loader size={16} className="spin" />
          Loading {tab.title}
        </div>
      );
    } else if (buffer.status === "error") {
      content = (
        <div className="editor-placeholder">
          {node?.language === "image" ? <FileIcon language="image" size={28} /> : <CircleAlert size={20} />}
          <span>{buffer.error}</span>
        </div>
      );
    } else {
      content = (
        <CodeEditor
          key={tab.path}
          path={tab.path}
          content={buffer.content}
          language={node?.language ?? "plaintext"}
          fontSize={settings.editorFontSize}
          showLineNumbers={settings.showLineNumbers}
          reveal={state.reveal?.path === tab.path ? state.reveal : null}
          onChange={(text) => dispatch({ type: "edit", path: tab.path, content: text })}
          onCursor={(line, column) => dispatch({ type: "setCursor", line, column })}
        />
      );
    }
    return (
      <div className="editor-file">
        <Breadcrumbs path={tab.path} workspaceName={state.workspace?.name} />
        {content}
      </div>
    );
  })();

  return (
    <section className="editor-area">
      {state.tabs.length > 0 && (
        <TabBar
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          files={state.files}
          isDirty={(t) => t.kind === "file" && isDirty(state, t.path)}
          onActivate={(id) => dispatch({ type: "activateTab", id })}
          onClose={actions.requestCloseTab}
          onMove={(from, to) => dispatch({ type: "moveTab", from, to })}
        />
      )}
      <div className="editor-body">{body}</div>
    </section>
  );
}
