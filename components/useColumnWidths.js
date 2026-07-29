"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// Drag-to-resize table columns, persisted per table in localStorage.
//
// columns: [{ key, width, min }]  — width is the default, min the floor when dragging.
// storageKey: unique per table so the two previews don't share sizes.
export function useColumnWidths(storageKey, columns) {
  const defaults = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.width])), [columns]);
  const minimums = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.min])),   [columns]);

  const [widths, setWidths] = useState(defaults);
  const drag = useRef(null);

  // Read persisted widths after mount. This has to be an effect rather than a lazy
  // initialiser: localStorage doesn't exist during SSR, and reading it on the first
  // client render would make the markup disagree with the server's.
  useEffect(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) ?? "null"); }
    catch { /* ignore malformed storage */ }
    if (!saved || typeof saved !== "object") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from a browser-only store on mount
    setWidths({ ...defaults, ...saved });
  }, [storageKey, defaults]);

  const persist = useCallback((next) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota / private mode */ }
  }, [storageKey]);

  // Pointer events (not mouse) so trackpad and touch drags both work
  useEffect(() => {
    function onMove(e) {
      if (!drag.current) return;
      const { key, startX, startWidth } = drag.current;
      const next = Math.max(minimums[key] ?? 60, Math.round(startWidth + (e.clientX - startX)));
      setWidths((w) => (w[key] === next ? w : { ...w, [key]: next }));
    }
    function onUp() {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidths((w) => { persist(w); return w; });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [minimums, persist]);

  function startResize(key, e) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key, startX: e.clientX, startWidth: widths[key] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resetWidths() {
    setWidths(defaults);
    persist(defaults);
  }

  const totalWidth = columns.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);
  return { widths, startResize, resetWidths, totalWidth };
}

// Grab bar sitting on a header cell's right edge.
export function ResizeHandle({ onPointerDown }) {
  return (
    <span
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize column"
      className="absolute top-0 right-0 h-full w-2 translate-x-1/2 cursor-col-resize z-20 group flex justify-center"
    >
      <span className="w-px h-full bg-white/20 group-hover:bg-white/70 group-active:bg-white transition-colors" />
    </span>
  );
}
