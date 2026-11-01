import { useCallback, useRef, useState, type PointerEvent } from "react";

interface ResizeHandleProps {
  axis: "x" | "y";
  /** Size at drag start plus the pointer delta. Callers clamp it themselves. */
  onResize: (size: number) => void;
  getSize: () => number;
  invert?: boolean;
  onDoubleClick?: () => void;
}

export function ResizeHandle({ axis, onResize, getSize, invert, onDoubleClick }: ResizeHandleProps) {
  const start = useRef<{ pointer: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { pointer: axis === "x" ? event.clientX : event.clientY, size: getSize() };
      setDragging(true);
    },
    [axis, getSize],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      const pointer = axis === "x" ? event.clientX : event.clientY;
      const delta = (pointer - start.current.pointer) * (invert ? -1 : 1);
      onResize(start.current.size + delta);
    },
    [axis, invert, onResize],
  );

  const stop = useCallback(() => {
    start.current = null;
    setDragging(false);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={`resize-handle axis-${axis}${dragging ? " is-dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onDoubleClick}
    />
  );
}
