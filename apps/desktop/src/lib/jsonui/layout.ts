import type { Lang } from "./catalog";
import type { TextureSource } from "./paint";
import { evalLength, lengthOf, usesUnit, type AxisContext, type Length } from "./length";
import type { Json, JsonObject } from "./parse";
import type { UiNode } from "./resolve";
import { fontScale, LINE_HEIGHT, labelText, measureLine, wrapText } from "./text";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  node: UiNode;
  rect: Rect;
  /** Absolute layer, the sum of every ancestor's `layer`. */
  layer: number;
  clip: Rect | null;
  children: Placed[];
  /** Set on scroll views, how far the content is scrolled and how far it can go. */
  scroll?: { offset: number; max: number };
}

export interface Interaction {
  /** Path of the interactive control under the pointer. */
  hover: string | null;
  pressed: boolean;
  /** Toggles and dropdowns the user clicked, by path. Each click flips the bound state. */
  checked: ReadonlySet<string>;
  /** Scroll offset per scroll_view path, in ui pixels. */
  scroll: ReadonlyMap<string, number>;
}

export interface LayoutOptions {
  width: number;
  height: number;
  lang: Lang;
  interaction: Interaction;
  /** Gives `default` sized images their texture size once it's known. */
  textures: TextureSource | null;
}

type Axis = 0 | 1;
type Size = [number, number];

export const INTERACTIVE_TYPES = new Set(["button", "toggle", "dropdown", "edit_box", "slider"]);

// engine controlled state children, each type shows exactly one of these at a time
const BUTTON_STATES = ["default", "hover", "pressed", "locked"] as const;
const TOGGLE_STATES = [
  "unchecked",
  "checked",
  "unchecked_hover",
  "checked_hover",
  "unchecked_locked",
  "checked_locked",
  "unchecked_locked_hover",
  "checked_locked_hover",
] as const;
const SLIDER_BOX_STATES = ["default", "hover", "indent", "locked"] as const;

export function layoutScene(root: UiNode, options: LayoutOptions): Placed {
  return new Layout(options).place(root, { x: 0, y: 0, w: options.width, h: options.height }, 0, null);
}

const num = (value: Json | undefined) => (typeof value === "number" ? value : undefined);

function sizeLengths(props: JsonObject, key = "size"): [Length, Length] | null {
  const value = props[key];
  if (!Array.isArray(value)) return key === "size" ? ["default", "default"] : null;
  return [lengthOf(value[0]), lengthOf(value[1])];
}

function anchor(value: Json | undefined): Size {
  const name = typeof value === "string" ? value : "center";
  return [
    name.includes("left") ? 0 : name.includes("right") ? 1 : 0.5,
    name.includes("top") ? 0 : name.includes("bottom") ? 1 : 0.5,
  ];
}

function stackAxis(node: UiNode): Axis | null {
  if (node.type !== "stack_panel") return null;
  return node.props.orientation === "horizontal" ? 0 : 1;
}

class Layout {
  constructor(private readonly options: LayoutOptions) {}

  place(node: UiNode, rect: Rect, layer: number, clip: Rect | null): Placed {
    const ownClip = node.props.clips_children === true ? intersect(clip, rect) : clip;
    const children = this.visibleChildren(node);
    const rects = this.childRects(node, children, rect);
    const placed: Placed = {
      node,
      rect,
      layer,
      clip,
      children: children.map((child, i) =>
        this.place(child, rects[i], layer + (num(child.props.layer) ?? 0), ownClip),
      ),
    };
    if (node.type === "slider") this.settleSlider(placed);
    if (node.type === "scroll_view") this.settleScroll(placed);
    return placed;
  }

  // the box slides along the bar by the bound value, the progress fill grows with it
  private settleSlider(slider: Placed) {
    const raw = slider.node.props["#slider_value"];
    const value = Math.max(0, Math.min(1, typeof raw === "number" ? raw : 0));
    const boxName = typeof slider.node.props.slider_box_control === "string" ? slider.node.props.slider_box_control : "slider_box";
    const box = slider.children.find((c) => c.node.name === boxName);
    if (box) {
      const x = slider.rect.x + value * (slider.rect.w - box.rect.w);
      this.replace(slider, box, { ...box.rect, x });
    }
    const progressName = slider.node.props.progress_control;
    const progress = typeof progressName === "string" ? findPlaced(slider, (p) => p.node.name === progressName) : null;
    if (progress) {
      const parent = findParent(slider, progress);
      if (parent) this.replace(parent, progress, { ...progress.rect, w: progress.rect.w * value });
    }
  }

  // scroll views move their content inside the viewport and size the box to how much of it shows
  private settleScroll(view: Placed) {
    const p = view.node.props;
    const named = (key: string, fallback: string) => {
      const name = typeof p[key] === "string" ? (p[key] as string) : fallback;
      return findPlaced(view, (c) => c.node.name === name);
    };
    const port = named("scroll_view_port", "scrolling_view_port");
    const content = named("scroll_content", "scrolling_content");
    if (!port || !content) return;
    const max = Math.max(0, content.rect.h - port.rect.h);
    const offset = Math.max(0, Math.min(max, this.options.interaction.scroll.get(view.node.path) ?? 0));
    view.scroll = { offset, max };
    if (offset > 0) {
      const parent = findParent(view, content);
      if (parent) this.replace(parent, content, { ...content.rect, y: content.rect.y - offset });
    }
    const box = named("scrollbar_box", "box");
    const track = named("scrollbar_track", "track");
    if (!box || !track || content.rect.h <= 0) return;
    const ratio = Math.min(1, port.rect.h / content.rect.h);
    const h = Math.max(Math.min(track.rect.h, 8), track.rect.h * ratio);
    const y = track.rect.y + (max > 0 ? (track.rect.h - h) * (offset / max) : 0);
    const parent = findParent(view, box);
    if (parent) this.replace(parent, box, { ...box.rect, y, h });
  }

  /** Lays a placed child out again at a new rect and swaps it into its parent. */
  private replace(parent: Placed, child: Placed, rect: Rect) {
    const index = parent.children.indexOf(child);
    if (index !== -1) parent.children[index] = this.place(child.node, rect, child.layer, child.clip);
  }

  /** Drops hidden controls and the state children that don't match the control's current state. */
  visibleChildren(node: UiNode): UiNode[] {
    const visible = node.children.filter((c) => c.props.visible !== false);
    const state = this.stateNames(node);
    if (!state) return visible;
    const { show, hide } = state;
    // a template with no child for this state falls back to its plain look
    const target = visible.some((c) => c.name === show.primary) ? show.primary : show.fallback;
    return visible.filter((c) => c.name === target || !hide.has(c.name));
  }

  private isHovered(node: UiNode): boolean {
    const { hover } = this.options.interaction;
    if (!hover) return false;
    // a slider box lights up with the slider it sits in
    return hover === node.path || (node.type === "slider_box" && node.path.startsWith(`${hover}/`));
  }

  private stateNames(node: UiNode) {
    const p = node.props;
    const names = <K extends string>(keys: readonly K[]) =>
      Object.fromEntries(keys.map((k) => [k, typeof p[`${k}_control`] === "string" ? (p[`${k}_control`] as string) : k])) as Record<K, string>;
    const pack = (all: Record<string, string>, primary: string, fallback: string) => ({
      show: { primary, fallback },
      hide: new Set(Object.values(all)),
    });
    const hovered = this.isHovered(node);
    const locked = p.enabled === false;
    switch (node.type) {
      case "button":
      case "edit_box": {
        const n = names(BUTTON_STATES);
        const pressed = hovered && this.options.interaction.pressed;
        return pack(n, locked ? n.locked : pressed ? n.pressed : hovered ? n.hover : n.default, n.default);
      }
      case "toggle":
      case "dropdown": {
        const n = names(TOGGLE_STATES);
        const bound = p["#toggle_state"] === true || p["#toggle_state"] === 1 || p.toggle_default_state === true;
        const on = this.options.interaction.checked.has(node.path) !== bound;
        const prefix = on ? "checked" : "unchecked";
        const key = `${prefix}${locked ? "_locked" : ""}${hovered ? "_hover" : ""}` as keyof typeof n;
        return pack(n, n[key], n[prefix]);
      }
      case "slider": {
        if (typeof p.default_control !== "string") return null;
        const n = names(["default", "hover"] as const);
        return pack(n, hovered ? n.hover : n.default, n.default);
      }
      case "slider_box": {
        const n = names(SLIDER_BOX_STATES);
        return pack(n, locked ? n.locked : hovered ? n.hover : n.default, n.default);
      }
      default:
        return null;
    }
  }

  private childRects(node: UiNode, children: UiNode[], rect: Rect): Rect[] {
    const extent: Size = [rect.w, rect.h];
    const main = stackAxis(node);
    if (main !== null) return this.stackRects(node, children, rect, main);
    const sizes = this.sizes(children, extent);
    if (node.type === "grid") {
      return children.map((child, i) => {
        const [col, row] = Array.isArray(child.props.grid_position) ? child.props.grid_position : [0, 0];
        const [w, h] = sizes[i];
        return { x: rect.x + (num(col) ?? 0) * w, y: rect.y + (num(row) ?? 0) * h, w, h };
      });
    }
    return children.map((child, i) => {
      const [w, h] = sizes[i];
      const from = anchor(child.props.anchor_from);
      const to = anchor(child.props.anchor_to);
      const offset = sizeLengths(child.props, "offset");
      const ox = offset ? evalLength(offset[0], { parent: rect.w, ownWidth: w, ownHeight: h }) : 0;
      const oy = offset ? evalLength(offset[1], { parent: rect.h, ownWidth: w, ownHeight: h }) : 0;
      return {
        x: rect.x + rect.w * from[0] - w * to[0] + ox,
        y: rect.y + rect.h * from[1] - h * to[1] + oy,
        w,
        h,
      };
    });
  }

  // stack children pack along the main axis, `fill` ones split whatever is left
  private stackRects(node: UiNode, children: UiNode[], rect: Rect, main: Axis): Rect[] {
    const extent: Size = [rect.w, rect.h];
    const isFill = (c: UiNode) => sizeLengths(c.props)?.[main] === "fill";
    const sizes = this.sizes(children, extent);
    const taken = children.reduce((sum, c, i) => (isFill(c) ? sum : sum + sizes[i][main]), 0);
    const fills = children.filter(isFill).length;
    const share = Math.max(0, (extent[main] - taken) / Math.max(1, fills));
    children.forEach((c, i) => {
      if (isFill(c)) sizes[i][main] = this.clamp(c, main, share, extent[main]);
    });
    const childAnchors = node.props.use_child_anchors === true;
    const cross: Axis = main === 0 ? 1 : 0;
    let cursor = 0;
    return children.map((child, i) => {
      const size = sizes[i];
      const at: Size = [0, 0];
      at[main] = cursor;
      if (childAnchors) {
        const from = anchor(child.props.anchor_from);
        const to = anchor(child.props.anchor_to);
        at[cross] = extent[cross] * from[cross] - size[cross] * to[cross];
      }
      cursor += size[main];
      return { x: rect.x + at[0], y: rect.y + at[1], w: size[0], h: size[1] };
    });
  }

  /** Sizes of a set of siblings. Two passes so `%sm` can see the others. */
  private sizes(children: UiNode[], extent: Size): Size[] {
    const sizes = children.map((c) => this.measure(c, extent));
    const usesSm = (c: UiNode) => {
      const l = sizeLengths(c.props);
      return !!l && (usesUnit(l[0], "%sm") || usesUnit(l[1], "%sm"));
    };
    if (!children.some(usesSm)) return sizes;
    const max: Size = [0, 0];
    children.forEach((c, i) => {
      if (usesSm(c)) return;
      max[0] = Math.max(max[0], sizes[i][0]);
      max[1] = Math.max(max[1], sizes[i][1]);
    });
    return children.map((c, i) => (usesSm(c) ? this.measure(c, extent, max) : sizes[i]));
  }

  measure(node: UiNode, extent: Size, siblingMax?: Size): Size {
    const lengths = sizeLengths(node.props) ?? ["default", "default"];
    const own: [number | undefined, number | undefined] = [undefined, undefined];
    const dependsOnKids = (axis: Axis) => usesUnit(lengths[axis], "%c") || usesUnit(lengths[axis], "%cm");
    let kids: Size[] | null = null;
    const kidSizes = () => {
      kids ??= this.sizes(this.visibleChildren(node), [own[0] ?? 0, own[1] ?? 0]);
      return kids;
    };

    const solve = (axis: Axis) => {
      const ctx: AxisContext = {
        parent: extent[axis],
        ownWidth: own[0],
        ownHeight: own[1],
        siblingMax: siblingMax?.[axis],
      };
      if (dependsOnKids(axis)) {
        const sizes = kidSizes();
        const values = sizes.map((s) => s[axis]);
        ctx.childrenMax = Math.max(0, ...values);
        ctx.children = stackAxis(node) === axis ? values.reduce((a, b) => a + b, 0) : ctx.childrenMax;
      }
      if (lengths[axis] === "default") {
        // a stack panel's natural length along its axis is its children laid end to end
        ctx.natural =
          stackAxis(node) === axis
            ? this.sizes(this.visibleChildren(node), [own[0] ?? 0, own[1] ?? 0]).reduce((sum, s) => sum + s[axis], 0)
            : this.natural(node, axis, own);
      }
      own[axis] = this.clamp(node, axis, evalLength(lengths[axis], ctx), extent[axis], ctx);
    };

    // a %y width needs the height first, otherwise width goes first so labels can wrap
    const heightFirst =
      (usesUnit(lengths[0], "%y") && !usesUnit(lengths[1], "%x")) ||
      (node.type === "image" && lengths[0] === "default" && lengths[1] !== "default");
    if (heightFirst) {
      solve(1);
      solve(0);
    } else {
      solve(0);
      solve(1);
    }
    return [Math.max(0, own[0] ?? 0), Math.max(0, own[1] ?? 0)];
  }

  private natural(node: UiNode, axis: Axis, own: [number | undefined, number | undefined]): number | undefined {
    if (node.type === "image") return this.ratioSize(node, axis, own);
    const knownWidth = own[0];
    if (node.type !== "label") return undefined;
    const text = labelText(node.props, this.options.lang);
    const scale = fontScale(node.props);
    if (axis === 0) return Math.max(0, ...text.split("\n").map((line) => measureLine(line, scale)));
    const wrapAt = sizeLengths(node.props)?.[0] === "default" ? undefined : knownWidth;
    return wrapText(text, scale, wrapAt).length * LINE_HEIGHT * scale;
  }

  /**
   * An image only has a natural length when its other axis is set: the default
   * axis then follows the texture's aspect ratio. Fully default images fill the parent.
   */
  private ratioSize(node: UiNode, axis: Axis, own: [number | undefined, number | undefined]): number | undefined {
    const lengths = sizeLengths(node.props) ?? ["default", "default"];
    const other: Axis = axis === 0 ? 1 : 0;
    if (lengths[other] === "default") return undefined;
    const path = node.props.texture;
    const texture = typeof path === "string" && !path.startsWith("#") ? this.options.textures?.get(path) : null;
    if (!texture) return undefined;
    const uvSize = Array.isArray(node.props.uv_size) ? node.props.uv_size : null;
    const dim = (a: Axis) => (typeof uvSize?.[a] === "number" ? (uvSize[a] as number) : texture.base[a]);
    if (dim(other) <= 0) return undefined;
    const known = own[other];
    return known === undefined ? undefined : known * (dim(axis) / dim(other));
  }

  private clamp(node: UiNode, axis: Axis, value: number, parent: number, ctx: AxisContext = { parent }): number {
    const min = sizeLengths(node.props, "min_size");
    const max = sizeLengths(node.props, "max_size");
    let out = value;
    if (max && max[axis] !== "default") out = Math.min(out, evalLength(max[axis], ctx));
    if (min && min[axis] !== "default") out = Math.max(out, evalLength(min[axis], ctx));
    return out;
  }
}

export function intersect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

export function findPlaced(root: Placed, match: (p: Placed) => boolean): Placed | null {
  for (const child of root.children) {
    if (match(child)) return child;
    const found = findPlaced(child, match);
    if (found) return found;
  }
  return null;
}

function findParent(root: Placed, target: Placed): Placed | null {
  if (root.children.includes(target)) return root;
  for (const child of root.children) {
    const found = findParent(child, target);
    if (found) return found;
  }
  return null;
}

/** Deepest scroll view under a point, the one the mouse wheel should move. */
export function scrollViewAt(root: Placed, x: number, y: number): Placed | null {
  let best: Placed | null = null;
  const visit = (p: Placed) => {
    const r = p.rect;
    if (p.scroll && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) best = p;
    p.children.forEach(visit);
  };
  visit(root);
  return best;
}

/** Topmost interactive control under a point, the one a click would hit. */
export function hitTest(root: Placed, x: number, y: number): Placed | null {
  let best: Placed | null = null;
  const visit = (p: Placed) => {
    const inside = (r: Rect) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    if (INTERACTIVE_TYPES.has(p.node.type) && inside(p.rect) && (!p.clip || inside(p.clip))) {
      if (!best || p.layer >= best.layer) best = p;
    }
    p.children.forEach(visit);
  };
  visit(root);
  return best;
}

/** Deepest control of any kind under a point, for the inspector tooltip. */
export function pickAt(root: Placed, x: number, y: number): Placed | null {
  let best: Placed | null = null;
  const visit = (p: Placed) => {
    const r = p.rect;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && (!best || p.layer >= best.layer)) best = p;
    p.children.forEach(visit);
  };
  visit(root);
  return best;
}
