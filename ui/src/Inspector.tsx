import type { Selection } from "./Editor";
import {
  isRectCarve,
  removeCarve,
  removeObject,
  removeWall,
  updateObject,
  type Map,
} from "./state";

type Props = {
  map: Map;
  setMap: (m: Map) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
};

const FACINGS = ["", "ew", "ns", "n", "s", "e", "w"] as const;

const FACING_LABEL: Record<string, string> = {
  "": "—",
  ew: "EW",
  ns: "NS",
  n: "N",
  s: "S",
  e: "E",
  w: "W",
};

export function Inspector({ map, setMap, selection, setSelection }: Props) {
  if (!selection) {
    return (
      <div className="inspector empty-inspector">
        <h3>Inspector</h3>
        <p className="hint">Select a carve, object, or wall to edit it.</p>
      </div>
    );
  }

  const layer = map.layers[0];

  if (selection.kind === "carve") {
    const carve = layer.carves.find((c) => c.id === selection.id);
    if (!carve || !isRectCarve(carve)) return null;
    const [x, y, w, h] = carve.rect;
    return (
      <div className="inspector">
        <h3>Carve · rect</h3>
        <Field label="id" value={carve.id} />
        <Field label="rect" value={`${x}, ${y}, ${w}×${h}`} />
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
    const wall = (layer.walls ?? []).find((w) => w.id === selection.id);
    if (!wall) return null;
    const [[ax, ay], [bx, by]] = wall.segment;
    return (
      <div className="inspector">
        <h3>Wall</h3>
        <Field label="id" value={wall.id} />
        <Field label="from" value={`(${ax}, ${ay})`} />
        <Field label="to" value={`(${bx}, ${by})`} />
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
  const obj = (layer.objects ?? []).find((o) => o.id === selection.id);
  if (!obj) return null;
  const facing = obj.facing ?? "";

  return (
    <div className="inspector">
      <h3>{obj.type}</h3>
      <Field label="id" value={obj.id} />
      <Field label="at" value={`(${obj.at[0]}, ${obj.at[1]})`} />
      <div className="field">
        <label>facing</label>
        <div className="facing-row">
          {FACINGS.map((f) => (
            <button
              key={f || "none"}
              className={facing === f ? "facing active" : "facing"}
              onClick={() =>
                setMap(
                  updateObject(map, obj.id, {
                    facing: f === "" ? undefined : (f as typeof obj.facing),
                  }),
                )
              }
            >
              {FACING_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
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
