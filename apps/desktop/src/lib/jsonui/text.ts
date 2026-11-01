import boldUrl from "../../fonts/minecraft/Minecraft-Bold.otf?url";
import regularUrl from "../../fonts/minecraft/Minecraft.otf?url";
import type { Lang } from "./catalog";
import type { JsonObject } from "./parse";

/** Glyph box at font scale 1, in ui pixels. */
export const FONT_PX = 8;
export const LINE_HEIGHT = 10;
const FONT_SIZE_SCALES: Record<string, number> = { small: 0.5, normal: 1, large: 2, extra_large: 4 };

// the Minecraft font draws one glyph pixel per 2 font units on an 18 unit em, so 9px css is 1:1
const EM_PX = 9;
/** Distance from the top of a line box to the glyph baseline, in ui pixels at scale 1. */
export const BASELINE = 8;
const FAMILY = "Minecraft";
export const FONT_FAMILY = `"${FAMILY}", monospace`;

let fontPromise: Promise<void> | null = null;

/** Loads the bundled Minecraft font. Resolves either way, text falls back to monospace on failure. */
export function loadFont(): Promise<void> {
  fontPromise ??= Promise.all([
    new FontFace(FAMILY, `url(${regularUrl})`, { weight: "400" }).load(),
    new FontFace(FAMILY, `url(${boldUrl})`, { weight: "700" }).load(),
  ])
    .then((faces) => faces.forEach((face) => document.fonts.add(face)))
    .catch(() => {});
  return fontPromise;
}

export const FORMAT_COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#c6c6c6",
  "8": "#555555",
  "9": "#5555ff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
  g: "#ddd605",
};

export interface Run {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
}

export function fontScale(props: JsonObject): number {
  const factor = typeof props.font_scale_factor === "number" && props.font_scale_factor > 0 ? props.font_scale_factor : 1;
  const step = typeof props.font_size === "string" ? FONT_SIZE_SCALES[props.font_size] ?? 1 : 1;
  return factor * step;
}

export function fontCss(scale: number, bold = false, italic = false): string {
  return `${italic ? "italic " : ""}${bold ? 700 : 400} ${EM_PX * scale}px ${FONT_FAMILY}`;
}

/** Splits § formatting codes into styled runs. Colours reset bold and italic, like in game. */
export function formatRuns(text: string): Run[] {
  const runs: Run[] = [];
  let current: Run = { text: "", color: null, bold: false, italic: false };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "§" && i + 1 < text.length) {
      const code = text[++i].toLowerCase();
      if (current.text) runs.push(current);
      const base = { text: "", color: current.color, bold: current.bold, italic: current.italic };
      if (code in FORMAT_COLORS) current = { ...base, color: FORMAT_COLORS[code], bold: false, italic: false };
      else if (code === "l") current = { ...base, bold: true };
      else if (code === "o") current = { ...base, italic: true };
      else if (code === "r") current = { text: "", color: null, bold: false, italic: false };
      else current = base;
      continue;
    }
    current.text += text[i];
  }
  if (current.text) runs.push(current);
  return runs;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of a line in ui pixels at the given scale. */
export function measureLine(line: string, scale: number): number {
  if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return line.length * FONT_PX * 0.6 * scale;
  let width = 0;
  for (const run of formatRuns(line)) {
    measureCtx.font = fontCss(scale, run.bold, run.italic);
    width += measureCtx.measureText(run.text).width;
  }
  return width;
}

/** Breaks text into lines, wrapping words at maxWidth when one is given. */
export function wrapText(text: string, scale: number, maxWidth?: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (maxWidth === undefined || maxWidth <= 0) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureLine(next, scale) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Label text with localisation applied. A #binding has no data here, so it draws empty. */
export function labelText(props: JsonObject, lang: Lang): string {
  const raw = props.text;
  if (typeof raw !== "string" || raw.startsWith("#")) return "";
  if (props.localize === false) return raw;
  return lang.get(raw) ?? raw;
}
