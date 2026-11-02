export type Theme = "dark" | "light";

export interface AppInfo {
  name: string;
  version: string;
  tagline: string;
}

export interface Settings {
  theme: Theme;
  uiFontSize: number;
  editorFontSize: number;
  showLineNumbers: boolean;
}

export type SettingsPatch = Partial<Settings>;

export type Language =
  | "json"
  | "javascript"
  | "typescript"
  | "lang"
  | "markdown"
  | "image"
  | "plaintext";

export interface FileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  language?: Language;
  children?: FileNode[];
}

export interface Workspace {
  name: string;
  root: string;
  tree: FileNode[];
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchLen: number;
}

export type ProblemSeverity = "error" | "warning" | "info";

/** A finding in one workspace file. Lines and columns are 1 based, the end is exclusive. */
export interface Problem {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: ProblemSeverity;
  message: string;
  jsonPath: string;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalSession {
  id: number;
  shell: string;
}

export interface GitRepo {
  root: string;
  head: string;
  detached: boolean;
  unborn: boolean;
  localBranches: string[];
  remoteBranches: string[];
}
