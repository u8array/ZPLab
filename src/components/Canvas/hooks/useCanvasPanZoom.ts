import { useState, useRef, useLayoutEffect, useEffect } from "react";

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

interface Options {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  fitZoom: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface PanZoomState {
  panOffset: { x: number; y: number };
  spaceDown: boolean;
  isPanningRef: React.RefObject<boolean>;
  /** Returns true if a pan gesture just ended; clears the flag. */
  consumeDidPan: () => boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  cursor: string | undefined;
}

export function useCanvasPanZoom({ zoom, onZoomChange, fitZoom, containerRef }: Options): PanZoomState {
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const didPanRef = useRef(false);

  const zoomRef = useRef(zoom);
  const fitZoomRef = useRef(fitZoom);
  const onZoomChangeRef = useRef(onZoomChange);
  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useLayoutEffect(() => { fitZoomRef.current = fitZoom; }, [fitZoom]);
  useLayoutEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);

  // non-passive wheel: ctrl+scroll → zoom, plain scroll → pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onZoomChangeRef.current(
          Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * (e.deltaY < 0 ? 1.1 : 0.9))),
        );
      } else {
        setPanOffset((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef]);

  // space key toggles the grab cursor and enables space+drag panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const zoomIn = () => onZoomChange(ZOOM_STEPS.find((s) => s > zoomRef.current) ?? ZOOM_MAX);
  const zoomOut = () => onZoomChange([...ZOOM_STEPS].reverse().find((s) => s < zoomRef.current) ?? ZOOM_MIN);
  const zoomFit = () => {
    onZoomChange(fitZoomRef.current);
    setPanOffset({ x: 0, y: 0 });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const isMiddle = e.button === 1;
    const isSpaceDrag = e.button === 0 && spaceDown;
    if (!isMiddle && !isSpaceDrag) return;
    e.preventDefault();
    isPanningRef.current = true;
    setIsPanning(true);
    didPanRef.current = false;
    panStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panX: panOffset.x,
      panY: panOffset.y,
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.mouseX;
    const dy = e.clientY - panStartRef.current.mouseY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPanRef.current = true;
    setPanOffset({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const onMouseUp = () => {
    isPanningRef.current = false;
    setIsPanning(false);
  };

  const consumeDidPan = () => {
    if (!didPanRef.current) return false;
    didPanRef.current = false;
    return true;
  };

  const cursor = isPanning ? "grabbing" : spaceDown ? "grab" : undefined;

  return {
    panOffset,
    spaceDown,
    isPanningRef,
    consumeDidPan,
    zoomIn,
    zoomOut,
    zoomFit,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cursor,
  };
}
