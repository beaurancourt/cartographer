import { useMemo, useRef, useState } from "react";
import { addCarve, isRectCarve, nextId, removeCarve, type Map } from "./state";

const COLS = 40;
const ROWS = 28;

type Tool = "select" | "rect";

type Drag = {
  // Drag start and current cell (integer cells).
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type Props = {
  map: Map;
  setMap: (m: Map) => void;
  tool: Tool;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
};

export function Editor({ map, setMap, tool, selectedId, setSelectedId }: Props) {
  const cell = map.grid.cell_size;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const W = COLS * cell;
  const H = ROWS * cell;

  function cellFromEvent(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = svg.viewBox.baseVal.width / rect.width;
    const sy = svg.viewBox.baseVal.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    return { x: Math.floor(px / cell), y: Math.floor(py / cell) };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const { x, y } = cellFromEvent(e);
    if (tool === "rect") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: x, y0: y, x1: x, y1: y });
    } else if (tool === "select") {
      // Click on a carve to select it.
      const target = e.target as SVGElement;
      const id = target.getAttribute("data-carve-id");
      setSelectedId(id);
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const { x, y } = cellFromEvent(e);
    if (x === drag.x1 && y === drag.y1) return;
    setDrag({ ...drag, x1: x, y1: y });
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
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
    setSelectedId(id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      setMap(removeCarve(map, selectedId));
      setSelectedId(null);
    }
  }

  const carves = map.layers[0]?.carves ?? [];
  const rectCarves = useMemo(() => carves.filter(isRectCarve), [carves]);

  // Drag preview rectangle (in pixels).
  const dragPreview =
    drag &&
    (() => {
      const x = Math.min(drag.x0, drag.x1) * cell;
      const y = Math.min(drag.y0, drag.y1) * cell;
      const w = (Math.abs(drag.x1 - drag.x0) + 1) * cell;
      const h = (Math.abs(drag.y1 - drag.y0) + 1) * cell;
      return { x, y, w, h };
    })();

  return (
    <div className="editor" onKeyDown={handleKeyDown} tabIndex={0}>
      <svg
        ref={svgRef}
        className="editor-canvas"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {/* Background */}
        <rect x={0} y={0} width={W} height={H} fill="#000000" />

        {/* Grid lines */}
        <g stroke="#1c1c1c" strokeWidth={1}>
          {Array.from({ length: COLS + 1 }).map((_, i) => (
            <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={H} />
          ))}
          {Array.from({ length: ROWS + 1 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={i * cell} x2={W} y2={i * cell} />
          ))}
        </g>

        {/* Carves */}
        <g>
          {rectCarves.map((c) => {
            const [x, y, w, h] = c.rect;
            const isSel = c.id === selectedId;
            return (
              <g key={c.id}>
                <rect
                  data-carve-id={c.id}
                  x={x * cell}
                  y={y * cell}
                  width={w * cell}
                  height={h * cell}
                  fill="#ffffff"
                />
                {isSel && (
                  <rect
                    x={x * cell - 1}
                    y={y * cell - 1}
                    width={w * cell + 2}
                    height={h * cell + 2}
                    fill="none"
                    stroke="#c9a86a"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Floor grid (only over carves — drawn after so they show on top) */}
        <g stroke="#d0d0d0" strokeWidth={0.5} pointerEvents="none">
          {rectCarves.flatMap((c) => {
            const [x, y, w, h] = c.rect;
            const lines: JSX.Element[] = [];
            for (let i = 1; i < w; i++) {
              lines.push(
                <line
                  key={`${c.id}-v${i}`}
                  x1={(x + i) * cell}
                  y1={y * cell}
                  x2={(x + i) * cell}
                  y2={(y + h) * cell}
                />,
              );
            }
            for (let i = 1; i < h; i++) {
              lines.push(
                <line
                  key={`${c.id}-h${i}`}
                  x1={x * cell}
                  y1={(y + i) * cell}
                  x2={(x + w) * cell}
                  y2={(y + i) * cell}
                />,
              );
            }
            return lines;
          })}
        </g>

        {/* Drag preview */}
        {dragPreview && (
          <rect
            x={dragPreview.x}
            y={dragPreview.y}
            width={dragPreview.w}
            height={dragPreview.h}
            fill="rgba(255, 255, 255, 0.35)"
            stroke="#c9a86a"
            strokeWidth={2}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}
