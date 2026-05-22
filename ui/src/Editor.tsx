import { useEffect, useRef, useState } from "react";
import { renderMapSvg } from "./ipc";
import {
  addCarve,
  addObject,
  addWall,
  isRectCarve,
  mapBbox,
  nextId,
  removeCarve,
  removeObject,
  removeWall,
  updateCarve,
  updateObject,
  updateWall,
  type Map,
  type ObjectTool,
  type SnapMode,
  type View,
} from "./state";
import { OBJECT_TOOLS } from "./state";

const COLS = 40;
const ROWS = 28;

export type Tool = "select" | "rect" | "wall" | ObjectTool;

const OBJECT_TOOL_IDS = new Set<string>(OBJECT_TOOLS.map((t) => t.id));

function isObjectTool(t: Tool): t is ObjectTool {
  return OBJECT_TOOL_IDS.has(t);
}

type Drag = { x0: number; y0: number; x1: number; y1: number };

type WallDraft = { start: [number, number]; cursor: [number, number] };

type MoveOriginal =
  | { kind: "rect"; rect: [number, number, number, number] }
  | { kind: "at"; at: [number, number] }
  | { kind: "segment"; segment: [[number, number], [number, number]] };

type MoveDrag = {
  selection: Selection;
  startCell: [number, number];
  original: MoveOriginal;
  // Map snapshot at drag-start, so a multi-step move collapses to one
  // history entry on commit.
  snapshot: Map;
};

type SelectionKind = "carve" | "object" | "wall";
export type Selection = { kind: SelectionKind; id: string };

type Props = {
  map: Map;
  setMap: (m: Map) => void;
  replaceMap: (m: Map) => void;
  commitMap: (previous: Map, current: Map) => void;
  tool: Tool;
  snap: SnapMode;
  view: View;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  /// Bumping this counter triggers a fit-to-view inside the editor.
  fitToken: number;
};

function entityPosition(map: Map, sel: Selection): MoveOriginal | null {
  for (const layer of map.layers) {
    if (sel.kind === "carve") {
      const c = layer.carves.find((c) => c.id === sel.id);
      if (c && isRectCarve(c)) {
        return { kind: "rect", rect: [...c.rect] as [number, number, number, number] };
      }
    } else if (sel.kind === "object") {
      const o = (layer.objects ?? []).find((o) => o.id === sel.id);
      if (o) return { kind: "at", at: [o.at[0], o.at[1]] };
    } else {
      const w = (layer.walls ?? []).find((w) => w.id === sel.id);
      if (w) {
        return {
          kind: "segment",
          segment: [
            [w.segment[0][0], w.segment[0][1]],
            [w.segment[1][0], w.segment[1][1]],
          ],
        };
      }
    }
  }
  return null;
}

function moveEntity(
  map: Map,
  sel: Selection,
  original: MoveOriginal,
  dx: number,
  dy: number,
): Map {
  if (dx === 0 && dy === 0) return map;
  if (sel.kind === "carve" && original.kind === "rect") {
    const [x, y, w, h] = original.rect;
    return updateCarve(map, sel.id, { rect: [x + dx, y + dy, w, h] });
  }
  if (sel.kind === "object" && original.kind === "at") {
    const [x, y] = original.at;
    return updateObject(map, sel.id, { at: [x + dx, y + dy] });
  }
  if (sel.kind === "wall" && original.kind === "segment") {
    const [[ax, ay], [bx, by]] = original.segment;
    return updateWall(map, sel.id, {
      segment: [
        [ax + dx, ay + dy],
        [bx + dx, by + dy],
      ],
    });
  }
  return map;
}

function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function Editor({
  map,
  setMap,
  replaceMap,
  commitMap,
  tool,
  snap,
  view,
  selection,
  setSelection,
  fitToken,
}: Props) {
  const step = 1 / snap;
  const cell = map.grid.cell_size;
  const W = COLS * cell;
  const H = ROWS * cell;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);

  // Pan/zoom transform.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState<
    { clientX: number; clientY: number; baseX: number; baseY: number } | null
  >(null);
  const [spacePressed, setSpacePressed] = useState(false);

  // Drop wall draft if the user switches away from the wall tool.
  useEffect(() => {
    if (tool !== "wall") setWallDraft(null);
  }, [tool]);

  // Space-key tracking for pan.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        if (!e.repeat) setSpacePressed(true);
        e.preventDefault();
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") setSpacePressed(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Fit-to-view on demand. Bumping `fitToken` (from the toolbar Fit button
  // or after Open/New) recenters and rescales so the map's bbox fills the
  // visible viewport with a small margin.
  useEffect(() => {
    if (fitToken === 0) return; // initial mount; nothing to fit
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const bbox = mapBbox(map);
    const rect = wrap.getBoundingClientRect();
    if (!bbox || rect.width === 0 || rect.height === 0) {
      // Empty map: reset to identity at top-left.
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const margin = 0.85;
    const bboxPxW = bbox.w * cell;
    const bboxPxH = bbox.h * cell;
    const newZoom = Math.min(
      4,
      Math.max(0.25, Math.min((rect.width * margin) / bboxPxW, (rect.height * margin) / bboxPxH)),
    );
    const bboxCenterX = (bbox.x + bbox.w / 2) * cell;
    const bboxCenterY = (bbox.y + bbox.h / 2) * cell;
    setZoom(newZoom);
    setPan({
      x: rect.width / 2 - bboxCenterX * newZoom,
      y: rect.height / 2 - bboxCenterY * newZoom,
    });
  }, [fitToken, map, cell]);

  // Wheel zoom (Cmd/Ctrl + wheel) around cursor.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const wrapRect = wrap!.getBoundingClientRect();
      const mx = e.clientX - wrapRect.left;
      const my = e.clientY - wrapRect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom((zoomPrev) => {
        const next = Math.max(0.25, Math.min(4, zoomPrev * factor));
        setPan((panPrev) => {
          // Keep the same SVG point under the cursor.
          const svgX = (mx - panPrev.x) / zoomPrev;
          const svgY = (my - panPrev.y) / zoomPrev;
          return { x: mx - svgX * next, y: my - svgY * next };
        });
        return next;
      });
    }
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  // Live render via Rust on every map change. For a fixed editor canvas we
  // force the viewBox to [0, 0, W, H] and skip the background so the
  // editor's own grid shows through the void.
  useEffect(() => {
    let cancel = false;
    renderMapSvg(map, {
      viewbox: [0, 0, W, H],
      transparentBackground: true,
      showGrid: true,
      showGm: view === "gm",
    })
      .then((s) => {
        if (!cancel) setSvg(s);
      })
      .catch(() => {
        // Validation errors render as no SVG; the editor keeps the prior one.
      });
    return () => {
      cancel = true;
    };
  }, [map, W, H, view]);

  function pxFromEvent(e: React.PointerEvent): { px: number; py: number } {
    // Use the inner content's screen rect — it reflects the pan/zoom
    // transform so the conversion stays valid under any view state.
    const inner = contentRef.current;
    if (!inner) return { px: 0, py: 0 };
    const rect = inner.getBoundingClientRect();
    const sx = W / rect.width;
    const sy = H / rect.height;
    return {
      px: (e.clientX - rect.left) * sx,
      py: (e.clientY - rect.top) * sy,
    };
  }

  // The cursor's "cell" is the top-left of the snap-sized square it's in.
  function cellFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const { px, py } = pxFromEvent(e);
    return {
      x: Math.floor(px / cell / step) * step,
      y: Math.floor(py / cell / step) * step,
    };
  }

  // For walls, snap to the nearest *corner* of the snap grid.
  function cornerFromEvent(e: React.PointerEvent): [number, number] {
    const { px, py } = pxFromEvent(e);
    return [
      Math.round(px / cell / step) * step,
      Math.round(py / cell / step) * step,
    ];
  }

  function hitTest(x: number, y: number, e: React.PointerEvent): Selection | null {
    const { px, py } = pxFromEvent(e);
    const tol = cell * 0.25;
    // Iterate all layers; later layers visually sit on top, so search them
    // first (reverse).
    const layers = [...map.layers].reverse();
    for (const layer of layers) {
      for (const w of [...(layer.walls ?? [])].reverse()) {
        const [[ax, ay], [bx, by]] = w.segment;
        const dist = pointToSegmentDist(
          px,
          py,
          ax * cell,
          ay * cell,
          bx * cell,
          by * cell,
        );
        if (dist <= tol) return { kind: "wall", id: w.id };
      }
      for (const obj of [...(layer.objects ?? [])].reverse()) {
        if (obj.at[0] <= x && x < obj.at[0] + 1 && obj.at[1] <= y && y < obj.at[1] + 1) {
          return { kind: "object", id: obj.id };
        }
      }
      for (const c of [...layer.carves].reverse()) {
        if (isRectCarve(c)) {
          const [cx, cy, cw, ch] = c.rect;
          if (x >= cx && x < cx + cw && y >= cy && y < cy + ch) {
            return { kind: "carve", id: c.id };
          }
        }
      }
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Pan: middle-mouse OR space+left.
    if (e.button === 1 || (spacePressed && e.button === 0)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanDrag({
        clientX: e.clientX,
        clientY: e.clientY,
        baseX: pan.x,
        baseY: pan.y,
      });
      e.preventDefault();
      return;
    }

    const { x, y } = cellFromEvent(e);

    if (tool === "rect") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    if (tool === "select") {
      const hit = hitTest(x, y, e);
      setSelection(hit);
      if (hit) {
        const original = entityPosition(map, hit);
        if (original) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setMoveDrag({
            selection: hit,
            startCell: [x, y],
            original,
            snapshot: map,
          });
        }
      }
      return;
    }

    if (tool === "wall") {
      const corner = cornerFromEvent(e);
      if (!wallDraft) {
        setWallDraft({ start: corner, cursor: corner });
      } else {
        // Snap the second corner to be axis-aligned with the first.
        const [sx, sy] = wallDraft.start;
        let [ex, ey] = corner;
        if (Math.abs(ex - sx) >= Math.abs(ey - sy)) ey = sy;
        else ex = sx;
        if (ex === sx && ey === sy) return; // ignore zero-length
        const allWalls = map.layers.flatMap((l) => l.walls ?? []);
        const id = nextId("w", allWalls);
        setMap(addWall(map, { id, segment: [[sx, sy], [ex, ey]] }));
        setWallDraft(null);
        setSelection({ kind: "wall", id });
      }
      return;
    }

    if (isObjectTool(tool)) {
      const def = OBJECT_TOOLS.find((t) => t.id === tool)!;
      const allObjects = map.layers.flatMap((l) => l.objects ?? []);
      const id = nextId("o", allObjects);
      const obj = {
        id,
        type: tool,
        at: [x, y] as [number, number],
        facing: "defaultFacing" in def ? def.defaultFacing : undefined,
      };
      setMap(addObject(map, obj));
      setSelection({ kind: "object", id });
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (panDrag) {
      setPan({
        x: panDrag.baseX + (e.clientX - panDrag.clientX),
        y: panDrag.baseY + (e.clientY - panDrag.clientY),
      });
      return;
    }
    if (moveDrag) {
      const { x, y } = cellFromEvent(e);
      const dx = x - moveDrag.startCell[0];
      const dy = y - moveDrag.startCell[1];
      // replaceMap mutates state without touching history; the whole
      // drag collapses to a single history entry on pointerup.
      const next = moveEntity(map, moveDrag.selection, moveDrag.original, dx, dy);
      if (next !== map) replaceMap(next);
      return;
    }
    if (drag) {
      const { x, y } = cellFromEvent(e);
      if (x === drag.x1 || y === drag.y1) setDrag({ ...drag, x1: x, y1: y });
      else setDrag({ ...drag, x1: x, y1: y });
      return;
    }
    if (wallDraft) {
      const corner = cornerFromEvent(e);
      if (corner[0] !== wallDraft.cursor[0] || corner[1] !== wallDraft.cursor[1]) {
        setWallDraft({ ...wallDraft, cursor: corner });
      }
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (panDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setPanDrag(null);
      return;
    }
    if (moveDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      commitMap(moveDrag.snapshot, map);
      setMoveDrag(null);
      return;
    }
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    // The drag includes the snap-square at both endpoints, so width grows by
    // one step beyond the raw delta.
    const w = Math.abs(drag.x1 - drag.x0) + step;
    const h = Math.abs(drag.y1 - drag.y0) + step;
    setDrag(null);
    if (w <= 0 || h <= 0) return;
    const allCarves = map.layers.flatMap((l) => l.carves);
    const id = nextId("r", allCarves);
    setMap(addCarve(map, { id, rect: [x, y, w, h] }));
    setSelection({ kind: "carve", id });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setWallDraft(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      if (selection.kind === "carve") {
        setMap(removeCarve(map, selection.id));
      } else if (selection.kind === "object") {
        setMap(removeObject(map, selection.id));
      } else {
        setMap(removeWall(map, selection.id));
      }
      setSelection(null);
      e.preventDefault();
    }
  }

  // Selection indicator (box or line, in pixels). Searches every layer.
  type SelDraw =
    | { kind: "box"; x: number; y: number; w: number; h: number }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number };
  const selectionDraw: SelDraw | null = (() => {
    if (!selection) return null;
    for (const layer of map.layers) {
      if (selection.kind === "carve") {
        const c = layer.carves.find((c) => c.id === selection.id);
        if (c && isRectCarve(c)) {
          const [x, y, w, h] = c.rect;
          return { kind: "box", x: x * cell, y: y * cell, w: w * cell, h: h * cell };
        }
      } else if (selection.kind === "object") {
        const o = (layer.objects ?? []).find((o) => o.id === selection.id);
        if (o) {
          return { kind: "box", x: o.at[0] * cell, y: o.at[1] * cell, w: cell, h: cell };
        }
      } else {
        const w = (layer.walls ?? []).find((w) => w.id === selection.id);
        if (w) {
          const [[ax, ay], [bx, by]] = w.segment;
          return {
            kind: "line",
            x1: ax * cell, y1: ay * cell, x2: bx * cell, y2: by * cell,
          };
        }
      }
    }
    return null;
  })();

  const dragPreview =
    drag &&
    (() => {
      const x = Math.min(drag.x0, drag.x1) * cell;
      const y = Math.min(drag.y0, drag.y1) * cell;
      const w = (Math.abs(drag.x1 - drag.x0) + step) * cell;
      const h = (Math.abs(drag.y1 - drag.y0) + step) * cell;
      return { x, y, w, h };
    })();

  // Wall-draft preview line (axis-aligned snap on the cursor).
  const wallPreview = (() => {
    if (!wallDraft) return null;
    const [sx, sy] = wallDraft.start;
    let [ex, ey] = wallDraft.cursor;
    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) ey = sy;
    else ex = sx;
    return {
      x1: sx * cell,
      y1: sy * cell,
      x2: ex * cell,
      y2: ey * cell,
    };
  })();

  const cursorClass = panDrag
    ? "cursor-grabbing"
    : spacePressed
      ? "cursor-grab"
      : tool === "select"
        ? "cursor-select"
        : tool === "rect"
          ? "cursor-cross"
          : tool === "wall"
            ? "cursor-cross"
            : "cursor-place";

  return (
    <div
      ref={wrapperRef}
      className={`editor ${cursorClass}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setPanDrag(null);
        setMoveDrag(null);
      }}
    >
      <div
        ref={contentRef}
        className="canvas-content"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: W,
          height: H,
        }}
      >
      {/* Layer 1: black background + faint void grid so the user can plan placement. */}
      <svg className="layer-bg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <rect x={0} y={0} width={W} height={H} fill="#000000" />
        <g stroke="#1f1f22" strokeWidth={0.6}>
          {Array.from({ length: COLS + 1 }).map((_, i) => (
            <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={H} />
          ))}
          {Array.from({ length: ROWS + 1 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={i * cell} x2={W} y2={i * cell} />
          ))}
        </g>
      </svg>

      {/* Layer 2: Rust render (transparent background, viewbox locked to editor canvas). */}
      <div className="layer-render" dangerouslySetInnerHTML={{ __html: svg }} />

      {/* Layer 3: drag preview + selection overlay. */}
      <svg className="layer-overlay" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {dragPreview && (
          <rect
            x={dragPreview.x}
            y={dragPreview.y}
            width={dragPreview.w}
            height={dragPreview.h}
            fill="rgba(201, 168, 106, 0.18)"
            stroke="#c9a86a"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {selectionDraw?.kind === "box" && (
          <rect
            x={selectionDraw.x - 1}
            y={selectionDraw.y - 1}
            width={selectionDraw.w + 2}
            height={selectionDraw.h + 2}
            fill="none"
            stroke="#c9a86a"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {selectionDraw?.kind === "line" && (
          <line
            x1={selectionDraw.x1}
            y1={selectionDraw.y1}
            x2={selectionDraw.x2}
            y2={selectionDraw.y2}
            stroke="#c9a86a"
            strokeWidth={6}
            strokeOpacity={0.45}
            strokeLinecap="round"
          />
        )}
        {wallPreview && (
          <>
            <line
              x1={wallPreview.x1}
              y1={wallPreview.y1}
              x2={wallPreview.x2}
              y2={wallPreview.y2}
              stroke="#c9a86a"
              strokeWidth={cell * 0.10}
              strokeDasharray="6 4"
              strokeLinecap="square"
            />
            <circle cx={wallPreview.x1} cy={wallPreview.y1} r={4} fill="#c9a86a" />
          </>
        )}
      </svg>
      </div>
    </div>
  );
}
