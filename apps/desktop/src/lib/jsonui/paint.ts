import type { Lang } from "./catalog";
import type { Interaction, Placed, Rect } from "./layout";
import type { Json, JsonObject } from "./parse";
import { ninesliceOf, type Texture } from "./vanilla";
import { BASELINE, fontCss, fontScale, formatRuns, LINE_HEIGHT, labelText, wrapText } from "./text";

export interface PaintOptions {
  /** Canvas pixels per ui pixel. */
  scale: number;
  lang: Lang;
  interaction: Interaction;
  showBounds: boolean;
  highlight: Placed | null;
  /** Null when vanilla resources aren't loaded, images then only draw White and Black. */
  textures: TextureSource | null;
}

export interface TextureSource {
  get(path: string): Texture | null | undefined;
}

type Rgba = [number, number, number, number];

const NAMED_COLORS: Record<string, Rgba> = {
  white: [1, 1, 1, 1],
  black: [0, 0, 0, 1],
  red: [1, 0.33, 0.33, 1],
  green: [0.33, 1, 0.33, 1],
  blue: [0.33, 0.33, 1, 1],
  yellow: [1, 1, 0.33, 1],
  gray: [0.55, 0.55, 0.55, 1],
  grey: [0.55, 0.55, 0.55, 1],
};

/** Colour props are [r, g, b(, a)] in 0..1, a hex string or one of a few names. */
export function parseColor(value: Json | undefined): Rgba | null {
  if (Array.isArray(value) && value.length >= 3 && value.every((v) => typeof v === "number")) {
    const [r, g, b, a = 1] = value as number[];
    return [r, g, b, a];
  }
  if (typeof value !== "string") return null;
  if (value in NAMED_COLORS) return NAMED_COLORS[value];
  const hex = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
}

const css = ([r, g, b, a]: Rgba) => `rgb(${r * 255} ${g * 255} ${b * 255} / ${a})`;
const multiply = (a: Rgba, b: Rgba): Rgba => [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];

/** Paints a laid out scene. The context must already be scaled to ui pixels. */
export function paintScene(ctx: CanvasRenderingContext2D, root: Placed, options: PaintOptions) {
  ctx.imageSmoothingEnabled = false;
  const items: Placed[] = [];
  const collect = (p: Placed) => {
    items.push(p);
    p.children.forEach(collect);
  };
  collect(root);
  // sort is stable, so equal layers keep tree order like the game does
  items.sort((a, b) => a.layer - b.layer);

  for (const item of items) {
    const { rect, clip } = item;
    if (rect.w <= 0 || rect.h <= 0 || (clip && (clip.w <= 0 || clip.h <= 0))) continue;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
    }
    const alpha = typeof item.node.props.alpha === "number" ? item.node.props.alpha : 1;
    if (seeThrough(item, alpha, options.textures)) blurBehind(ctx, rect);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    paintControl(ctx, item, options);
    ctx.restore();
  }

  if (options.showBounds) {
    ctx.lineWidth = 1 / options.scale;
    ctx.strokeStyle = "rgb(167 139 250 / 0.55)";
    for (const { rect } of items) ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (options.highlight) {
    const { rect } = options.highlight;
    ctx.fillStyle = "rgb(56 189 248 / 0.18)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.lineWidth = 1 / options.scale;
    ctx.strokeStyle = "rgb(56 189 248)";
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
}

function paintControl(ctx: CanvasRenderingContext2D, item: Placed, options: PaintOptions) {
  const { node, rect } = item;
  if (node.type === "image") paintImage(ctx, rect, node.props, options.textures);
  else if (node.type === "label") paintLabel(ctx, rect, node.props, options);
}

function paintImage(ctx: CanvasRenderingContext2D, rect: Rect, props: JsonObject, textures: TextureSource | null) {
  const path = typeof props.texture === "string" ? props.texture : "";
  // a #binding texture has nothing behind it in the preview
  if (!path || path.startsWith("#")) return;
  const tint = parseColor(props.color) ?? [1, 1, 1, 1];
  const texture = textures?.get(path);
  if (texture === undefined) {
    // still downloading, or vanilla isn't available at all. White and Black are plain fills either way
    const name = path.split("/").pop()?.toLowerCase();
    if (name !== "white" && name !== "black") return;
    const base: Rgba = name === "white" ? [1, 1, 1, 1] : [0, 0, 0, 1];
    ctx.fillStyle = css(multiply(base, tint));
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (texture === null) {
    missing(ctx, rect);
    return;
  }
  drawTexture(ctx, rect, texture, props, tint);
}

const tintCache = new WeakMap<ImageBitmap, Map<string, HTMLCanvasElement>>();

// multiply keeps the texture's shading, destination-in puts its alpha back afterwards
function tinted(image: ImageBitmap, tint: Rgba): CanvasImageSource {
  if (tint[0] === 1 && tint[1] === 1 && tint[2] === 1) return image;
  const key = tint.slice(0, 3).join(",");
  let byColor = tintCache.get(image);
  if (!byColor) tintCache.set(image, (byColor = new Map()));
  const hit = byColor.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const c = canvas.getContext("2d");
  if (!c) return image;
  c.drawImage(image, 0, 0);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = css([tint[0], tint[1], tint[2], 1]);
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(image, 0, 0);
  byColor.set(key, canvas);
  return canvas;
}

function pair(value: Json | undefined): [number, number] | null {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number"
    ? [value[0], value[1]]
    : null;
}

/**
 * Draws a texture into rect. uv, uv_size and nineslice are in base_size pixels,
 * so hi-res packs map back through the image/base ratio.
 */
function drawTexture(ctx: CanvasRenderingContext2D, rect: Rect, texture: Texture, props: JsonObject, tint: Rgba) {
  const source = tinted(texture.image, tint);
  const kx = texture.image.width / texture.base[0];
  const ky = texture.image.height / texture.base[1];
  const uv = pair(props.uv) ?? [0, 0];
  const uvSize = pair(props.uv_size) ?? texture.base;
  const sx = uv[0] * kx;
  const sy = uv[1] * ky;
  const sw = uvSize[0] * kx;
  const sh = uvSize[1] * ky;
  ctx.globalAlpha *= tint[3];

  if (props.tiled === true || props.tiled === "x" || props.tiled === "y") {
    const tileW = props.tiled === "y" ? rect.w : uvSize[0];
    const tileH = props.tiled === "x" ? rect.h : uvSize[1];
    for (let y = 0; y < rect.h; y += tileH) {
      for (let x = 0; x < rect.w; x += tileW) {
        const w = Math.min(tileW, rect.w - x);
        const h = Math.min(tileH, rect.h - y);
        ctx.drawImage(source, sx, sy, (sw * w) / tileW, (sh * h) / tileH, rect.x + x, rect.y + y, w, h);
      }
    }
    return;
  }

  const slice = ninesliceOf(props.nineslice_size) ?? texture.nineslice;
  if (!slice) {
    ctx.drawImage(source, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  // corners keep their size, edges stretch along one axis, the middle along both
  const [l, t, r, b] = slice;
  const dl = Math.min(l, rect.w / 2);
  const dr = Math.min(r, rect.w / 2);
  const dt = Math.min(t, rect.h / 2);
  const db = Math.min(b, rect.h / 2);
  const srcX = [sx, sx + l * kx, sx + sw - r * kx, sx + sw];
  const srcY = [sy, sy + t * ky, sy + sh - b * ky, sy + sh];
  const dstX = [rect.x, rect.x + dl, rect.x + rect.w - dr, rect.x + rect.w];
  const dstY = [rect.y, rect.y + dt, rect.y + rect.h - db, rect.y + rect.h];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const w = srcX[col + 1] - srcX[col];
      const h = srcY[row + 1] - srcY[row];
      const dw = dstX[col + 1] - dstX[col];
      const dh = dstY[row + 1] - dstY[row];
      if (w <= 0 || h <= 0 || dw <= 0 || dh <= 0) continue;
      ctx.drawImage(source, srcX[col], srcY[row], w, h, dstX[col], dstY[row], dw, dh);
    }
  }
}

function missing(ctx: CanvasRenderingContext2D, r: Rect) {
  const cell = 4;
  for (let y = 0; y < r.h; y += cell) {
    for (let x = 0; x < r.w; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#f800f8" : "#000000";
      ctx.fillRect(r.x + x, r.y + y, Math.min(cell, r.w - x), Math.min(cell, r.h - y));
    }
  }
}

function paintLabel(ctx: CanvasRenderingContext2D, rect: Rect, props: JsonObject, options: PaintOptions) {
  const text = labelText(props, options.lang);
  if (!text) return;
  const scale = fontScale(props);
  const color = parseColor(props.color) ?? [1, 1, 1, 1];
  const align = props.text_alignment === "center" || props.text_alignment === "right" ? props.text_alignment : "left";
  const wraps = Array.isArray(props.size) && props.size[0] !== "default";
  const lines = wrapText(text, scale, wraps ? rect.w : undefined);
  const lineHeight = LINE_HEIGHT * scale;
  const baseline = BASELINE * scale;
  const shadow = props.shadow === true;
  ctx.textBaseline = "alphabetic";

  lines.forEach((line, index) => {
    const runs = formatRuns(line);
    const widths = runs.map((run) => {
      ctx.font = fontCss(scale, run.bold, run.italic);
      return ctx.measureText(run.text).width;
    });
    const total = widths.reduce((a, b) => a + b, 0);
    let x = align === "center" ? rect.x + (rect.w - total) / 2 : align === "right" ? rect.x + rect.w - total : rect.x;
    const y = rect.y + index * lineHeight + baseline;
    runs.forEach((run, i) => {
      ctx.font = fontCss(scale, run.bold, run.italic);
      const runColor = run.color ? (parseColor(run.color) ?? color) : color;
      if (shadow) {
        // yeah, the game's text shadow is the same colour at a quarter brightness
        ctx.fillStyle = css([runColor[0] / 4, runColor[1] / 4, runColor[2] / 4, runColor[3]]);
        ctx.fillText(run.text, x + scale, y + scale);
      }
      ctx.fillStyle = css(runColor);
      ctx.fillText(run.text, x, y);
      x += widths[i];
    });
  });
}

const BLUR_RADIUS = 2;
const BLUR_MIN_SIZE = 16;

// a big translucent fill (the dark middle of hollow dialogs) frosts whatever is behind it
function seeThrough(item: Placed, alpha: number, textures: TextureSource | null): boolean {
  const { node, rect } = item;
  if (node.type !== "image" || rect.w < BLUR_MIN_SIZE || rect.h < BLUR_MIN_SIZE) return false;
  const path = node.props.texture;
  if (typeof path !== "string" || !textures?.get(path)) return false;
  const tint = parseColor(node.props.color)?.[3] ?? 1;
  return alpha * tint > 0 && alpha * tint < 1;
}

/** Blurs the already painted pixels under rect, in device pixels so the radius doesn't scale twice. */
function blurBehind(ctx: CanvasRenderingContext2D, rect: Rect) {
  const m = ctx.getTransform();
  const x = Math.floor(rect.x * m.a + m.e);
  const y = Math.floor(rect.y * m.d + m.f);
  const w = Math.ceil(rect.w * m.a);
  const h = Math.ceil(rect.h * m.d);
  const radius = BLUR_RADIUS * m.a;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
  ctx.restore();
}

const PANORAMA = "textures/ui/panorama_0";

/**
 * The world behind a screen. With vanilla loaded that's the title panorama,
 * otherwise a dusk gradient that reads closer to a paused game than a flat colour.
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, textures: TextureSource | null) {
  const panorama = textures?.get(PANORAMA);
  if (panorama) {
    // cover the screen like the menu background does, cropping whatever sticks out
    const { width: iw, height: ih } = panorama.image;
    const scale = Math.max(width / iw, height / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(panorama.image, (width - w) / 2, (height - h) / 2, w, h);
    ctx.imageSmoothingEnabled = false;
    return;
  }
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#26304a");
  sky.addColorStop(0.6, "#3b4a63");
  sky.addColorStop(0.6, "#2f3d22");
  sky.addColorStop(1, "#1d2614");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgb(0 0 0 / 0.35)";
  ctx.fillRect(0, 0, width, height);
}
