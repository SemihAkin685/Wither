import type { Json } from "./parse";

type Token = { kind: "op" | "word" | "string" | "number"; text: string };

/**
 * Evaluates a `variables` block's `requires`, e.g. "$flag", "(not $flag)" or
 * "(($mode = 'pocket') and $touch)". #bindings read through the binding
 * lookup and count as false without one.
 */
export function evalRequires(raw: Json, env: Map<string, Json>, binding?: (name: string) => Json | undefined): boolean {
  return truthy(evalExpression(raw, env, binding));
}

/** Same grammar as evalRequires, but returns the value so view bindings can copy strings and numbers. */
export function evalExpression(raw: Json, env: Map<string, Json>, binding?: (name: string) => Json | undefined): Json {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return false;
  const tokens = tokenize(raw);
  let i = 0;

  const peek = () => tokens[i]?.text.toLowerCase();
  const value = (): Json => {
    const token = tokens[i++];
    if (!token) return null;
    if (token.text === "(") {
      const inner = or();
      if (peek() === ")") i++;
      return inner;
    }
    if (token.kind === "word" && token.text.toLowerCase() === "not") return !truthy(compare());
    if (token.kind === "string") return token.text;
    if (token.kind === "number") return Number(token.text);
    if (token.text.startsWith("$")) return env.get(token.text) ?? null;
    if (token.text.startsWith("#")) return binding?.(token.text) ?? null;
    if (token.text === "true" || token.text === "false") return token.text === "true";
    return null;
  };
  const compare = (): Json => {
    const left = value();
    const op = peek();
    if (op === "=" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
      i++;
      const right = value();
      if (op === "=") return loose(left) === loose(right);
      if (op === "!=") return loose(left) !== loose(right);
      const [a, b] = [Number(left), Number(right)];
      return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
    }
    return left;
  };
  const and = (): Json => {
    let result = compare();
    while (peek() === "and") {
      i++;
      const right = truthy(compare());
      result = truthy(result) && right;
    }
    return result;
  };
  const or = (): Json => {
    let result = and();
    while (peek() === "or") {
      i++;
      const right = truthy(and());
      result = truthy(result) || right;
    }
    return result;
  };

  return or();
}

function loose(value: Json): string {
  return value === null ? "" : String(value);
}

function truthy(value: Json): boolean {
  if (typeof value === "string") return value !== "" && value !== "false";
  if (typeof value === "number") return value !== 0;
  return value === true;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\(|\)|!=|<=|>=|=|<|>)|'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|([$#]?[\w.|]+))/gy;
  let match;
  while ((match = re.exec(text)) && match[0]) {
    if (match[1]) tokens.push({ kind: "op", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "string", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "string", text: match[3] });
    else if (match[4]) tokens.push({ kind: "number", text: match[4] });
    else if (match[5]) tokens.push({ kind: "word", text: match[5] });
  }
  return tokens;
}
