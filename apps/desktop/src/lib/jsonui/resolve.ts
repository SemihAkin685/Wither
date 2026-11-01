import { applyBindings, DEFAULT_PREVIEW_DATA, settleBoundProps, type CollectionScope, type DeferredView, type PreviewData } from "./bind";
import { Catalog, parseControlKey, refKey, type ControlRef } from "./catalog";
import { isObject, type Json, type JsonObject } from "./parse";
import { evalExpression, evalRequires } from "./requires";

/** A control after @base merging and variable substitution, ready for layout. */
export interface UiNode {
  name: string;
  type: string;
  props: JsonObject;
  children: UiNode[];
  /** Dotted path from the root, handy for hover labels and stable identity. */
  path: string;
}

export interface ResolveResult {
  root: UiNode | null;
  missing: string[];
}

interface Merged {
  props: JsonObject;
  /** Namespace the `controls` array was written in, bare base names resolve against it. */
  controlsNs: string;
}

type Env = Map<string, Json>;

const MAX_DEPTH = 64;
const MAX_GRID_ITEMS = 256;
const MAX_FACTORY_ITEMS = 64;
const NO_SCOPE: CollectionScope = new Map();
// these hold nested controls or engine data, the variable pass leaves them alone
const RAW_KEYS = new Set(["controls", "variables", "bindings", "button_mappings", "anims", "factory"]);

export function resolveControl(catalog: Catalog, ref: ControlRef, data: PreviewData = DEFAULT_PREVIEW_DATA): ResolveResult {
  return new Resolver(catalog, data).run(ref);
}

class Resolver {
  private readonly merged = new Map<string, Merged | null>();
  private readonly missing = new Set<string>();
  private readonly resolving = new Set<string>();
  private readonly deferred = new Map<UiNode, DeferredView[]>();

  constructor(
    private readonly catalog: Catalog,
    private readonly data: PreviewData,
  ) {}

  run(ref: ControlRef): ResolveResult {
    const env: Env = new Map(Object.entries(this.catalog.globals));
    const template = this.template(ref);
    const root = template ? this.instantiate(ref.name, template, env, ref.name, 0, NO_SCOPE) : null;
    if (!template) this.missing.add(refKey(ref));
    if (root) this.runDeferred(root);
    return { root, missing: [...this.missing] };
  }

  /** View bindings that read another control, e.g. a button hiding its icon slot when the icon is empty. */
  private runDeferred(root: UiNode) {
    const parents = new Map<UiNode, UiNode>();
    const index = (node: UiNode) =>
      node.children.forEach((child) => {
        parents.set(child, node);
        index(child);
      });
    index(root);
    for (const [node, views] of this.deferred) {
      for (const view of views) {
        const scope = view.siblingScope ? (parents.get(node) ?? node) : node;
        const source = findByName(scope, view.source);
        if (!source) continue;
        node.props[view.target] = evalExpression(view.expression, new Map(), (name) => source.props[name]);
      }
      settleBoundProps(node.props, this.data);
    }
  }

  /** The fully merged props of a named control, memoised since many instances share a template. */
  private template(ref: ControlRef): Merged | null {
    const key = refKey(ref);
    const cached = this.merged.get(key);
    if (cached !== undefined) return cached;
    const def = this.catalog.lookup(key);
    if (!def || this.resolving.has(key)) {
      this.merged.set(key, null);
      return null;
    }
    this.resolving.add(key);
    const result = this.extend(def.base, def.props, def.ns);
    this.resolving.delete(key);
    this.merged.set(key, result);
    return result;
  }

  // own props shadow the base ones key by key, the game does no deep merge here
  private extend(base: ControlRef | null, own: JsonObject, ns: string): Merged {
    if (!base) return { props: own, controlsNs: ns };
    const parent = this.template(base);
    if (!parent) {
      this.missing.add(refKey(base));
      return { props: own, controlsNs: ns };
    }
    return {
      props: { ...parent.props, ...own },
      controlsNs: "controls" in own ? ns : parent.controlsNs,
    };
  }

  private instantiate(
    name: string,
    merged: Merged,
    parentEnv: Env,
    path: string,
    depth: number,
    scope: CollectionScope,
  ): UiNode | null {
    if (depth > MAX_DEPTH) return null;
    const env = declare(merged.props, parentEnv);
    const props: JsonObject = {};
    for (const [key, value] of Object.entries(merged.props)) {
      if (key.startsWith("$") || RAW_KEYS.has(key)) continue;
      const resolved = substitute(value, env);
      if (resolved !== undefined) props[key] = resolved;
    }
    if (condition(merged.props.ignored, props.ignored, env, false)) return null;
    if ("visible" in merged.props) props.visible = condition(merged.props.visible, props.visible, env, true);
    const views = applyBindings(props, substitute(merged.props.bindings ?? null, env), this.data, scope);
    settleBoundProps(props, this.data);
    const type = typeof props.type === "string" ? props.type : "panel";
    const node: UiNode = { name, type, props, children: [], path };
    if (views.length > 0) this.deferred.set(node, views);

    const controls = merged.props.controls;
    if (Array.isArray(controls)) {
      for (const entry of controls) {
        if (!isObject(entry)) continue;
        for (const [key, inline] of Object.entries(entry)) {
          if (!isObject(inline)) continue;
          const parsed = parseControlKey(key, merged.controlsNs, (name) => env.get(name));
          const child = this.extend(parsed.base, inline, merged.controlsNs);
          // names can be variables too, vanilla buttons call their parts "$button_image" and friends
          const named = parsed.name.startsWith("$") ? env.get(parsed.name) : parsed.name;
          const name = typeof named === "string" ? named : parsed.name;
          const built = this.instantiate(name, child, env, `${path}/${name}`, depth + 1, scope);
          if (built) node.children.push(built);
        }
      }
    }
    if (type === "grid") this.fillGrid(node, env, depth, merged.controlsNs, scope);
    else this.fillFactory(node, substitute(merged.props.factory ?? null, env), env, depth, merged.controlsNs, scope);
    return node;
  }

  /**
   * A factory with a collection_name makes one control per data item. Items can
   * pick a control_ids entry with a "type" key, otherwise "button" or the first id wins.
   */
  private fillFactory(node: UiNode, factory: Json | undefined, env: Env, depth: number, ns: string, scope: CollectionScope) {
    const collection = node.props.collection_name;
    if (!isObject(factory) || typeof collection !== "string") return;
    const items = this.data.collections[collection] ?? [];
    const ids = isObject(factory.control_ids) ? factory.control_ids : {};
    const prefix = typeof factory.name === "string" ? factory.name : "item";
    items.slice(0, MAX_FACTORY_ITEMS).forEach((item, i) => {
      const kind = typeof item.type === "string" ? item.type : "button";
      const pick = factory.control_name ?? ids[kind] ?? ids.button ?? Object.values(ids)[0];
      if (typeof pick !== "string") return;
      // "@ns.name" in control_ids means the same thing as a plain reference here
      const ref = parseControlKey(`x@${pick.replace(/^@/, "")}`, ns).base;
      const merged = ref && this.template(ref);
      if (!merged) {
        if (ref) this.missing.add(refKey(ref));
        return;
      }
      const childScope = new Map(scope).set(collection, item);
      const child = this.instantiate(`${prefix}${i}`, merged, env, `${node.path}/${prefix}${i}`, depth + 1, childScope);
      if (child) node.children.push(child);
    });
  }

  // a grid always shows every cell, collection items fill the ones they cover
  private fillGrid(node: UiNode, env: Env, depth: number, ns: string, scope: CollectionScope) {
    const template = node.props.grid_item_template;
    const dims = node.props.grid_dimensions;
    if (typeof template !== "string" || !Array.isArray(dims)) return;
    const [cols, rows] = dims.map((d) => (typeof d === "number" ? Math.max(0, Math.floor(d)) : 0));
    const count = Math.min(cols * rows, MAX_GRID_ITEMS);
    const ref = parseControlKey(`item@${template}`, ns).base;
    const merged = ref && this.template(ref);
    if (!merged) {
      if (ref) this.missing.add(refKey(ref));
      return;
    }
    const collection = typeof node.props.collection_name === "string" ? node.props.collection_name : null;
    const items = collection ? this.data.collections[collection] : undefined;
    for (let i = 0; i < count; i++) {
      const itemScope = collection && items?.[i] ? new Map(scope).set(collection, items[i]) : scope;
      const item = this.instantiate(`item${i}`, merged, env, `${node.path}/item${i}`, depth + 1, itemScope);
      if (item) node.children.push({ ...item, props: { ...item.props, grid_position: [i % cols, Math.floor(i / cols)] } });
    }
  }
}

function findByName(root: UiNode, name: string): UiNode | null {
  const queue = [...root.children];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.name === name) return node;
    queue.push(...node.children);
  }
  return null;
}

/** Applies a control's $variable declarations and matching `variables` blocks on top of the inherited scope. */
function declare(props: JsonObject, parentEnv: Env): Env {
  const env: Env = new Map(parentEnv);
  const assign = (key: string, value: Json) => {
    const bar = key.indexOf("|");
    if (bar === -1) {
      env.set(key, substitute(value, env) ?? null);
    } else if (key.slice(bar + 1) === "default") {
      // hmm, |default only kicks in when nobody up the chain passed the variable in
      const name = key.slice(0, bar);
      if (!env.has(name)) env.set(name, substitute(value, env) ?? null);
    }
  };
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("$")) assign(key, value);
  }
  const blocks = props.variables;
  const list = Array.isArray(blocks) ? blocks : isObject(blocks) ? [blocks] : [];
  for (const block of list) {
    if (!isObject(block) || !evalRequires(block.requires ?? null, env)) continue;
    for (const [key, value] of Object.entries(block)) {
      if (key.startsWith("$")) assign(key, value);
    }
  }
  return env;
}

function substitute(value: Json, env: Env): Json | undefined {
  if (typeof value === "string") {
    if (value.startsWith("(")) return inlineVariables(value, env);
    if (!value.startsWith("$")) return value;
    return env.has(value) ? env.get(value) : undefined;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, env) ?? null);
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      const resolved = substitute(v, env);
      if (resolved !== undefined) out[k] = resolved;
    }
    return out;
  }
  return value;
}

/**
 * Expressions such as binding names mention variables inline, "($tooltip_name = '')".
 * A variable holding a #binding goes in bare so it's read as a binding later, anything
 * else becomes a literal.
 */
function inlineVariables(expression: string, env: Env): string {
  return expression.replace(/\$[\w|]+/g, (name) => {
    if (!env.has(name)) return name;
    const value = env.get(name);
    if (typeof value === "string") return value.startsWith("#") ? value : `'${value.replace(/'/g, "")}'`;
    return value === null || value === undefined ? "''" : String(value);
  });
}

/**
 * ignored and visible take a plain value, a $variable or a whole expression like
 * "(not $flag)". A #binding keeps the fallback here, the bindings pass sets the real value.
 */
function condition(raw: Json | undefined, substituted: Json | undefined, env: Env, fallback: boolean): boolean {
  if (typeof raw === "string" && raw.startsWith("#")) return fallback;
  if (typeof raw === "string" && /[()\s]/.test(raw)) return evalRequires(raw, env);
  if (substituted === undefined) return raw === undefined ? fallback : false;
  if (typeof substituted === "string" && substituted.startsWith("#")) return fallback;
  return truthy(substituted);
}

function truthy(value: Json | undefined): boolean {
  return value === true || (typeof value === "number" && value !== 0) || value === "true";
}
