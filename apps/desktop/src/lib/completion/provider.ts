import type { CompletionCatalog, CompletionFamily } from "../types";
import { matchesPath, shapeOf, type JsonContext, type JsonScan, type Segment } from "./context";

export type SuggestionKind =
  | "property"
  | "component"
  | "value"
  | "keyword"
  | "module"
  | "word"
  | "command"
  | "method"
  | "class"
  | "enum"
  | "constant"
  | "variable";

/** What a key's value looks like, so accepting it can drop in `{}` or `[]` like VS Code does. */
export type ValueShape = "object" | "array" | "string" | "any";

export interface Suggestion {
  label: string;
  kind: SuggestionKind;
  detail?: string;
  deprecated?: boolean;
  /** Keys only. */
  shape?: ValueShape;
  /** Values only, written without quotes when false (numbers, booleans, null). */
  quote?: boolean;
  /** Lower sorts first when two suggestions match equally well. */
  group: number;
}

interface Member {
  name: string;
  shape: ValueShape;
}

const m = (name: string, shape: ValueShape = "any"): Member => ({ name, shape });

const MANIFEST_ROOT = [
  m("format_version"),
  m("header", "object"),
  m("modules", "array"),
  m("dependencies", "array"),
  m("capabilities", "array"),
  m("metadata", "object"),
  m("settings", "array"),
  m("subpacks", "array"),
];
const MANIFEST_HEADER = [
  m("name", "string"),
  m("description", "string"),
  m("uuid", "string"),
  m("version", "array"),
  m("min_engine_version", "array"),
  m("base_game_version", "array"),
  m("pack_scope", "string"),
  m("lock_template_options"),
  m("platform_locked"),
];
const MANIFEST_MODULE = [
  m("type", "string"),
  m("uuid", "string"),
  m("version", "array"),
  m("description", "string"),
  m("entry", "string"),
  m("language", "string"),
];
const MANIFEST_DEPENDENCY = [m("uuid", "string"), m("module_name", "string"), m("version")];
const MANIFEST_METADATA = [
  m("authors", "array"),
  m("license", "string"),
  m("url", "string"),
  m("generated_with", "object"),
  m("product_type", "string"),
];
const MANIFEST_SUBPACK = [m("folder_name", "string"), m("name", "string"), m("memory_tier")];

const SHAPES: Record<string, ValueShape> = {
  description: "object",
  components: "object",
  component_groups: "object",
  events: "object",
  curves: "object",
  permutations: "array",
  identifier: "string",
  menu_category: "object",
  states: "object",
  traits: "object",
  properties: "object",
  animations: "object",
  scripts: "object",
  runtime_identifier: "string",
  basic_render_parameters: "object",
  condition: "string",
};

/** Members whose string values are vanilla ids, by member name. */
const VANILLA_VALUES: Record<string, Exclude<keyof CompletionCatalog["vanilla"], "commands">> = {
  item: "items",
  items: "items",
  block: "blocks",
  blocks: "blocks",
  block_name: "blocks",
  entity: "entities",
  entity_type: "entities",
  spawn_entity: "entities",
  biome: "biomes",
  biomes: "biomes",
  effect: "effects",
  effects: "effects",
  enchantment: "enchantments",
  enchantments: "enchantments",
};

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function keys(members: Member[], detail: string, group = 0): Suggestion[] {
  return members.map(({ name, shape }) => ({ label: name, kind: "property", detail, shape, group }));
}

function strings(values: string[], kind: SuggestionKind, detail: string, group = 1): Suggestion[] {
  return values.map((label) => ({ label, kind, detail, quote: true, group }));
}

const BOOLEANS: Suggestion[] = ["true", "false"].map((label) => ({
  label,
  kind: "keyword",
  quote: false,
  group: 0,
}));

/** The member a value belongs to, skipping array indices: `items` for `items[2]`. */
function owningKey(path: Segment[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (typeof step === "string") return step;
  }
  return null;
}

function manifestSuggestions(scan: JsonScan, context: JsonContext, catalog: CompletionCatalog | null): Suggestion[] {
  const { path, position } = context;
  const at = (...pattern: Segment[]) => matchesPath(path, pattern);
  if (position === "key") {
    if (at()) return keys(MANIFEST_ROOT, "manifest");
    if (at("header")) return keys(MANIFEST_HEADER, "header");
    if (at("modules", "*")) return keys(MANIFEST_MODULE, "module");
    if (at("dependencies", "*")) return keys(MANIFEST_DEPENDENCY, "dependency");
    if (at("metadata")) return keys(MANIFEST_METADATA, "metadata");
    if (at("subpacks", "*")) return keys(MANIFEST_SUBPACK, "subpack");
    return [];
  }
  const key = owningKey(path);
  if (key === "uuid") {
    // a fresh one each time, typing a uuid by hand is nobody's idea of fun
    return [{ label: crypto.randomUUID(), kind: "value", detail: "new uuid", quote: true, group: 0 }];
  }
  if (!catalog) return [];
  if (at("modules", "*", "type")) return strings(catalog.manifest.moduleTypes, "value", "module type", 0);
  if (at("modules", "*", "language")) return strings(["javascript"], "value", "script language", 0);
  if (at("capabilities", "*")) return strings(catalog.manifest.capabilities, "value", "capability", 0);
  if (at("header", "pack_scope")) return strings(["world", "global", "any"], "value", "pack scope", 0);
  if (at("header", "lock_template_options") || at("header", "platform_locked")) return BOOLEANS;
  if (at("dependencies", "*", "module_name")) {
    return catalog.manifest.scriptModules.map((module) => ({
      label: module.name,
      kind: "module",
      detail: module.versions[0],
      quote: true,
      group: 0,
    }));
  }
  if (at("dependencies", "*", "version")) {
    // hmm, script dependencies take a version string, the module name tells which ones exist
    const name = moduleNameOf(scan, path);
    const module = catalog.manifest.scriptModules.find((entry) => entry.name === name);
    return module ? strings(module.versions, "value", module.name, 0) : [];
  }
  return [];
}

/** The module_name written next to the version being typed, if any. */
function moduleNameOf(scan: JsonScan, path: Segment[]): string | null {
  const shape = shapeOf([...path.slice(0, -1), "module_name"]);
  const hit = scan.values.find((entry) => entry.path[1] === path[1] && shapeOf(entry.path) === shape);
  return hit?.value ?? null;
}

/** Families whose payload sits at the root, or whose folder holds the file when none does yet. */
function familiesOf(path: string, scan: JsonScan, catalog: CompletionCatalog): CompletionFamily[] {
  const rootKeys = new Set(scan.objects.filter((object) => object.path.length === 0).flatMap((o) => o.keys));
  const byPayload = catalog.families.filter((family) => rootKeys.has(family.payloadKey));
  if (byPayload.length) return byPayload;
  const folders = path.split("/").slice(0, -1);
  return catalog.families.filter((family) => family.directories.some((dir) => folders.includes(dir)));
}

function familySuggestions(context: JsonContext, family: CompletionFamily): Suggestion[] {
  const { path, position } = context;
  if (path[0] !== family.payloadKey) return [];
  const inner = path.slice(1);
  const at = (...pattern: Segment[]) => matchesPath(inner, pattern);
  const parent = family.componentParents.find((pattern) => matchesPath(inner, pattern.split("/")));

  if (position === "key") {
    if (at()) return keys(family.members.map((name) => m(name, SHAPES[name])), family.name);
    if (at("description")) return keys(family.description.map((name) => m(name, SHAPES[name])), "description");
    if (at("permutations", "*")) return keys([m("condition", "string"), m("components", "object")], "permutation");
    if (parent) {
      return family.components.map((component) => ({
        label: component.name,
        kind: "component",
        detail: componentDetail(component),
        deprecated: component.deprecatedSince !== null,
        shape: "any",
        group: component.deprecatedSince ? 2 : 0,
      }));
    }
    // inside one component, only the members the game added later are known by name
    const owner = family.componentParents.find((pattern) => matchesPath(inner.slice(0, -1), pattern.split("/")));
    if (owner) {
      const component = family.components.find((entry) => entry.name === inner[inner.length - 1]);
      return component ? keys(component.fields.map((field) => m(field)), component.name) : [];
    }
    return [];
  }
  if (at("description", "*") && /^is_/.test(String(inner[1]))) return BOOLEANS;
  return [];
}

function componentDetail(component: CompletionFamily["components"][number]) {
  if (component.deprecatedSince) {
    const instead = component.supersededBy ? `, use ${component.supersededBy}` : "";
    return `deprecated since ${component.deprecatedSince}${instead}`;
  }
  if (component.experimental) return "experimental";
  return component.released ? `since ${component.released}` : "component";
}

/** Keys used in other objects at the same place, and values used for the same member. */
function documentSuggestions(context: JsonContext, scan: JsonScan): Suggestion[] {
  const shape = shapeOf(context.path);
  // the word being typed shows up in the scan too, it isn't a suggestion for itself
  const seen = new Set<string>([context.typed]);
  const out: Suggestion[] = [];
  if (context.position === "key") {
    for (const object of scan.objects) {
      if (shapeOf(object.path) !== shape) continue;
      for (const key of object.keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: key, kind: "property", detail: "in this file", shape: "any", group: 3 });
      }
    }
  } else {
    for (const entry of scan.values) {
      if (shapeOf(entry.path) !== shape || seen.has(entry.value)) continue;
      seen.add(entry.value);
      out.push({ label: entry.value, kind: "value", detail: "in this file", quote: true, group: 3 });
    }
  }
  return out;
}

/**
 * Everything worth suggesting at the cursor, unfiltered. Schema like suggestions come from the
 * bedrock_addon catalog, then whatever the same file already uses at the same spot, the way
 * VS Code fills in a JSON file it has no schema for.
 */
export function suggest(path: string, scan: JsonScan, catalog: CompletionCatalog | null): Suggestion[] {
  const context = scan.context;
  if (!context) return [];
  const out: Suggestion[] = [];

  if (basename(path).toLowerCase() === "manifest.json") {
    out.push(...manifestSuggestions(scan, context, catalog));
  } else if (catalog) {
    const families = familiesOf(path, scan, catalog);
    if (context.position === "key" && context.path.length === 0 && families.length) {
      out.push({ label: "format_version", kind: "property", detail: "format version", shape: "string", group: 0 });
      for (const family of families) {
        out.push({ label: family.payloadKey, kind: "property", detail: family.name, shape: "object", group: 0 });
      }
    }
    for (const family of families) out.push(...familySuggestions(context, family));
  }

  if (catalog && context.position === "value") {
    const key = owningKey(context.path);
    const list = key ? VANILLA_VALUES[key] : undefined;
    if (list) out.push(...strings(catalog.vanilla[list], "value", `vanilla ${key}`, 1));
  }

  out.push(...documentSuggestions(context, scan));

  const taken = new Set(context.position === "key" ? context.siblings : []);
  const unique = new Set<string>();
  return out.filter((item) => {
    if (taken.has(item.label) || unique.has(item.label)) return false;
    unique.add(item.label);
    return true;
  });
}
