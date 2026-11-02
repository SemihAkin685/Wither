import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  CompletionCatalog,
  GitRepo,
  Problem,
  TerminalSession,
  TerminalSize,
  RecentProject,
  SearchMatch,
  Settings,
  SettingsPatch,
  Workspace,
} from "./types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => invoke<Settings>("update_settings", { patch }),
  recentProjects: () => invoke<RecentProject[]>("recent_projects"),
  openWorkspace: () => invoke<Workspace>("open_workspace"),
  closeWorkspace: () => invoke<void>("close_workspace"),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, contents: string) => invoke<void>("write_file", { path, contents }),
  gitStatus: () => invoke<GitRepo | null>("git_status"),
  gitInit: () => invoke<GitRepo | null>("git_init"),
  gitCheckout: (branch: string) => invoke<GitRepo | null>("git_checkout", { branch }),
  gitCreateBranch: (name: string, checkout: boolean) =>
    invoke<GitRepo | null>("git_create_branch", { name, checkout }),
  searchWorkspace: (query: string) => invoke<SearchMatch[]>("search_workspace", { query }),
  checkWorkspace: (unsaved: Record<string, string>) => invoke<Problem[]>("check_workspace", { unsaved }),
  completionCatalog: () => invoke<CompletionCatalog>("completion_catalog"),
  terminalSpawn: (size: TerminalSize, onOutput: Channel<ArrayBuffer>, onExit: Channel<number | null>) =>
    invoke<TerminalSession>("terminal_spawn", { size, onOutput, onExit }),
  terminalWrite: (id: number, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: number, size: TerminalSize) => invoke<void>("terminal_resize", { id, size }),
  terminalKill: (id: number) => invoke<void>("terminal_kill", { id }),
};

export function errorMessage(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}
