import { CircleCheck, CircleX, Info, Trash2, TriangleAlert, X } from "lucide-react";
import { fileName } from "../lib/tree";
import type { FileNode, Problem, Settings } from "../lib/types";
import type { WorkbenchActions } from "../state/useWorkbench";
import type { PanelView, WorkbenchState } from "../state/workbench";
import { FileIcon } from "./FileIcon";
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

const severityIcon = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
} as const;

function ProblemList(props: {
  problems: Problem[];
  files: Record<string, FileNode>;
  hasWorkspace: boolean;
  onOpen: (problem: Problem) => void;
}) {
  const { problems, files, hasWorkspace, onOpen } = props;
  if (problems.length === 0) {
    return (
      <div className="panel-empty">
        <CircleCheck size={16} />
        {hasWorkspace ? "No problems detected in the workspace." : "Open a workspace to check it for problems."}
      </div>
    );
  }
  // problems come sorted by severity, keep that order for the files too
  const grouped = new Map<string, Problem[]>();
  for (const problem of problems) {
    const list = grouped.get(problem.path);
    if (list) list.push(problem);
    else grouped.set(problem.path, [problem]);
  }
  return (
    <div className="problem-list">
      {[...grouped].map(([path, list]) => (
        <div key={path}>
          <div className="tree-row problem-file">
            <FileIcon language={files[path]?.language} />
            <span className="tree-label">{fileName(path)}</span>
            <span className="search-file-dir">{path.slice(0, path.lastIndexOf("/"))}</span>
            <span className="count-badge">{list.length}</span>
          </div>
          {list.map((problem, i) => {
            const Icon = severityIcon[problem.severity];
            return (
              <div
                key={i}
                className="tree-row problem-row"
                title={`${path}:${problem.line}:${problem.column}`}
                onClick={() => onOpen(problem)}
              >
                <Icon size={14} className={`problem-icon is-${problem.severity}`} />
                <span className="problem-message">{problem.message}</span>
                {problem.jsonPath && <span className="problem-detail">{problem.jsonPath}</span>}
                <span className="problem-detail">
                  [Ln {problem.line}, Col {problem.column}]
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function BottomPanel({ state, actions, settings, terminalFocusToken }: BottomPanelProps) {
  const { panel, output, problems } = state;
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
              {view.id === "problems" && problems.length > 0 && (
                <span className="count-badge">{problems.length}</span>
              )}
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
          <ProblemList
            problems={problems}
            files={state.files}
            hasWorkspace={!!state.workspace}
            onOpen={(problem) => actions.openFile(problem.path, problem.line, problem.column)}
          />
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
