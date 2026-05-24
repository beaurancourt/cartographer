import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderMapSvg } from "./ipc";
import {
  addCarve,
  addDoor,
  addNote,
  addObject,
  addStairs,
  addWall,
  isRectCarve,
  nextId,
  removeCarve,
  removeDoor,
  removeNote,
  removeObject,
  removeStairs,
  removeWall,
  updateCarve,
  updateDoor,
  updateNote,
  updateObject,
  updateStairs,
  updateWall,
  type DoorTool,
  type Map,
  type ObjectTool,
  type SnapMode,
  type View,
} from "./state";
import { DOOR_TOOLS, OBJECT_TOOLS } from "./state";

export type Tool =
  | "select"
  | "rect"
  | "wall"
  | "path"
  | "note"
  | "stairs"
  | DoorTool
  | ObjectTool;

const OBJECT_TOOL_IDS = new Set<string>(OBJECT_TOOLS.map((t) => t.id));
const DOOR_TOOL_IDS = new Set<string>(DOOR_TOOLS.map((t) => t.id));

function isObjectTool(t: Tool): t is ObjectTool {
  return OBJECT_TOOL_IDS.has(t);
}

function isDoorTool(t: Tool): t is DoorTool {
  return DOOR_TOOL_IDS.has(t);
}

type Drag = { x0: number; y0: number; x1: number; y1: number };

type WallDraft = { start: [number, number]; cursor: [number, number] };

type PathDraft = { points: [number, number][]; cursor: [number, number] };

type DoorDraft = {
  tool: DoorTool;
  start: [number, number];
  cursor: [number, number];
};

type StairsDraft = { points: [number, number][]; cursor: [number, number] };

type MoveOriginal =
  | { kind: "rect"; rect: [number, number, number, number] }
  | { kind: "at"; at: [number, number] }
  | { kind: "segment"; segment: [[number, number], [number, number]] }
  | { kind: "anchors"; anchors: [[number, number], [number, number], [number, number]] };

type MoveDrag = {
  selection: Selection;
  startCell: [number, number];
  original: MoveOriginal;
  // Map snapshot at drag-start, so a multi-step move collapses to one
  // history entry on commit.
  snapshot: Map;
};

type HandleDir =
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
  | "wall-start" | "wall-end"
  | "door-start" | "door-end"
  | "stairs-0" | "stairs-1" | "stairs-2";

type ResizeDrag = {
  selection: Selection;
  handle: HandleDir;
  original: MoveOriginal;
  snapshot: Map;
};

type SelectionKind = "carve" | "object" | "wall" | "note" | "door" | "stairs";
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
  /// Layer ids the user has temporarily hidden in the editor. They're still
  /// in the map data and will appear in exports; only the live preview and
  /// the hit-test ignore them.
  hiddenLayers: Set<string>;
  /// Reports cursor cell coords to the status bar.
  onCursorChange: (c: [number, number] | null) => void;
};

function entityPosition(map: Map, sel: Selection): MoveOriginal | null {
  for (const layer of map.layers) {
    if (sel.kind === "note") {
      const n = (layer.notes ?? []).find((n) => n.id === sel.id);
      if (n) return { kind: "at", at: [n.at[0], n.at[1]] };
      continue;
    }
    if (sel.kind === "carve") {
      const c = layer.carves.find((c) => c.id === sel.id);
      if (c && isRectCarve(c)) {
        return { kind: "rect", rect: [...c.rect] as [number, number, number, number] };
      }
    } else if (sel.kind === "object") {
      const o = (layer.objects ?? []).find((o) => o.id === sel.id);
      if (o) return { kind: "at", at: [o.at[0], o.at[1]] };
    } else if (sel.kind === "wall") {
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
    } else if (sel.kind === "door") {
      const d = (layer.doors ?? []).find((d) => d.id === sel.id);
      if (d) {
        return {
          kind: "segment",
          segment: [
            [d.segment[0][0], d.segment[0][1]],
            [d.segment[1][0], d.segment[1][1]],
          ],
        };
      }
    } else if (sel.kind === "stairs") {
      const st = (layer.stairs ?? []).find((s) => s.id === sel.id);
      if (st) {
        return {
          kind: "anchors",
          anchors: [
            [st.anchors[0][0], st.anchors[0][1]],
            [st.anchors[1][0], st.anchors[1][1]],
            [st.anchors[2][0], st.anchors[2][1]],
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
  if (sel.kind === "note" && original.kind === "at") {
    const [x, y] = original.at;
    return updateNote(map, sel.id, { at: [x + dx, y + dy] });
  }
  if (sel.kind === "wall" && original.kind === "segment") {
    const [[ax, ay], [bx, by]] = original.segment;
    return updateWall(map, sel.id, {
      segment: [[ax + dx, ay + dy], [bx + dx, by + dy]],
    });
  }
  if (sel.kind === "door" && original.kind === "segment") {
    const [[ax, ay], [bx, by]] = original.segment;
    return updateDoor(map, sel.id, {
      segment: [[ax + dx, ay + dy], [bx + dx, by + dy]],
    });
  }
  if (sel.kind === "stairs" && original.kind === "anchors") {
    const moved = original.anchors.map(([x, y]) => [x + dx, y + dy]) as [
      [number, number], [number, number], [number, number],
    ];
    return updateStairs(map, sel.id, { anchors: moved });
  }
  return map;
}

function resizeEntity(
  map: Map,
  resize: ResizeDrag,
  cursorX: number,
  cursorY: number,
): Map {
  const { selection: sel, handle, original } = resize;

  if (sel.kind === "carve" && original.kind === "rect") {
    const [ox, oy, ow, oh] = original.rect;
    // Anchor points (opposite of the dragged handle) stay fixed.
    let left = ox;
    let top = oy;
    let right = ox + ow;
    let bottom = oy + oh;
    if (handle.includes("w")) left = cursorX;
    if (handle.includes("e")) right = cursorX;
    if (handle.startsWith("n")) top = cursorY;
    if (handle.startsWith("s")) bottom = cursorY;
    // Clamp: avoid zero/negative dimensions by swapping when crossed.
    if (right < left) [left, right] = [right, left];
    if (bottom < top) [top, bottom] = [bottom, top];
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return map;
    return updateCarve(map, sel.id, { rect: [left, top, w, h] });
  }

  if (sel.kind === "wall" && original.kind === "segment") {
    const [[ax, ay], [bx, by]] = original.segment;
    if (handle === "wall-start") {
      return updateWall(map, sel.id, { segment: [[cursorX, cursorY], [bx, by]] });
    }
    if (handle === "wall-end") {
      return updateWall(map, sel.id, { segment: [[ax, ay], [cursorX, cursorY]] });
    }
  }

  if (sel.kind === "door" && original.kind === "segment") {
    const [[ax, ay], [bx, by]] = original.segment;
    if (handle === "door-start") {
      return updateDoor(map, sel.id, { segment: [[cursorX, cursorY], [bx, by]] });
    }
    if (handle === "door-end") {
      return updateDoor(map, sel.id, { segment: [[ax, ay], [cursorX, cursorY]] });
    }
  }

  if (sel.kind === "stairs" && original.kind === "anchors") {
    const idx =
      handle === "stairs-0" ? 0 :
      handle === "stairs-1" ? 1 :
      handle === "stairs-2" ? 2 : -1;
    if (idx >= 0) {
      const next: [[number, number], [number, number], [number, number]] = [
        [original.anchors[0][0], original.anchors[0][1]],
        [original.anchors[1][0], original.anchors[1][1]],
        [original.anchors[2][0], original.anchors[2][1]],
      ];
      next[idx as 0 | 1 | 2] = [cursorX, cursorY];
      return updateStairs(map, sel.id, { anchors: next });
    }
  }

  return map;
}

const CARVE_HANDLES: { dir: HandleDir; fx: number; fy: number; cursor: string }[] = [
  { dir: "nw", fx: 0,   fy: 0,   cursor: "nwse-resize" },
  { dir: "n",  fx: 0.5, fy: 0,   cursor: "ns-resize"   },
  { dir: "ne", fx: 1,   fy: 0,   cursor: "nesw-resize" },
  { dir: "e",  fx: 1,   fy: 0.5, cursor: "ew-resize"   },
  { dir: "se", fx: 1,   fy: 1,   cursor: "nwse-resize" },
  { dir: "s",  fx: 0.5, fy: 1,   cursor: "ns-resize"   },
  { dir: "sw", fx: 0,   fy: 1,   cursor: "nesw-resize" },
  { dir: "w",  fx: 0,   fy: 0.5, cursor: "ew-resize"   },
];

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

// Strip Rust's outer <svg>…</svg> so the inner content can be injected as a
// <g> in the editor's own SVG. The inner content's coords are in world-pixel
// units (world_cell * cell_px), which matches the editor SVG's coordinate
// system, so entities land at the right place regardless of pan/zoom.
function stripSvgWrapper(s: string): string {
  const open = s.match(/<svg\b[^>]*>/);
  if (!open || open.index === undefined) return "";
  const openEnd = open.index + open[0].length;
  const closeStart = s.lastIndexOf("</svg>");
  if (closeStart < 0 || closeStart < openEnd) return "";
  return s.slice(openEnd, closeStart);
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
  hiddenLayers,
  onCursorChange,
}: Props) {
  const step = 1 / snap;
  const cell = map.grid.cell_size;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rustGroupRef = useRef<SVGGElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null);
  const [pathDraft, setPathDraft] = useState<PathDraft | null>(null);
  const [doorDraft, setDoorDraft] = useState<DoorDraft | null>(null);
  const [stairsDraft, setStairsDraft] = useState<StairsDraft | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  // Pan/zoom — drives the SVG viewBox directly, so the canvas is truly
  // infinite in every direction. `pan` is the world-pixel coord at the
  // viewport's top-left corner; `zoom` is the visual scale (screen px per
  // SVG unit). Initial pan offsets so world origin sits a couple cells in
  // from the top-left, giving the user a few cells of negative space to
  // pan into without first having to scroll.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({
    x: -cell * 2,
    y: -cell * 2,
  });
  const [panDrag, setPanDrag] = useState<
    { clientX: number; clientY: number; baseX: number; baseY: number } | null
  >(null);
  const [spacePressed, setSpacePressed] = useState(false);

  // Viewport size in CSS pixels — drives viewBox width/height (= vp/zoom).
  // Tracked via ResizeObserver so the SVG correctly fills the wrapper at all
  // window sizes.
  const [vp, setVp] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const sync = () => {
      const r = wrap.getBoundingClientRect();
      setVp({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, []);

  const vbW = vp.w / zoom;
  const vbH = vp.h / zoom;
  const vbX = pan.x;
  const vbY = pan.y;

  // Drop in-progress drafts when the active tool changes.
  useEffect(() => {
    if (tool !== "wall") setWallDraft(null);
    if (tool !== "path") setPathDraft(null);
    if (!isDoorTool(tool)) setDoorDraft(null);
    if (tool !== "stairs") setStairsDraft(null);
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

  // Wheel: plain wheel/two-finger pans (trackpad native), Cmd/Ctrl+wheel
  // zooms around the cursor.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const svgEl = svgRef.current;
      if (!svgEl) return;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0035);
        const rect = svgEl.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        setZoom((zPrev) => {
          const newZ = Math.max(0.1, Math.min(8, zPrev * factor));
          setPan((pPrev) => {
            // World coord under cursor (before zoom): wx = vbX + screenX/zPrev.
            // After zoom we want the same screen point to land on the same
            // world coord: vbX_new = wx - screenX/newZ.
            const wx = pPrev.x + screenX / zPrev;
            const wy = pPrev.y + screenY / zPrev;
            return { x: wx - screenX / newZ, y: wy - screenY / newZ };
          });
          return newZ;
        });
      } else {
        // deltaX/deltaY are screen px; viewBox shifts by delta/zoom (world px).
        setPan((p) => ({ x: p.x + e.deltaX / zoom, y: p.y + e.deltaY / zoom }));
      }
    }
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // Live render via Rust on every map change. The Rust SVG content is laid
  // out in world-pixel units (world_cell * cell_px), which matches our SVG's
  // coordinate system — we strip Rust's outer <svg> wrapper and graft just
  // the inner content into our scene as a <g>. We let Rust draw its grid:
  // its grid lands *over* the carved floor (which would otherwise mask the
  // editor's own pattern grid sitting underneath), giving uniform grid
  // coverage across void and floor alike.
  useEffect(() => {
    let cancel = false;
    const visibleMap =
      hiddenLayers.size === 0
        ? map
        : { ...map, layers: map.layers.filter((l) => !hiddenLayers.has(l.id)) };
    renderMapSvg(visibleMap, {
      transparentBackground: true,
      showGrid: true,
      view,
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
  }, [map, view, hiddenLayers]);

  // Inject the Rust SVG's inner content into our <g>. We use innerHTML
  // because the <g> sits inside an SVG namespace, so the parsed children
  // are themselves SVG elements (not HTML).
  useEffect(() => {
    const g = rustGroupRef.current;
    if (!g) return;
    g.innerHTML = stripSvgWrapper(svg);
  }, [svg]);

  // Convert a pointer event's screen coords into SVG (== world-pixel) coords
  // by inverting the current SVG screen CTM. This is invariant to pan/zoom
  // state — no manual math needed.
  function pxFromEvent(e: React.PointerEvent): { px: number; py: number } {
    const svgEl = svgRef.current;
    if (!svgEl) return { px: 0, py: 0 };
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { px: 0, py: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const t = pt.matrixTransform(ctm.inverse());
    return { px: t.x, py: t.y };
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
    // Iterate all visible layers; later layers visually sit on top, so
    // search them first (reverse). Notes hit-test before everything else
    // in a layer since they're rendered last (on top).
    const layers = [...map.layers]
      .filter((l) => !hiddenLayers.has(l.id))
      .reverse();
    for (const layer of layers) {
      for (const n of [...(layer.notes ?? [])].reverse()) {
        if (n.at[0] <= x && x < n.at[0] + 1 && n.at[1] <= y && y < n.at[1] + 1) {
          return { kind: "note", id: n.id };
        }
      }
      for (const d of [...(layer.doors ?? [])].reverse()) {
        const [[ax, ay], [bx, by]] = d.segment;
        const dist = pointToSegmentDist(
          px, py, ax * cell, ay * cell, bx * cell, by * cell,
        );
        if (dist <= tol) return { kind: "door", id: d.id };
      }
      for (const st of [...(layer.stairs ?? [])].reverse()) {
        // Hit-test against the convex hull of the 3 anchors approximated as
        // their bounding box for now.
        const xs = st.anchors.map((p) => p[0]);
        const ys = st.anchors.map((p) => p[1]);
        if (
          x >= Math.min(...xs) && x <= Math.max(...xs) &&
          y >= Math.min(...ys) && y <= Math.max(...ys)
        ) {
          return { kind: "stairs", id: st.id };
        }
      }
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
        } else {
          // Path carve: each consecutive pair of waypoints forms an
          // axis-aligned strip of `width` cells. Mirror Rust's
          // segment_bbox so editor hit-testing matches what's drawn.
          const w = c.width;
          for (let i = 1; i < c.path.length; i++) {
            const [ax, ay] = c.path[i - 1];
            const [bx, by] = c.path[i];
            let rx: number, ry: number, rw: number, rh: number;
            if (ay === by) {
              rx = Math.min(ax, bx);
              ry = ay;
              rw = Math.abs(bx - ax) + 1;
              rh = w;
            } else if (ax === bx) {
              rx = ax;
              ry = Math.min(ay, by);
              rw = w;
              rh = Math.abs(by - ay) + 1;
            } else {
              continue;
            }
            if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
              return { kind: "carve", id: c.id };
            }
          }
        }
      }
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
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

    // Resize-handle hit: target carries data-handle on the overlay rect.
    const handleAttr = (e.target as Element).getAttribute?.("data-handle");
    if (handleAttr && selection) {
      const original = entityPosition(map, selection);
      if (original) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setResizeDrag({
          selection,
          handle: handleAttr as HandleDir,
          original,
          snapshot: map,
        });
        return;
      }
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
      e.currentTarget.setPointerCapture(e.pointerId);
      if (wallDraft) {
        const [sx, sy] = wallDraft.start;
        const [ex0, ey0] = corner;
        if (sx !== ex0 || sy !== ey0) {
          commitWallDraft(corner);
          return;
        }
      }
      setWallDraft({ start: corner, cursor: corner });
      return;
    }

    if (tool === "note") {
      const { x, y } = cellFromEvent(e);
      const allNotes = map.layers.flatMap((l) => l.notes ?? []);
      const id = nextId("n", allNotes);
      const note = { id, at: [x, y] as [number, number], text: "" };
      setMap(addNote(map, note));
      setSelection({ kind: "note", id });
      return;
    }

    if (isDoorTool(tool)) {
      const corner = cornerFromEvent(e);
      // Two interaction modes:
      //   - Drag: press, move, release → commits on pointerup.
      //   - Click-click: press, release; press again → commits.
      // pointerdown always starts (or restarts) a draft and captures.
      e.currentTarget.setPointerCapture(e.pointerId);
      if (doorDraft && doorDraft.tool === tool) {
        const [sx, sy] = doorDraft.start;
        const [ex, ey] = corner;
        if (sx !== ex || sy !== ey) {
          commitDoorDraft(corner);
          return;
        }
      }
      setDoorDraft({ tool, start: corner, cursor: corner });
      return;
    }

    if (tool === "stairs") {
      const corner = cornerFromEvent(e);
      if (!stairsDraft) {
        setStairsDraft({ points: [corner], cursor: corner });
      } else if (stairsDraft.points.length === 1) {
        // Second click: the other corner of the "up" edge.
        if (corner[0] === stairsDraft.points[0][0] && corner[1] === stairsDraft.points[0][1]) return;
        setStairsDraft({ points: [stairsDraft.points[0], corner], cursor: corner });
      } else {
        // Third click: bottom anchor — commit.
        const allStairs = map.layers.flatMap((l) => l.stairs ?? []);
        const id = nextId("s", allStairs);
        setMap(
          addStairs(map, {
            id,
            anchors: [stairsDraft.points[0], stairsDraft.points[1], corner],
          }),
        );
        setStairsDraft(null);
        setSelection({ kind: "stairs", id });
      }
      return;
    }

    if (tool === "path") {
      const { x, y } = cellFromEvent(e);
      if (!pathDraft) {
        setPathDraft({ points: [[x, y]], cursor: [x, y] });
      } else {
        // Snap the new point axis-aligned with the previous one.
        const last = pathDraft.points[pathDraft.points.length - 1];
        const snapped = snapAxisAligned(last, [x, y]);
        // Clicking back onto a cell that already has a point commits the
        // path. Covers the "click last point twice", "click start point to
        // close the path", and any other repeat-click cases.
        const hitsExisting = pathDraft.points.some(
          ([px, py]) => px === snapped[0] && py === snapped[1],
        );
        if (hitsExisting) {
          if (pathDraft.points.length >= 2) commitPathDraft();
          else setPathDraft(null);
          return;
        }
        setPathDraft({
          points: [...pathDraft.points, snapped],
          cursor: snapped,
        });
      }
      return;
    }

    if (isObjectTool(tool)) {
      const allObjects = map.layers.flatMap((l) => l.objects ?? []);
      const id = nextId("o", allObjects);
      setMap(
        addObject(map, {
          id,
          type: tool,
          at: [x, y] as [number, number],
          facing: "n",
        }),
      );
      setSelection({ kind: "object", id });
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    // Always report cursor coords for the status bar.
    const cellCoord = cellFromEvent(e);
    onCursorChange([cellCoord.x, cellCoord.y]);
    if (panDrag) {
      // Drag delta is in screen px; viewBox shifts by delta/zoom in world px.
      // Drag right → vbX decreases (content appears to follow the cursor).
      setPan({
        x: panDrag.baseX - (e.clientX - panDrag.clientX) / zoom,
        y: panDrag.baseY - (e.clientY - panDrag.clientY) / zoom,
      });
      return;
    }
    if (resizeDrag) {
      const { px, py } = pxFromEvent(e);
      const cx = Math.round(px / cell / step) * step;
      const cy = Math.round(py / cell / step) * step;
      const next = resizeEntity(map, resizeDrag, cx, cy);
      if (next !== map) replaceMap(next);
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
      return;
    }
    if (pathDraft) {
      const { x, y } = cellFromEvent(e);
      if (x !== pathDraft.cursor[0] || y !== pathDraft.cursor[1]) {
        setPathDraft({ ...pathDraft, cursor: [x, y] });
      }
      return;
    }
    if (doorDraft) {
      const corner = cornerFromEvent(e);
      if (corner[0] !== doorDraft.cursor[0] || corner[1] !== doorDraft.cursor[1]) {
        setDoorDraft({ ...doorDraft, cursor: corner });
      }
      return;
    }
    if (stairsDraft) {
      const corner = cornerFromEvent(e);
      if (corner[0] !== stairsDraft.cursor[0] || corner[1] !== stairsDraft.cursor[1]) {
        setStairsDraft({ ...stairsDraft, cursor: corner });
      }
    }
  }

  function commitWallDraft(end: [number, number]) {
    if (!wallDraft) return;
    const [sx, sy] = wallDraft.start;
    let [ex, ey] = end;
    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) ey = sy;
    else ex = sx;
    if (ex === sx && ey === sy) {
      setWallDraft(null);
      return;
    }
    const allWalls = map.layers.flatMap((l) => l.walls ?? []);
    const id = nextId("w", allWalls);
    setMap(addWall(map, { id, segment: [[sx, sy], [ex, ey]] }));
    setWallDraft(null);
    setSelection({ kind: "wall", id });
  }

  function commitDoorDraft(end: [number, number]) {
    if (!doorDraft) return;
    const [sx, sy] = doorDraft.start;
    const [ex, ey] = end;
    if (sx === ex && sy === ey) {
      setDoorDraft(null);
      return;
    }
    const def = DOOR_TOOLS.find((t) => t.id === doorDraft.tool)!;
    const allDoors = map.layers.flatMap((l) => l.doors ?? []);
    const id = nextId("d", allDoors);
    setMap(
      addDoor(map, {
        id,
        segment: [[sx, sy], [ex, ey]],
        kind: def.kind,
      }),
    );
    setDoorDraft(null);
    setSelection({ kind: "door", id });
  }

  function commitPathDraft() {
    if (!pathDraft || pathDraft.points.length < 2) {
      setPathDraft(null);
      return;
    }
    const allCarves = map.layers.flatMap((l) => l.carves);
    const id = nextId("p", allCarves);
    setMap(
      addCarve(map, {
        id,
        path: pathDraft.points.map((p) => [p[0], p[1]]),
        width: 1,
      }),
    );
    setSelection({ kind: "carve", id });
    setPathDraft(null);
  }

  function snapAxisAligned(from: [number, number], to: [number, number]): [number, number] {
    const dx = Math.abs(to[0] - from[0]);
    const dy = Math.abs(to[1] - from[1]);
    return dx >= dy ? [to[0], from[1]] : [from[0], to[1]];
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (panDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setPanDrag(null);
      return;
    }
    if (resizeDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      commitMap(resizeDrag.snapshot, map);
      setResizeDrag(null);
      return;
    }
    if (moveDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      commitMap(moveDrag.snapshot, map);
      setMoveDrag(null);
      return;
    }
    // Drag-to-draw for wall / door: if the user actually dragged, commit
    // on release. If they only clicked (no movement), keep the draft and
    // wait for another click to commit.
    if (wallDraft && tool === "wall") {
      const corner = cornerFromEvent(e);
      if (corner[0] !== wallDraft.start[0] || corner[1] !== wallDraft.start[1]) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        commitWallDraft(corner);
        return;
      }
    }
    if (doorDraft && isDoorTool(tool)) {
      const corner = cornerFromEvent(e);
      if (corner[0] !== doorDraft.start[0] || corner[1] !== doorDraft.start[1]) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        commitDoorDraft(corner);
        return;
      }
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
      setPathDraft(null);
      setDoorDraft(null);
      setStairsDraft(null);
      return;
    }
    if (e.key === "Enter" && pathDraft && pathDraft.points.length >= 2) {
      commitPathDraft();
      e.preventDefault();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      if (selection.kind === "carve") {
        setMap(removeCarve(map, selection.id));
      } else if (selection.kind === "object") {
        setMap(removeObject(map, selection.id));
      } else if (selection.kind === "wall") {
        setMap(removeWall(map, selection.id));
      } else if (selection.kind === "door") {
        setMap(removeDoor(map, selection.id));
      } else if (selection.kind === "stairs") {
        setMap(removeStairs(map, selection.id));
      } else {
        setMap(removeNote(map, selection.id));
      }
      setSelection(null);
      e.preventDefault();
    }
  }

  // Selection indicator (box or line, in pixels). Searches every layer.
  type SelDraw =
    | { kind: "box"; x: number; y: number; w: number; h: number }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number };
  type SelDrawDoor = { kind: "door-line"; x1: number; y1: number; x2: number; y2: number };
  type SelDrawStairs = { kind: "anchors"; pts: [number, number][] };
  type AnySelDraw = SelDraw | SelDrawDoor | SelDrawStairs;
  const selectionDraw: AnySelDraw | null = (() => {
    if (!selection) return null;
    for (const layer of map.layers) {
      if (selection.kind === "note") {
        const n = (layer.notes ?? []).find((n) => n.id === selection.id);
        if (n) {
          return { kind: "box", x: n.at[0] * cell, y: n.at[1] * cell, w: cell, h: cell };
        }
        continue;
      }
      if (selection.kind === "carve") {
        const c = layer.carves.find((c) => c.id === selection.id);
        if (c && !isRectCarve(c)) {
          // Path carve: outline the union of its segment rects with a
          // single bbox. Mirrors Rust's segment_bbox for each window.
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 1; i < c.path.length; i++) {
            const [ax, ay] = c.path[i - 1];
            const [bx, by] = c.path[i];
            let rx: number, ry: number, rw: number, rh: number;
            if (ay === by) {
              rx = Math.min(ax, bx); ry = ay;
              rw = Math.abs(bx - ax) + 1; rh = c.width;
            } else if (ax === bx) {
              rx = ax; ry = Math.min(ay, by);
              rw = c.width; rh = Math.abs(by - ay) + 1;
            } else {
              continue;
            }
            if (rx < minX) minX = rx;
            if (ry < minY) minY = ry;
            if (rx + rw > maxX) maxX = rx + rw;
            if (ry + rh > maxY) maxY = ry + rh;
          }
          if (minX !== Infinity) {
            return {
              kind: "box",
              x: minX * cell, y: minY * cell,
              w: (maxX - minX) * cell, h: (maxY - minY) * cell,
            };
          }
        }
        if (c && isRectCarve(c)) {
          const [x, y, w, h] = c.rect;
          return { kind: "box", x: x * cell, y: y * cell, w: w * cell, h: h * cell };
        }
      } else if (selection.kind === "object") {
        const o = (layer.objects ?? []).find((o) => o.id === selection.id);
        if (o) {
          return { kind: "box", x: o.at[0] * cell, y: o.at[1] * cell, w: cell, h: cell };
        }
      } else if (selection.kind === "wall") {
        const w = (layer.walls ?? []).find((w) => w.id === selection.id);
        if (w) {
          const [[ax, ay], [bx, by]] = w.segment;
          return {
            kind: "line",
            x1: ax * cell, y1: ay * cell, x2: bx * cell, y2: by * cell,
          };
        }
      } else if (selection.kind === "door") {
        const d = (layer.doors ?? []).find((d) => d.id === selection.id);
        if (d) {
          const [[ax, ay], [bx, by]] = d.segment;
          return {
            kind: "door-line",
            x1: ax * cell, y1: ay * cell, x2: bx * cell, y2: by * cell,
          };
        }
      } else if (selection.kind === "stairs") {
        const st = (layer.stairs ?? []).find((s) => s.id === selection.id);
        if (st) {
          return {
            kind: "anchors",
            pts: st.anchors.map(([x, y]) => [x * cell, y * cell]),
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

  // Path-draft preview points & segments.
  const pathPreview = (() => {
    if (!pathDraft) return null;
    const last = pathDraft.points[pathDraft.points.length - 1];
    const snappedCursor = snapAxisAligned(last, pathDraft.cursor);
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 1; i < pathDraft.points.length; i++) {
      const a = pathDraft.points[i - 1];
      const b = pathDraft.points[i];
      segments.push({
        x1: a[0] * cell, y1: a[1] * cell,
        x2: b[0] * cell, y2: b[1] * cell,
      });
    }
    // Pending leg from the last committed point to the snapped cursor.
    segments.push({
      x1: last[0] * cell, y1: last[1] * cell,
      x2: snappedCursor[0] * cell, y2: snappedCursor[1] * cell,
    });
    return {
      segments,
      points: pathDraft.points.map(([x, y]) => ({
        cx: (x + 0.5) * cell,
        cy: (y + 0.5) * cell,
      })),
    };
  })();

  // Door/stairs draft preview shapes.
  const doorPreview = doorDraft && (() => {
    const [sx, sy] = doorDraft.start;
    const [ex, ey] = doorDraft.cursor;
    return { x1: sx * cell, y1: sy * cell, x2: ex * cell, y2: ey * cell };
  })();

  const stairsPreview = stairsDraft && (() => {
    return stairsDraft.points.map(([x, y]) => ({ x: x * cell, y: y * cell }));
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
    >
      {/* Single SVG fills the wrapper; viewBox drives pan/zoom, so the
          drawable area is genuinely unbounded in every direction. */}
      <svg
        ref={svgRef}
        className="editor-svg"
        width="100%"
        height="100%"
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMinYMin slice"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          setDrag(null);
          setPanDrag(null);
          setMoveDrag(null);
          setResizeDrag(null);
        }}
        onPointerLeave={() => onCursorChange(null)}
      >
        <defs>
          <pattern
            id="editor-grid"
            x={0}
            y={0}
            width={cell}
            height={cell}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${cell} 0 L 0 0 L 0 ${cell}`}
              fill="none"
              stroke="#1f1f22"
              strokeWidth={0.6}
            />
          </pattern>
        </defs>
        {/* Black void + grid fill the visible viewBox — they re-size every
            render to match pan/zoom, so the grid extends infinitely. */}
        <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="#000000" />
        <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="url(#editor-grid)" />

        {/* Rust-rendered map content. innerHTML is set by an effect; the
            inner SVG nodes use world-pixel coords that align with this
            outer SVG's coord system. */}
        <g ref={rustGroupRef} />

        {/* Overlay: drag preview + selection. */}
        {dragPreview && (
          <rect
            x={dragPreview.x}
            y={dragPreview.y}
            width={dragPreview.w}
            height={dragPreview.h}
            fill="rgba(201, 168, 106, 0.18)"
            stroke="#c9a86a"
            strokeWidth={2 / zoom}
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
            strokeWidth={2 / zoom}
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
            strokeWidth={6 / zoom}
            strokeOpacity={0.45}
            strokeLinecap="round"
          />
        )}
        {/* Resize handles. 1/zoom factor keeps them screen-constant size. */}
        {tool === "select" && selectionDraw?.kind === "box" && (
          <g pointerEvents="none">
            {CARVE_HANDLES.map((h) => {
              const hx = selectionDraw.x + selectionDraw.w * h.fx;
              const hy = selectionDraw.y + selectionDraw.h * h.fy;
              const r = 6 / zoom;
              return (
                <rect
                  key={h.dir}
                  data-handle={h.dir}
                  x={hx - r}
                  y={hy - r}
                  width={r * 2}
                  height={r * 2}
                  fill="#c9a86a"
                  stroke="#1c1d20"
                  strokeWidth={1 / zoom}
                  pointerEvents="auto"
                  style={{ cursor: h.cursor }}
                />
              );
            })}
          </g>
        )}
        {tool === "select" && (selectionDraw?.kind === "line" || selectionDraw?.kind === "door-line") && (
          <g pointerEvents="none">
            {(() => {
              const prefix = selectionDraw.kind === "door-line" ? "door" : "wall";
              const pts = [
                { dir: `${prefix}-start` as const, cx: selectionDraw.x1, cy: selectionDraw.y1 },
                { dir: `${prefix}-end`   as const, cx: selectionDraw.x2, cy: selectionDraw.y2 },
              ];
              return pts.map((h) => (
                <circle
                  key={h.dir}
                  data-handle={h.dir}
                  cx={h.cx}
                  cy={h.cy}
                  r={7 / zoom}
                  fill="#c9a86a"
                  stroke="#1c1d20"
                  strokeWidth={1 / zoom}
                  pointerEvents="auto"
                  style={{ cursor: "move" }}
                />
              ));
            })()}
          </g>
        )}
        {tool === "select" && selectionDraw?.kind === "anchors" && (
          <g pointerEvents="none">
            {selectionDraw.pts.map((p, i) => (
              <circle
                key={i}
                data-handle={`stairs-${i}`}
                cx={p[0]}
                cy={p[1]}
                r={7 / zoom}
                fill="#c9a86a"
                stroke="#1c1d20"
                strokeWidth={1 / zoom}
                pointerEvents="auto"
                style={{ cursor: "move" }}
              />
            ))}
          </g>
        )}
        {selectionDraw?.kind === "door-line" && (
          <line
            x1={selectionDraw.x1}
            y1={selectionDraw.y1}
            x2={selectionDraw.x2}
            y2={selectionDraw.y2}
            stroke="#c9a86a"
            strokeWidth={6 / zoom}
            strokeOpacity={0.45}
            strokeLinecap="round"
          />
        )}
        {selectionDraw?.kind === "anchors" && (
          <polygon
            points={selectionDraw.pts.map(p => `${p[0]},${p[1]}`).join(" ")}
            fill="rgba(201, 168, 106, 0.18)"
            stroke="#c9a86a"
            strokeWidth={2 / zoom}
            strokeDasharray="6 4"
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
            <circle cx={wallPreview.x1} cy={wallPreview.y1} r={4 / zoom} fill="#c9a86a" />
          </>
        )}
        {doorPreview && (
          <>
            <line
              x1={doorPreview.x1}
              y1={doorPreview.y1}
              x2={doorPreview.x2}
              y2={doorPreview.y2}
              stroke="#c9a86a"
              strokeWidth={cell * 0.36}
              strokeOpacity={0.4}
              strokeLinecap="square"
            />
            <circle cx={doorPreview.x1} cy={doorPreview.y1} r={4 / zoom} fill="#c9a86a" />
            <circle cx={doorPreview.x2} cy={doorPreview.y2} r={4 / zoom} fill="#c9a86a" />
          </>
        )}
        {stairsPreview && (
          <>
            {stairsPreview.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 / zoom} fill="#c9a86a" stroke="#1c1d20" strokeWidth={1 / zoom} />
            ))}
            {stairsPreview.length === 2 && (
              <line
                x1={stairsPreview[0].x}
                y1={stairsPreview[0].y}
                x2={stairsPreview[1].x}
                y2={stairsPreview[1].y}
                stroke="#c9a86a"
                strokeWidth={2 / zoom}
                strokeDasharray="6 4"
              />
            )}
          </>
        )}
        {pathPreview && (
          <g>
            {pathPreview.segments.map((s, i) => (
              <line
                key={i}
                x1={s.x1 + cell / 2}
                y1={s.y1 + cell / 2}
                x2={s.x2 + cell / 2}
                y2={s.y2 + cell / 2}
                stroke="#c9a86a"
                strokeWidth={cell * 0.85}
                strokeOpacity={0.30}
                strokeLinecap="square"
              />
            ))}
            {pathPreview.points.map((p, i) => (
              <circle
                key={i}
                cx={p.cx}
                cy={p.cy}
                r={4 / zoom}
                fill="#c9a86a"
                stroke="#1c1d20"
                strokeWidth={1 / zoom}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
