import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  CompletionCatalog,
  GitRepo,
  MinecraftInstall,
  PackInfo,
  Problem,
  TerminalSession,
  TerminalSize,
  RecentProject,
  SearchMatch,
  Settings,
  SettingsPatch,
  TestReport,
  Workspace,
  World,
} from "./types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => invoke<Settings>("update_settings", { patch }),
  recentProjects: () => invoke<RecentProject[]>("recent_projects"),
  openWorkspace: () => invoke<Workspace | null>("open_workspace"),
  openRecent: (path: string) => invoke<Workspace>("open_recent", { path }),
  closeWorkspace: () => invoke<void>("close_workspace"),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  readImage: (path: string) => invoke<ArrayBuffer>("read_image", { path }),
  writeFile: (path: string, contents: string) => invoke<void>("write_file", { path, contents }),
  gitStatus: () => invoke<GitRepo | null>("git_status"),
  gitInit: () => invoke<GitRepo | null>("git_init"),
  gitCheckout: (branch: string) => invoke<GitRepo | null>("git_checkout", { branch }),
  gitCreateBranch: (name: string, checkout: boolean) =>
    invoke<GitRepo | null>("git_create_branch", { name, checkout }),
  searchWorkspace: (query: string) => invoke<SearchMatch[]>("search_workspace", { query }),
  checkWorkspace: (unsaved: Record<string, string>) => invoke<Problem[]>("check_workspace", { unsaved }),
  completionCatalog: () => invoke<CompletionCatalog>("completion_catalog"),
  entityModel: (path: string) => invoke<string | null>("entity_model", { path }),
  blockbenchInstalled: () => invoke<boolean>("blockbench_installed"),
  openInBlockbench: (path: string) => invoke<void>("open_in_blockbench", { path }),
  openBlockbenchDownload: () => invoke<void>("open_blockbench_download"),
  terminalSpawn: (size: TerminalSize, onOutput: Channel<ArrayBuffer>, onExit: Channel<number | null>) =>
    invoke<TerminalSession>("terminal_spawn", { size, onOutput, onExit }),
  terminalWrite: (id: number, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: number, size: TerminalSize) => invoke<void>("terminal_resize", { id, size }),
  terminalKill: (id: number) => invoke<void>("terminal_kill", { id }),
  listPacks: () => invoke<PackInfo[]>("list_packs"),
  exportAddon: (pack: string | null) => invoke<string | null>("export_addon", { pack }),
  importArchive: () => invoke<Workspace | null>("import_archive"),
  minecraftInstalls: () => invoke<MinecraftInstall[]>("minecraft_installs"),
  listWorlds: (install: string) => invoke<World[]>("list_worlds", { install }),
  worldIcon: (install: string, world: string) => invoke<ArrayBuffer>("world_icon", { install, world }),
  gameRunning: () => invoke<boolean | null>("game_running"),
  testInGame: (install: string, world: string | null) => invoke<TestReport>("test_in_game", { install, world }),
};

export function errorMessage(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}
