import type { ScriptExport, ScriptMember, ScriptModuleApi, ScriptType } from "../types";

/** The script API indexed for lookups, built once per catalog. */
export interface ApiIndex {
  modules: ScriptModuleApi[];
  types: Map<string, ScriptType>;
  /** Export name to the export and the module it comes from. */
  exports: Map<string, { item: ScriptExport; module: string }>;
}

/** What an expression evaluates to, as far as the declared types tell. */
export interface Resolved {
  type: string;
  /** An array of `type`, members only make sense after indexing or iterating it. */
  many: boolean;
  /** The class or enum itself (`ItemStack.`), so its static side. */
  isStatic: boolean;
}

const indexes = new WeakMap<ScriptModuleApi[], ApiIndex>();

export function indexApi(modules: ScriptModuleApi[]): ApiIndex {
  let index = indexes.get(modules);
  if (index) return index;
  index = { modules, types: new Map(), exports: new Map() };
  for (const module of modules) {
    for (const type of module.types) if (!index.types.has(type.name)) index.types.set(type.name, type);
    for (const item of module.exports) {
      if (!index.exports.has(item.name)) index.exports.set(item.name, { item, module: module.name });
    }
  }
  indexes.set(modules, index);
  return index;
}

/** Members of a type and everything it inherits, the nearest declaration wins. */
export function membersOf(index: ApiIndex, typeName: string, isStatic: boolean): ScriptMember[] {
  const seen = new Set<string>();
  const out: ScriptMember[] = [];
  const visit = (name: string, depth: number) => {
    const type = index.types.get(name);
    if (!type || depth > 16) return;
    for (const member of type.members) {
      if (seen.has(member.name) || member.kind === "constructor") continue;
      // enum values are constants that aren't marked static, they still hang off the enum
      const fits = type.kind === "enum" ? isStatic : Boolean(member.isStatic) === isStatic;
      if (!fits) continue;
      seen.add(member.name);
      out.push(member);
    }
    for (const base of type.bases ?? []) visit(base, depth + 1);
  };
  visit(typeName, 0);
  return out;
}

function member(index: ApiIndex, value: Resolved, name: string): ScriptMember | undefined {
  return membersOf(index, value.type, value.isStatic).find((m) => m.name === name);
}

interface Step {
  name: string;
  /** Postfix `()` and `[]` after the name, in source order. */
  ops: ("call" | "index")[];
}

const IDENT = /[\w$]/;

/** Steps back over a balanced `(...)` or `[...]` that ends at `close`, returns the opening index. */
function matchBack(text: string, close: number): number {
  const closing = text[close];
  const opening = closing === ")" ? "(" : "[";
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === closing) depth++;
    else if (text[i] === opening && --depth === 0) return i;
  }
  return -1;
}

/**
 * The member chain ending at the dot at `dot`: `world.getPlayers()[0].` gives world, then
 * getPlayers with a call and an index. Null when the chain starts with something that isn't a
 * name, like a string or a number literal.
 */
export function chainBefore(text: string, dot: number): Step[] | null {
  const steps: Step[] = [];
  let i = dot;
  for (let guard = 0; guard < 64; guard++) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    const ops: Step["ops"] = [];
    while (j >= 0 && (text[j] === ")" || text[j] === "]")) {
      ops.unshift(text[j] === ")" ? "call" : "index");
      j = matchBack(text, j) - 1;
      if (j < -1) return null;
      while (j >= 0 && /\s/.test(text[j])) j--;
    }
    const end = j + 1;
    while (j >= 0 && IDENT.test(text[j])) j--;
    const name = text.slice(j + 1, end);
    if (!name || /^\d/.test(name)) return null;
    steps.unshift({ name, ops });
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (text[j] !== "." || text[j - 1] === ".") return steps;
    // optional chaining, `a?.b` reads like `a.b` here
    i = text[j - 1] === "?" ? j - 1 : j;
  }
  return null;
}

function escape(name: string) {
  return name.replace(/\$/g, "\\$");
}

/** The last match of `pattern` that starts before `limit`. */
function lastBefore(text: string, pattern: RegExp, limit: number): RegExpExecArray | null {
  let found: RegExpExecArray | null = null;
  for (const match of text.matchAll(pattern)) {
    if (match.index >= limit) break;
    found = match;
  }
  return found;
}

/**
 * Light type inference over the file, enough for the usual addon script: module objects like
 * `world`, classes and enums by name, `const x = <chain>`, `for (const x of <chain>)`, TS
 * annotations and the parameters of callbacks passed to methods like `subscribe`.
 */
export class ScriptResolver {
  private readonly index: ApiIndex;
  private readonly text: string;

  constructor(index: ApiIndex, text: string) {
    this.index = index;
    this.text = text;
  }

  /** The value the chain ending at the dot at `dot` evaluates to. */
  resolveAt(dot: number, depth = 0): Resolved | null {
    const steps = chainBefore(this.text, dot);
    return steps ? this.resolveSteps(steps, dot, depth) : null;
  }

  private resolveSteps(steps: Step[], at: number, depth: number): Resolved | null {
    if (depth > 6) return null;
    let value = this.resolveName(steps[0].name, at, depth);
    value = value && this.applyOps(value, steps[0].ops);
    for (const step of steps.slice(1)) {
      if (!value || value.many) return null;
      const found = member(this.index, value, step.name);
      if (!found?.returns) return null;
      value = this.applyOps({ type: found.returns, many: Boolean(found.many), isStatic: false }, step.ops);
    }
    return value;
  }

  private applyOps(value: Resolved, ops: Step["ops"]): Resolved {
    // calls already went through `returns`, only indexing an array changes anything
    return ops.includes("index") && value.many ? { ...value, many: false } : value;
  }

  /** Resolves a whole expression as written after `=` or `of` at offset `at`. */
  private resolveExpression(expression: string, at: number, depth: number): Resolved | null {
    const trimmed = expression.trim().replace(/^await\s+/, "");
    const created = /^new\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (created) return this.index.types.has(created[1]) ? { type: created[1], many: false, isStatic: false } : null;
    if (!/^[\w$.?\s()[\]"'`,]+$/.test(trimmed)) return null;
    const steps = chainBefore(`${trimmed}.`, trimmed.length);
    return steps ? this.resolveSteps(steps, at, depth + 1) : null;
  }

  private resolveName(name: string, at: number, depth: number): Resolved | null {
    const id = escape(name);
    const typed = (annotation: string | undefined): Resolved | null => {
      const type = annotation?.replace(/\[\]$/, "");
      if (!type || !this.index.types.has(type)) return null;
      return { type, many: annotation!.endsWith("[]"), isStatic: false };
    };

    const declaration = lastBefore(
      this.text,
      new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*(?::\\s*([\\w$]+(?:\\[\\])?))?\\s*=\\s*([^;\\n]+)`, "g"),
      at,
    );
    const loop = lastBefore(
      this.text,
      new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${id}\\s*(?::\\s*([\\w$]+))?\\s+of\\s+([^\\n]+?)\\)\\s*[{\\n]`, "g"),
      at,
    );
    const param = this.callbackParam(name, at, depth);
    // `(player: Player)` in any parameter list, or a JSDoc `@param {Player} player`
    const annotated = lastBefore(this.text, new RegExp(`[(,]\\s*${id}\\??\\s*:\\s*([\\w$]+(?:\\[\\])?)`, "g"), at);
    const jsdoc = lastBefore(this.text, new RegExp(`@param\\s*\\{([\\w$]+(?:\\[\\])?)\\}\\s*${id}\\b`, "g"), at);
    // the declaration closest to the cursor shadows the rest
    const candidates = [
      declaration && { at: declaration.index, get: () => typed(declaration[1]) ?? this.resolveExpression(declaration[2], declaration.index, depth) },
      loop && {
        at: loop.index,
        get: () => {
          const declared = typed(loop[1]);
          if (declared) return declared;
          const list = this.resolveExpression(loop[2], loop.index, depth);
          return list?.many ? { ...list, many: false } : null;
        },
      },
      param && { at: param.at, get: () => param.value },
      annotated && { at: annotated.index, get: () => typed(annotated[1]) },
      jsdoc && { at: jsdoc.index, get: () => typed(jsdoc[1]) },
    ].filter((candidate) => candidate !== null);
    candidates.sort((a, b) => b.at - a.at);
    for (const candidate of candidates) {
      const value = candidate.get();
      if (value) return value;
    }

    const exported = this.index.exports.get(name);
    if (exported?.item.typeName) return { type: exported.item.typeName, many: false, isStatic: false };
    if (exported && this.index.types.has(name)) return { type: name, many: false, isStatic: true };
    return null;
  }

  /**
   * `name` as a parameter of an arrow function or function passed to a method, typed from that
   * method's callback signature: `world.afterEvents.playerJoin.subscribe((event) => ...)`.
   */
  private callbackParam(name: string, at: number, depth: number): { at: number; value: Resolved | null } | null {
    const pattern =
      /\.\s*([A-Za-z_$][\w$]*)\s*\(\s*(?:async\s*)?(?:function\s*[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/g;
    let found: { at: number; value: Resolved | null } | null = null;
    for (const match of this.text.matchAll(pattern)) {
      if (match.index >= at) break;
      const params = (match[2] ?? match[3] ?? match[4] ?? "").split(",").map((p) => p.trim());
      const position = params.findIndex((p) => p.split(/[\s:=]/)[0] === name);
      if (position === -1) continue;
      const annotation = /:\s*([\w$]+)/.exec(params[position])?.[1];
      if (annotation && this.index.types.has(annotation)) {
        found = { at: match.index, value: { type: annotation, many: false, isStatic: false } };
        continue;
      }
      const owner = this.resolveAt(match.index, depth + 1);
      const method = owner && !owner.many ? member(this.index, owner, match[1]) : undefined;
      const type = method?.callback?.[position];
      found = { at: match.index, value: type ? { type, many: false, isStatic: false } : null };
    }
    return found;
  }
}
