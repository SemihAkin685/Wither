import type { Json } from "./parse";

export type Unit = "px" | "%" | "%c" | "%cm" | "%sm" | "%x" | "%y";
export type Length = "fill" | "default" | { coeff: number; unit: Unit }[];

export interface AxisContext {
  parent: number;
  ownWidth?: number;
  ownHeight?: number;
  children?: number;
  childrenMax?: number;
  siblingMax?: number;
  natural?: number;
}

/** A size/offset element: a number is pixels, a string an expression, anything else `default`. */
export function lengthOf(value: Json | undefined): Length {
  if (typeof value === "number") return [{ coeff: value, unit: "px" }];
  if (typeof value === "string") return parseLength(value);
  return "default";
}

/**
 * Parses "100% - 4px", "50%c + 2px" and friends. Same rules as the game: a sign
 * sticks until the next one and a number without a unit is dropped.
 */
export function parseLength(input: string): Length {
  const text = input.trim().toLowerCase();
  if (text === "fill" || text === "default") return text;
  const terms: { coeff: number; unit: Unit }[] = [];
  const re = /\s*(?:([+-])|(\d*\.?\d+)\s*(px|%cm|%sm|%c|%x|%y|%)?)/gy;
  let sign = 1;
  let match;
  while ((match = re.exec(text)) && match[0]) {
    if (match[1]) sign = match[1] === "-" ? -1 : 1;
    else if (match[3]) terms.push({ coeff: sign * Number(match[2]), unit: match[3] as Unit });
  }
  return terms;
}

export function usesUnit(length: Length, unit: Unit): boolean {
  return Array.isArray(length) && length.some((t) => t.unit === unit);
}

/** Pixels for a length. `fill` falls back to the parent axis, the stack solver handles it before this. */
export function evalLength(length: Length, ctx: AxisContext): number {
  if (length === "fill") return ctx.parent;
  if (length === "default") return ctx.natural ?? ctx.parent;
  let total = 0;
  for (const { coeff, unit } of length) {
    if (coeff === 0) continue;
    const pct = (v: number | undefined) => (coeff * (v ?? 0)) / 100;
    switch (unit) {
      case "px":
        total += coeff;
        break;
      case "%":
        total += pct(ctx.parent);
        break;
      case "%c":
        total += pct(ctx.children);
        break;
      // the coefficient only gates these two, the max itself is what counts
      case "%cm":
        total += ctx.childrenMax ?? 0;
        break;
      case "%sm":
        total += ctx.siblingMax ?? 0;
        break;
      case "%x":
        total += pct(ctx.ownWidth);
        break;
      case "%y":
        total += pct(ctx.ownHeight);
        break;
    }
  }
  return total;
}
