import { useEffect, useRef, useState } from "react";
import { renderMapSvg } from "./ipc";
import {
  addCarve,
  addObject,
  isRectCarve,
  nextId,
  removeCarve,
  removeObject,
  type Map,
  type ObjectTool,
} from "./state";
import { OBJECT_TOOLS } from "./state";

const COLS = 40;
const ROWS = 28;

export type Tool = "select" | "rect" | ObjectTool;

const OBJECT_TOOL_IDS = new Set<string>(OBJECT_TOOLS.map((t) => t.id));

function isObjectTool(t: Tool): t is ObjectTool {
  return OBJECT_TOOL_IDS.has(t);
}

type Drag = { x0: number; y0: number; x1: number; y1: number };

type SelectionKind = "carve" | "object";
type Selection = { kind: SelectionKind; id: string };

type Props = {
  map: Map;
  setMap: (m: Map) => void;
  tool: Tool;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
};

export function Editor({ map, setMap, tool, selection, setSelection }: Props) {
  const cell = map.grid.cell_size;
  const W = COLS * cell;
  const H = ROWS * cell;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [drag, setDrag] = useState<Drag | null>(null);

  // Live render via Rust on every map change. For a fixed editor canvas we
  // force the viewBox to [0, 0, W, H] and skip the background so the
  // editor's own grid shows through the void.
  useEffect(() => {
    let cancel = false;
    renderMapSvg(map, {
      viewbox: [0, 0, W, H],
      transparentBackground: true,
      showGrid: true,
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
  }, [map, W, H]);

  function cellFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const wrap = wrapperRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    const sx = W / rect.width;
    const sy = H / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    return { x: Math.floor(px / cell), y: Math.floor(py / cell) };
  }

  function hitTest(x: number, y: number): Selection | null {
    const layer = map.layers[0];
    if (!layer) return null;
    // Objects are on top of carves visually; check them first.
    for (const obj of [...(layer.objects ?? [])].reverse()) {
      if (obj.at[0] === x && obj.at[1] === y) {
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
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = cellFromEvent(e);

    if (tool === "rect") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    if (tool === "select") {
      setSelection(hitTest(x, y));
      return;
    }

    if (isObjectTool(tool)) {
      const def = OBJECT_TOOLS.find((t) => t.id === tool)!;
      const id = nextId("o", map.layers[0].objects ?? []);
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
    if (!drag) return;
    const { x, y } = cellFromEvent(e);
    if (x === drag.x1 && y === drag.y1) return;
    setDrag({ ...drag, x1: x, y1: y });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0) + 1;
    const h = Math.abs(drag.y1 - drag.y0) + 1;
    setDrag(null);
    if (w <= 0 || h <= 0) return;
    const id = nextId("r", map.layers[0].carves);
    setMap(addCarve(map, { id, rect: [x, y, w, h] }));
    setSelection({ kind: "carve", id });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      if (selection.kind === "carve") {
        setMap(removeCarve(map, selection.id));
      } else {
        setMap(removeObject(map, selection.id));
      }
      setSelection(null);
      e.preventDefault();
    }
  }

  // Selection indicator box (in pixels).
  const selectionBox = (() => {
    if (!selection) return null;
    const layer = map.layers[0];
    if (selection.kind === "carve") {
      const c = layer.carves.find((c) => c.id === selection.id);
      if (!c || !isRectCarve(c)) return null;
      const [x, y, w, h] = c.rect;
      return { x: x * cell, y: y * cell, w: w * cell, h: h * cell };
    } else {
      const o = (layer.objects ?? []).find((o) => o.id === selection.id);
      if (!o) return null;
      return { x: o.at[0] * cell, y: o.at[1] * cell, w: cell, h: cell };
    }
  })();

  const dragPreview =
    drag &&
    (() => {
      const x = Math.min(drag.x0, drag.x1) * cell;
      const y = Math.min(drag.y0, drag.y1) * cell;
      const w = (Math.abs(drag.x1 - drag.x0) + 1) * cell;
      const h = (Math.abs(drag.y1 - drag.y0) + 1) * cell;
      return { x, y, w, h };
    })();

  const cursorClass =
    tool === "select" ? "cursor-select" : tool === "rect" ? "cursor-cross" : "cursor-place";

  return (
    <div
      ref={wrapperRef}
      className={`editor ${cursorClass}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Layer 1: black background + faint void grid so the user can plan placement. */}
      <svg className="layer-bg" viewBox={`0 0 ${W} ${H}`}>
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
      <svg className="layer-overlay" viewBox={`0 0 ${W} ${H}`}>
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
        {selectionBox && (
          <rect
            x={selectionBox.x - 1}
            y={selectionBox.y - 1}
            width={selectionBox.w + 2}
            height={selectionBox.h + 2}
            fill="none"
            stroke="#c9a86a"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
      </svg>
    </div>
  );
}
