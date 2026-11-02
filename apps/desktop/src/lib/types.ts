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
  tabSize: number;
  highlightCurrentLine: boolean;
  suggestions: boolean;
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

/** One component the game knows for a document family, from bedrock_addon. */
export interface CompletionComponent {
  name: string;
  released: string | null;
  deprecatedSince: string | null;
  supersededBy: string | null;
  experimental: boolean;
  fields: string[];
}

export interface CompletionFamily {
  name: string;
  payloadKey: string;
  directories: string[];
  members: string[];
  description: string[];
  /** Paths under the payload holding components, "*" matches any key or index. */
  componentParents: string[];
  components: CompletionComponent[];
}

export interface CompletionCatalog {
  families: CompletionFamily[];
  manifest: {
    moduleTypes: string[];
    capabilities: string[];
    /** Newest version first. */
    scriptModules: { name: string; versions: string[] }[];
  };
  vanilla: {
    blocks: string[];
    items: string[];
    entities: string[];
    biomes: string[];
    effects: string[];
    enchantments: string[];
    commands: { name: string; aliases: string[]; usage: string }[];
  };
  /** Exports and members of the public script modules, generated from the game's metadata. */
  scriptApi: ScriptModuleApi[];
}

export interface ScriptModuleApi {
  name: string;
  version: string;
  exports: ScriptExport[];
  types: ScriptType[];
}

export interface ScriptExport {
  name: string;
  kind: "class" | "interface" | "enum" | "error" | "object" | "function" | "constant";
  detail: string;
  /** The declared type an object export holds, `World` for `world`. */
  typeName?: string;
}

export interface ScriptType {
  name: string;
  kind: "class" | "interface" | "enum" | "error";
  bases?: string[];
  members: ScriptMember[];
}

export interface ScriptMember {
  name: string;
  kind: "method" | "constructor" | "property" | "constant";
  isStatic?: boolean;
  detail: string;
  /** The declared type the member gives back, for following a chain. */
  returns?: string;
  /** True when `returns` is the element type of an array. */
  many?: boolean;
  /** Declared types a callback argument of the method is called with. */
  callback?: (string | null)[];
}
