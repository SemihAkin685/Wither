import { isObject, parseUiJson, type JsonObject } from "./parse";

export interface UiSource {
  path: string;
  text: string;
}

export interface ControlRef {
  ns: string;
  name: string;
}

/** A top level control as written in its file, before any @base merging. */
export interface Definition {
  ns: string;
  name: string;
  base: ControlRef | null;
  props: JsonObject;
  path: string;
}

export interface CatalogIssue {
  path: string;
  message: string;
}

const RESERVED_FILES = /(^|\/)_(ui_defs|global_variables)\.json$/;

export function isUiDefinitionFile(path: string): boolean {
  return /(^|\/)ui\/.+\.json$/i.test(path) && !RESERVED_FILES.test(path);
}

/**
 * Splits "name@base" or "name@ns.base". A bare base name lives in the current namespace.
 * Vanilla also writes "name@$var", lookupVar turns that into the control name it holds.
 */
export function parseControlKey(
  key: string,
  ns: string,
  lookupVar?: (name: string) => unknown,
): { name: string; base: ControlRef | null } {
  const at = key.indexOf("@");
  if (at === -1) return { name: key, base: null };
  const name = key.slice(0, at);
  let ref = key.slice(at + 1);
  if (ref.startsWith("$")) {
    const value = lookupVar?.(ref);
    if (typeof value === "string") ref = value;
  }
  const dot = ref.indexOf(".");
  return {
    name,
    base: dot === -1 ? { ns, name: ref } : { ns: ref.slice(0, dot), name: ref.slice(dot + 1) },
  };
}

/** Translation lookup, a plain Map works too. */
export interface Lang {
  get(key: string): string | undefined;
}

export const refKey = (ref: ControlRef) => `${ref.ns}.${ref.name}`;

/**
 * Every control of a resource pack's ui folder, indexed by "namespace.name".
 * A fallback catalog (the vanilla one) answers for anything the pack doesn't define.
 */
export class Catalog {
  readonly definitions = new Map<string, Definition>();
  readonly globals: JsonObject;
  readonly lang: Lang;
  readonly issues: CatalogIssue[] = [];
  private readonly fileNamespaces = new Map<string, string>();

  constructor(
    sources: UiSource[],
    lang: Map<string, string> = new Map(),
    private readonly fallback: Catalog | null = null,
  ) {
    this.globals = { ...fallback?.globals };
    this.lang = fallback ? { get: (key) => lang.get(key) ?? fallback.lang.get(key) } : lang;
    for (const source of sources) this.add(source);
  }

  lookup(key: string): Definition | undefined {
    return this.definitions.get(key) ?? this.fallback?.lookup(key);
  }

  namespaceOf(path: string): string | undefined {
    return this.fileNamespaces.get(path);
  }

  /** Top level control names of one file, in file order. */
  controlsOf(path: string): Definition[] {
    return [...this.definitions.values()].filter((d) => d.path === path);
  }

  private add({ path, text }: UiSource) {
    let root;
    try {
      root = parseUiJson(text);
    } catch (error) {
      this.issues.push({ path, message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!isObject(root)) return;
    if (/_global_variables\.json$/.test(path)) {
      Object.assign(this.globals, root);
      return;
    }
    if (RESERVED_FILES.test(path)) return;
    const ns = typeof root.namespace === "string" ? root.namespace : null;
    if (!ns) {
      this.issues.push({ path, message: "file has no namespace" });
      return;
    }
    this.fileNamespaces.set(path, ns);
    for (const [key, value] of Object.entries(root)) {
      if (key === "namespace" || !isObject(value)) continue;
      const { name, base } = parseControlKey(key, ns);
      this.definitions.set(`${ns}.${name}`, { ns, name, base, props: value, path });
    }
  }
}

/** Reads a .lang file into key/value pairs. Comments start with ## and trail after a tab. */
export function parseLang(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("\t#")[0].split("##")[0];
    const eq = line.indexOf("=");
    if (eq > 0) entries.set(line.slice(0, eq).trim(), line.slice(eq + 1).trimEnd());
  }
  return entries;
}
