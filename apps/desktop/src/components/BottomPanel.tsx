import { CircleCheck, Trash2, X } from "lucide-react";
import type { Settings } from "../lib/types";
import type { WorkbenchActions } from "../state/useWorkbench";
import type { PanelView, WorkbenchState } from "../state/workbench";
import { Terminal } from "./Terminal";
import { IconButton } from "./ui";

interface BottomPanelProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
  settings: Settings;
  terminalFocusToken: number;
}

const views: { id: PanelView; label: string }[] = [
  { id: "problems", label: "Problems" },
  { id: "output", label: "Output" },
  { id: "terminal", label: "Terminal" },
];

export function BottomPanel({ state, actions, settings, terminalFocusToken }: BottomPanelProps) {
  const { panel, output } = state;
  const { dispatch } = actions;

  return (
    <section className="panel" style={{ height: panel.height }} hidden={!panel.visible}>
      <div className="panel-header">
        <div className="panel-tabs" role="tablist">
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={panel.view === view.id}
              className={`panel-tab${panel.view === view.id ? " is-active" : ""}`}
              onClick={() => dispatch({ type: "showPanelView", view: view.id })}
            >
              {view.label}
              {view.id === "output" && output.length > 0 && <span className="count-badge">{output.length}</span>}
            </button>
          ))}
        </div>
        <div className="panel-actions">
          {panel.view === "output" && (
            <IconButton label="Clear output" onClick={() => dispatch({ type: "clearOutput" })}>
              <Trash2 size={14} />
            </IconButton>
          )}
          <IconButton label="Close panel (Ctrl+J)" onClick={() => dispatch({ type: "togglePanel" })}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      <div className="panel-body">
        {panel.view === "problems" && (
          <div className="panel-empty">
            <CircleCheck size={16} />
            No problems detected in the workspace.
          </div>
        )}
        {panel.view === "output" &&
          (output.length === 0 ? (
            <div className="panel-empty">Nothing logged yet.</div>
          ) : (
            <div className="output-log">
              {output.map((line) => (
                <div key={line.id} className={`output-line is-${line.level}`}>
                  <span className="output-time">{line.time}</span>
                  <span className="output-level">{line.level}</span>
                  <span>{line.message}</span>
                </div>
              ))}
            </div>
          ))}
        <div hidden={panel.view !== "terminal"} className="panel-fill">
          <Terminal
            visible={panel.visible && panel.view === "terminal"}
            focusToken={terminalFocusToken}
            theme={settings.theme}
            fontSize={settings.editorFontSize}
            onError={(message) => actions.log(message, "error")}
          />
        </div>
      </div>
    </section>
  );
}
