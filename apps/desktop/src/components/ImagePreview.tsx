import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, Loader, Maximize, Minus, Plus } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { IconButton } from "./ui";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const MAX_ZOOM = 64;
const MIN_ZOOM = 1 / 16;

type Loaded = { status: "loading" } | { status: "ready"; url: string } | { status: "error"; error: string };

/**
 * Object URL for a workspace image, revoked again when the path changes or the caller
 * unmounts. Formats the webview can't decode (tga) come back as an error right away.
 */
export function useWorkspaceImage(path: string | null): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    if (!path) return;
    const type = MIME[path.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) {
      setLoaded({ status: "error", error: "This image format can't be previewed." });
      return;
    }
    let url: string | null = null;
    let alive = true;
    setLoaded({ status: "loading" });
    api
      .readImage(path)
      .then((bytes) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([bytes], { type }));
        setLoaded({ status: "ready", url });
      })
      .catch((error) => alive && setLoaded({ status: "error", error: errorMessage(error) }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return loaded;
}

// textures are tiny, so blow them up by whole steps until they fill the view, big ones shrink to fit
function fitZoom(w: number, h: number, box: DOMRect): number {
  const fit = Math.min((box.width - 48) / w, (box.height - 48) / h);
  if (!(fit > 0)) return 1;
  return fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit;
}

/** Image tab body: the picture on a checkerboard with pixel exact zoom. */
export function ImagePreview({ path }: { path: string }) {
  const image = useWorkspaceImage(path);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  // null follows the view size, any manual zoom sticks until "fit" is pressed again
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  const [broken, setBroken] = useState(false);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !size) return;
    const update = () => setFit(fitZoom(size[0], size[1], stage.getBoundingClientRect()));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [size]);

  const scale = zoom ?? fit;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  // whole steps above 100% keep every texel the same size on screen
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? scaleRef.current * 2 : scaleRef.current / 2;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next >= 1 ? Math.round(next) : next)));
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // react's wheel listener is passive, ctrl+wheel needs a real one to stop the page from scrolling
  const ready = image.status === "ready";
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepRef.current(e.deltaY < 0 ? 1 : -1);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [ready]);

  if (image.status !== "ready" || broken) {
    return (
      <div className="editor-placeholder">
        {image.status === "loading" ? <Loader size={16} className="spin" /> : <CircleAlert size={20} />}
        {image.status === "error" && <span>{image.error}</span>}
        {broken && <span>This image could not be decoded.</span>}
      </div>
    );
  }

  return (
    <div className="image-preview">
      <div className="preview-bar">
        <span>{size ? `${size[0]} × ${size[1]} px · ${Math.round(scale * 100)}%` : ""}</span>
        <IconButton label="Zoom Out" onClick={() => step(-1)} disabled={scale <= MIN_ZOOM}>
          <Minus size={14} />
        </IconButton>
        <IconButton label="Zoom In" onClick={() => step(1)} disabled={scale >= MAX_ZOOM}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Fit to View" active={zoom === null} onClick={() => setZoom(null)}>
          <Maximize size={14} />
        </IconButton>
      </div>
      <div
        className="image-preview-stage"
        ref={stageRef}>
        <img
          src={image.url}
          alt={path}
          draggable={false}
          className={scale >= 1 ? "is-pixelated" : undefined}
          style={size ? { width: size[0] * scale, height: size[1] * scale } : { visibility: "hidden" }}
          onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
          onError={() => setBroken(true)}
        />
      </div>
    </div>
  );
}
