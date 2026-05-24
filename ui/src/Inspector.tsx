import { useLayoutEffect, useRef } from "react";
import type { Selection } from "./Editor";
import {
  findEntityLayer,
  isRectCarve,
  LAYER_IDS,
  LAYER_LABEL,
  removeCarve,
  removeNote,
  removeObject,
  removeWall,
  setEntityLayer,
  updateCarve,
  updateNote,
  updateObject,
  updateWall,
  type Map,
  type MapObject,
} from "./state";

type Props = {
  map: Map;
  setMap: (m: Map) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
};

const FACINGS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

const FACING_LABEL: Record<string, string> = {
  n: "N",
  ne: "NE",
  e: "E",
  se: "SE",
  s: "S",
  sw: "SW",
  w: "W",
  nw: "NW",
};

export function Inspector({ map, setMap, selection, setSelection }: Props) {
  // Explicit focus management for the note text input. autoFocus is unreliable
  // here because the editor wrapper div (tabIndex=0) grabs focus on the same
  // pointerdown that places the note — useLayoutEffect runs after React's
  // commit and reliably wins the focus race.
  const noteInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (selection?.kind !== "note") return;
    const input = noteInputRef.current;
    if (!input) return;
    if (input.value === "") input.focus();
  }, [selection?.id, selection?.kind]);

  if (!selection) {
    return (
      <div className="inspector empty-inspector">
        <h3>Inspector</h3>
        <p className="hint">Select a carve, object, or wall to edit it.</p>
        <p className="hint">
          Tools: <kbd>R</kbd> rect, <kbd>W</kbd> wall, <kbd>V</kbd> select,{" "}
          <kbd>D</kbd> door, <kbd>S</kbd> secret-door…
        </p>
        <p className="hint">
          <kbd>Space</kbd>+drag or middle-mouse pans, <kbd>⌘</kbd>+wheel zooms,{" "}
          <kbd>⌘Z</kbd>/<kbd>⇧⌘Z</kbd> undo/redo.
        </p>
      </div>
    );
  }

  const layerIdx = findEntityLayer(map, selection.id);
  const layer = map.layers[layerIdx];
  const currentLayerId = layer?.id ?? "";

  function layerPicker() {
    return (
      <div className="field">
        <label>layer</label>
        <select
          value={currentLayerId}
          onChange={(e) => setMap(setEntityLayer(map, selection!.id, e.target.value))}
        >
          {LAYER_IDS.map((id) => (
            <option key={id} value={id}>
              {LAYER_LABEL[id]}
            </option>
          ))}
          {/* Custom layer IDs (loaded from YAML, not one of the four standard) */}
          {currentLayerId && !LAYER_IDS.includes(currentLayerId as never) && (
            <option value={currentLayerId}>{currentLayerId}</option>
          )}
        </select>
      </div>
    );
  }

  if (selection.kind === "note") {
    const note = (layer?.notes ?? []).find((n) => n.id === selection.id);
    if (!note) return null;
    function setAt(axis: 0 | 1, n: number) {
      const next: [number, number] = [note!.at[0], note!.at[1]];
      next[axis] = n;
      setMap(updateNote(map, note!.id, { at: next }));
    }
    return (
      <div className="inspector">
        <h3>Note</h3>
        <Field label="id" value={note.id} />
        <div className="coord-row">
          <NumberField label="x" value={note.at[0]} onChange={(n) => setAt(0, n)} />
          <NumberField label="y" value={note.at[1]} onChange={(n) => setAt(1, n)} />
        </div>
        <div className="field">
          <label>text</label>
          <input
            ref={noteInputRef}
            type="text"
            className="text-input"
            value={note.text}
            onChange={(e) => setMap(updateNote(map, note.id, { text: e.target.value }))}
          />
        </div>
        {layerPicker()}
        <button
          className="danger"
          onClick={() => {
            setMap(removeNote(map, note.id));
            setSelection(null);
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  if (selection.kind === "carve") {
    const found = layer?.carves.find((c) => c.id === selection.id);
    if (!found || !isRectCarve(found)) return null;
    const carve = found;
    const [x, y, w, h] = carve.rect;
    function set(idx: 0 | 1 | 2 | 3, n: number) {
      const next = [...carve.rect] as [number, number, number, number];
      next[idx] = n;
      setMap(updateCarve(map, carve.id, { rect: next }));
    }
    return (
      <div className="inspector">
        <h3>Carve · rect</h3>
        <Field label="id" value={carve.id} />
        <div className="coord-row">
          <NumberField label="x" value={x} onChange={(n) => set(0, n)} />
          <NumberField label="y" value={y} onChange={(n) => set(1, n)} />
          <NumberField
            label="w"
            value={w}
            min={1}
            onChange={(n) => set(2, Math.max(1, n))}
          />
          <NumberField
            label="h"
            value={h}
            min={1}
            onChange={(n) => set(3, Math.max(1, n))}
          />
        </div>
        {layerPicker()}
        <button
          className="danger"
          onClick={() => {
            setMap(removeCarve(map, carve.id));
            setSelection(null);
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  if (selection.kind === "wall") {
    const wall = (layer?.walls ?? []).find((w) => w.id === selection.id);
    if (!wall) return null;
    const [[ax, ay], [bx, by]] = wall.segment;
    function setEnd(end: 0 | 1, axis: 0 | 1, n: number) {
      const seg = [
        [...wall!.segment[0]],
        [...wall!.segment[1]],
      ] as [[number, number], [number, number]];
      seg[end][axis] = n;
      setMap(updateWall(map, wall!.id, { segment: seg }));
    }
    return (
      <div className="inspector">
        <h3>Wall</h3>
        <Field label="id" value={wall.id} />
        <div className="coord-row">
          <NumberField label="x1" value={ax} onChange={(n) => setEnd(0, 0, n)} />
          <NumberField label="y1" value={ay} onChange={(n) => setEnd(0, 1, n)} />
        </div>
        <div className="coord-row">
          <NumberField label="x2" value={bx} onChange={(n) => setEnd(1, 0, n)} />
          <NumberField label="y2" value={by} onChange={(n) => setEnd(1, 1, n)} />
        </div>
        {layerPicker()}
        <button
          className="danger"
          onClick={() => {
            setMap(removeWall(map, wall.id));
            setSelection(null);
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  // object
  const obj = (layer?.objects ?? []).find((o) => o.id === selection.id);
  if (!obj) return null;
  const facing = obj.facing ?? "n";
  function setAt(axis: 0 | 1, n: number) {
    const next: [number, number] = [obj!.at[0], obj!.at[1]];
    next[axis] = n;
    setMap(updateObject(map, obj!.id, { at: next }));
  }

  return (
    <div className="inspector">
      <h3>{obj.type}</h3>
      <Field label="id" value={obj.id} />
      <div className="coord-row">
        <NumberField label="x" value={obj.at[0]} onChange={(n) => setAt(0, n)} />
        <NumberField label="y" value={obj.at[1]} onChange={(n) => setAt(1, n)} />
      </div>
      <div className="field">
        <label>facing</label>
        <div className="facing-row">
          {FACINGS.map((f) => (
            <button
              key={f}
              className={facing === f ? "facing active" : "facing"}
              onClick={() =>
                setMap(
                  updateObject(map, obj.id, {
                    facing: f as MapObject["facing"],
                  }),
                )
              }
            >
              {FACING_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      {layerPicker()}
      <button
        className="danger"
        onClick={() => {
          setMap(removeObject(map, obj.id));
          setSelection(null);
        }}
      >
        Delete
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="value">{value}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <div className="field num">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        step={0.5}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}
