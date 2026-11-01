import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { CircleAlert, Download, Loader, Scan } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { Catalog, parseLang, type Definition } from "../lib/jsonui/catalog";
import { hitTest, layoutScene, pickAt, scrollViewAt, type Interaction, type Placed } from "../lib/jsonui/layout";
import { paintBackdrop, paintScene } from "../lib/jsonui/paint";
import { resolveControl } from "../lib/jsonui/resolve";
import { loadFont } from "../lib/jsonui/text";
import { loadVanillaCatalog, VANILLA_VERSION, vanillaTextures } from "../lib/jsonui/vanilla";
import { flattenFiles } from "../lib/tree";
import type { FileNode } from "../lib/types";
import { IconButton } from "./ui";

interface JsonUiPreviewProps {
  path: string;
  content: string;
  tree: FileNode[];
  /** Unsaved text of other open files, so edits elsewhere in the pack show up too. */
  openBuffers: Record<string, string>;
}

// "fit" follows the pane like the game follows its window, the rest are fixed ui sizes
const RESOLUTIONS = [
  { label: "Fit to pane", w: 0, h: 0 },
  { label: "320 × 180", w: 320, h: 180 },
  { label: "427 × 240", w: 427, h: 240 },
  { label: "480 × 270", w: 480, h: 270 },
  { label: "569 × 320", w: 569, h: 320 },
  { label: "320 × 240", w: 320, h: 240 },
];
// the game picks the largest gui scale that still leaves about this much ui space
const FIT_MIN = { w: 320, h: 200 };

const CONSENT_KEY = "wither.jsonui.vanilla";

type VanillaState =
  | { status: "ask" }
  | { status: "loading"; done: number; total: number }
  | { status: "ready"; catalog: Catalog }
  | { status: "error"; message: string };

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

/** Folder that holds the pack's ui/ directory, with a trailing slash (or "" at the root). */
function packRootOf(path: string): string {
  const index = path.lastIndexOf("ui/");
  return index === -1 ? "" : path.slice(0, index);
}

function pickDefault(defs: Definition[]): string | null {
  const screen = defs.find(
    (d) => d.props.type === "screen" || /screen/.test(d.name) || /screen/.test(d.base?.name ?? ""),
  );
  return (screen ?? defs[0])?.name ?? null;
}

const noInteraction: Interaction = { hover: null, pressed: false, checked: new Set(), scroll: new Map() };
// one wheel notch moves a vanilla scroll view by its scroll_speed, 15 ui pixels
const WHEEL_STEP = 15;

export function JsonUiPreview({ path, content, tree, openBuffers }: JsonUiPreviewProps) {
  const root = packRootOf(path);
  const packFiles = useMemo(() => {
    const files = flattenFiles(tree).map((f) => f.path);
    const ui = files.filter((p) => p.startsWith(`${root}ui/`) && p.endsWith(".json"));
    const langs = files.filter((p) => p.startsWith(`${root}texts/`) && p.endsWith(".lang"));
    const lang = langs.find((p) => p.endsWith("/en_US.lang")) ?? langs[0] ?? null;
    return { ui, lang };
  }, [tree, root]);

  const [disk, setDisk] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const wanted = [...packFiles.ui, ...(packFiles.lang ? [packFiles.lang] : [])].filter((p) => p !== path);
    Promise.all(wanted.map((p) => api.readFile(p).then((text) => [p, text] as const, () => null))).then((loaded) => {
      if (alive) setDisk(Object.fromEntries(loaded.filter((entry) => entry !== null)));
    });
    return () => {
      alive = false;
    };
  }, [packFiles, path]);

  const [vanilla, setVanilla] = useState<VanillaState>({ status: "ask" });
  const startVanilla = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "yes");
    } catch {
      // private storage, we'll just ask again next time
    }
    setVanilla({ status: "loading", done: 0, total: 0 });
    loadVanillaCatalog((done, total) => setVanilla({ status: "loading", done, total }))
      .then((catalog) => setVanilla({ status: "ready", catalog }))
      .catch((error) => setVanilla({ status: "error", message: errorMessage(error) }));
  };
  useEffect(() => {
    if (readConsent()) startVanilla();
  }, []);
  const vanillaCatalog = vanilla.status === "ready" ? vanilla.catalog : null;
  const textures = vanillaCatalog ? vanillaTextures : null;

  // textures and the font arrive after the first paint, both change sizes, so they bump a version
  const [assetVersion, setAssetVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setAssetVersion((v) => v + 1);
      });
    };
    void loadFont().then(bump);
    const unsubscribe = vanillaTextures.subscribe(bump);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, []);

  const textOf = (p: string) => (p === path ? content : (openBuffers[p] ?? disk[p]));
  const sources = packFiles.ui.map((p) => ({ path: p, text: textOf(p) ?? "" }));
  if (!packFiles.ui.includes(path)) sources.push({ path, text: content });
  const sourceKey = sources.map((s) => s.text).join("\u0000");
  const langText = packFiles.lang ? textOf(packFiles.lang) : undefined;

  const catalog = useMemo(
    () => new Catalog(sources, langText ? parseLang(langText) : new Map(), vanillaCatalog),
    // sources is rebuilt every render, its texts are what matter
    [sourceKey, langText, vanillaCatalog],
  );
  const defs = useMemo(() => catalog.controlsOf(path), [catalog, path]);
  const ns = catalog.namespaceOf(path);
  const fileIssue = catalog.issues.find((i) => i.path === path);

  const [chosen, setChosen] = useState<string | null>(null);
  const control = chosen && defs.some((d) => d.name === chosen) ? chosen : pickDefault(defs);
  const [resolution, setResolution] = useState(0);
  const [showBounds, setShowBounds] = useState(false);
  const [interaction, setInteraction] = useState<Interaction>(noInteraction);
  const [inspect, setInspect] = useState<Placed | null>(null);

  const resolved = useMemo(
    () => (ns && control ? resolveControl(catalog, { ns, name: control }) : null),
    [catalog, ns, control],
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) =>
      setHostSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const preset = RESOLUTIONS[resolution];
  let guiW: number, guiH: number, scale: number;
  if (preset.w === 0) {
    scale = Math.max(1, Math.floor(Math.min(hostSize.w / FIT_MIN.w, hostSize.h / FIT_MIN.h)));
    guiW = Math.max(1, Math.floor(hostSize.w / scale));
    guiH = Math.max(1, Math.floor(hostSize.h / scale));
  } else {
    guiW = preset.w;
    guiH = preset.h;
    // whole numbers keep the pixel art crisp, only go fractional when the pane is tiny
    const fit = Math.min(hostSize.w / guiW, hostSize.h / guiH);
    scale = fit >= 1 ? Math.floor(fit) : Math.max(0.1, fit);
  }

  const scene = useMemo(
    () =>
      resolved?.root
        ? layoutScene(resolved.root, { width: guiW, height: guiH, lang: catalog.lang, interaction, textures })
        : null,
    // assetVersion stands in for texture sizes and font metrics that changed under us
    [resolved, guiW, guiH, catalog, interaction, textures, assetVersion],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || hostSize.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(guiW * scale * dpr);
    canvas.height = Math.round(guiH * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    paintBackdrop(ctx, guiW, guiH, textures);
    if (scene) {
      paintScene(ctx, scene, {
        scale: scale * dpr,
        lang: catalog.lang,
        interaction,
        showBounds,
        highlight: inspect,
        textures,
      });
    }
  }, [scene, scale, guiW, guiH, hostSize.w, catalog, interaction, showBounds, inspect, textures]);

  const toUi = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * guiW, ((event.clientY - box.top) / box.height) * guiH] as const;
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!scene) return;
    const [x, y] = toUi(event);
    const hover = hitTest(scene, x, y)?.node.path ?? null;
    if (hover !== interaction.hover) setInteraction((s) => ({ ...s, hover }));
    setInspect(event.altKey ? pickAt(scene, x, y) : null);
  };

  const onPointerUp = () => {
    const target = interaction.hover;
    setInteraction((s) => {
      if (!s.pressed) return s;
      const checked = new Set(s.checked);
      const node = target && scene ? findPlaced(scene, target) : null;
      if ((node?.node.type === "toggle" || node?.node.type === "dropdown") && target) {
        if (checked.has(target)) checked.delete(target);
        else checked.add(target);
      }
      return { ...s, pressed: false, checked };
    });
  };

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!scene) return;
    const box = event.currentTarget.getBoundingClientRect();
    const view = scrollViewAt(scene, ((event.clientX - box.left) / box.width) * guiW, ((event.clientY - box.top) / box.height) * guiH);
    if (!view?.scroll) return;
    const next = Math.max(0, Math.min(view.scroll.max, view.scroll.offset + Math.sign(event.deltaY) * WHEEL_STEP));
    if (next === view.scroll.offset) return;
    setInteraction((s) => ({ ...s, scroll: new Map(s.scroll).set(view.node.path, next) }));
  };

  const missing = resolved?.missing ?? [];
  const inspected = inspect ?? (interaction.hover && scene ? findPlaced(scene, interaction.hover) : null);

  return (
    <div className="jsonui-preview">
      <div className="jsonui-toolbar">
        <select
          className="jsonui-select"
          value={control ?? ""}
          onChange={(e) => setChosen(e.target.value)}
          disabled={defs.length === 0}
          aria-label="Control to preview"
        >
          {defs.map((d) => (
            <option key={d.name} value={d.name}>
              {d.base ? `${d.name} @ ${d.base.ns === ns ? d.base.name : `${d.base.ns}.${d.base.name}`}` : d.name}
            </option>
          ))}
        </select>
        <select
          className="jsonui-select"
          value={resolution}
          onChange={(e) => setResolution(Number(e.target.value))}
          aria-label="Screen size"
        >
          {RESOLUTIONS.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="jsonui-toolbar-spacer" />
        <IconButton label="Show control bounds" active={showBounds} onClick={() => setShowBounds((v) => !v)}>
          <Scan size={14} />
        </IconButton>
      </div>

      {vanilla.status !== "ready" && (
        <div className="jsonui-banner">
          {vanilla.status === "ask" && (
            <>
              <span>
                Vanilla textures and templates aren't bundled. Download them from Mojang's bedrock-samples (
                {VANILLA_VERSION})?
              </span>
              <button type="button" className="jsonui-banner-action" onClick={startVanilla}>
                <Download size={13} />
                Download
              </button>
            </>
          )}
          {vanilla.status === "loading" && (
            <span className="jsonui-banner-progress">
              <Loader size={13} className="spin" />
              Downloading vanilla resources {vanilla.total ? `${vanilla.done}/${vanilla.total}` : ""}
            </span>
          )}
          {vanilla.status === "error" && (
            <>
              <span className="jsonui-banner-error">Could not download vanilla resources: {vanilla.message}</span>
              <button type="button" className="jsonui-banner-action" onClick={startVanilla}>
                Retry
              </button>
            </>
          )}
        </div>
      )}

      <div className="jsonui-stage" ref={hostRef}>
        {fileIssue ? (
          <div className="jsonui-message">
            <CircleAlert size={18} />
            <span>{fileIssue.message}</span>
          </div>
        ) : defs.length === 0 ? (
          <div className="jsonui-message">No controls in this file yet.</div>
        ) : (
          <canvas
            ref={canvasRef}
            className="jsonui-canvas"
            style={{ width: guiW * scale, height: guiH * scale }}
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
              setInteraction((s) => ({ ...s, hover: null, pressed: false }));
              setInspect(null);
            }}
            onPointerDown={(e) => e.button === 0 && setInteraction((s) => ({ ...s, pressed: true }))}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
        )}
      </div>

      <div className="jsonui-footer">
        <span className="jsonui-footer-info">
          {inspected
            ? `${inspected.node.name} · ${inspected.node.type} · ${Math.round(inspected.rect.w)} × ${Math.round(inspected.rect.h)}`
            : `${guiW} × ${guiH} · gui scale ${Number.isInteger(scale) ? scale : scale.toFixed(2)} · hold Alt to inspect`}
        </span>
        {missing.length > 0 && (
          <span className="jsonui-footer-warn" title={missing.join("\n")}>
            <CircleAlert size={12} />
            {missing.length} unresolved {missing.length === 1 ? "reference" : "references"}
          </span>
        )}
      </div>
    </div>
  );
}

function findPlaced(root: Placed, path: string): Placed | null {
  if (root.node.path === path) return root;
  for (const child of root.children) {
    const found = findPlaced(child, path);
    if (found) return found;
  }
  return null;
}
