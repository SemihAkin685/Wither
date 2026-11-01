import { useEffect, useState } from "react";
import { Command, FolderOpen, Moon, Settings, Sun, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import type { AppInfo, RecentProject, Theme } from "../lib/types";
import { Logo } from "./Logo";
import { Keys } from "./ui";

interface WelcomeScreenProps {
  appInfo: AppInfo | null;
  theme: Theme;
  workspaceName: string | null;
  onOpenWorkspace: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

interface Action {
  icon: LucideIcon;
  label: string;
  keys?: string;
  run: () => void;
}

const shortcuts: [string, string][] = [
  ["Quick open file", "Ctrl+P"],
  ["Search in workspace", "Ctrl+Shift+F"],
  ["Toggle sidebar", "Ctrl+B"],
  ["Toggle bottom panel", "Ctrl+J"],
  ["Save file", "Ctrl+S"],
  ["Close tab", "Ctrl+W"],
];

export function WelcomeScreen(props: WelcomeScreenProps) {
  const { appInfo, theme, workspaceName, onOpenWorkspace, onOpenPalette, onOpenSettings, onToggleTheme } =
    props;
  const [recent, setRecent] = useState<RecentProject[]>([]);

  useEffect(() => {
    api.recentProjects().then(setRecent).catch(() => setRecent([]));
  }, []);

  const actions: Action[] = [
    {
      icon: FolderOpen,
      label: workspaceName ? `Reopen ${workspaceName}` : "Open Workspace",
      keys: "Ctrl+O",
      run: onOpenWorkspace,
    },
    { icon: Command, label: "Command Palette", keys: "Ctrl+Shift+P", run: onOpenPalette },
    { icon: Settings, label: "Settings", keys: "Ctrl+,", run: onOpenSettings },
    {
      icon: theme === "dark" ? Sun : Moon,
      label: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme",
      run: onToggleTheme,
    },
  ];

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <header className="welcome-header">
          <Logo size={56} />
          <div>
            <h1>{appInfo?.name ?? "Wither"}</h1>
            <p>{appInfo?.tagline}</p>
          </div>
        </header>

        <div className="welcome-columns">
          <section>
            <h2>Start</h2>
            <ul className="welcome-list">
              {actions.map(({ icon: Icon, label, keys, run }) => (
                <li key={label}>
                  <button type="button" className="welcome-item" onClick={run}>
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{label}</span>
                    {keys && <Keys keys={keys} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Recent</h2>
            <ul className="welcome-list">
              {recent.map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    className="welcome-item is-recent"
                    onClick={onOpenWorkspace}
                    title={project.path}
                  >
                    <span className="recent-name">{project.name}</span>
                    <span className="recent-path">{project.path}</span>
                    <span className="recent-time">{project.lastOpened}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="welcome-shortcuts">
          <h2>Keyboard</h2>
          <div className="shortcut-grid">
            {shortcuts.map(([label, keys]) => (
              <div key={label} className="shortcut-row">
                <span>{label}</span>
                <Keys keys={keys} />
              </div>
            ))}
          </div>
        </section>

        {appInfo && <footer className="welcome-footer">Version {appInfo.version}</footer>}
      </div>
    </div>
  );
}
