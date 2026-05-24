import { LAYER_LABEL, type Audience, type Map } from "./state";

type Props = {
  map: Map;
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
};

const AUDIENCE_BADGE: Record<Audience, { label: string; className: string }> = {
  shared: { label: "S", className: "shared" },
  player: { label: "P", className: "player" },
  gm: { label: "G", className: "gm" },
};

export function LayerPanel({ map, hidden, setHidden }: Props) {
  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  }

  return (
    <div className="layer-panel">
      <h4>Layers</h4>
      {map.layers.map((l) => {
        const audience = (l.audience ?? "shared") as Audience;
        const badge = AUDIENCE_BADGE[audience];
        const count =
          l.carves.length +
          (l.objects?.length ?? 0) +
          (l.walls?.length ?? 0) +
          (l.doors?.length ?? 0) +
          (l.stairs?.length ?? 0) +
          (l.notes?.length ?? 0);
        const isHidden = hidden.has(l.id);
        const label = (LAYER_LABEL as Record<string, string>)[l.id] ?? l.id;
        return (
          <button
            key={l.id}
            className={`layer-row ${isHidden ? "hidden" : ""}`}
            onClick={() => toggle(l.id)}
            title={
              isHidden
                ? `Show layer "${l.id}"`
                : `Hide layer "${l.id}" (does not change the map data)`
            }
          >
            <span className="eye" aria-hidden>
              {isHidden ? "⊘" : "⦿"}
            </span>
            <span className="name">{label}</span>
            <span className={`badge ${badge.className}`}>{badge.label}</span>
            <span className="count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
