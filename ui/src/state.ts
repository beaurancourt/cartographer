// TS mirror of cartographer-core::model. Loose where it doesn't matter to
// the editor; the Rust side is the source of truth and re-validates on save.

export type Map = {
  version: number;
  grid: { cell_size: number; ft_per_cell?: number; units?: string };
  background: { style: "ink" | "parchment" | "clean" | "blueprint" };
  layers: Layer[];
  notes?: Note[];
};

export type Layer = {
  id: string;
  style?: object;
  carves: Carve[];
  walls?: Wall[];
  objects?: MapObject[];
  gm_only?: boolean;
};

export type View = "gm" | "player";

/// Pick the layer index that new entities should be added to. Prefer the
/// first non-gm-only layer; fall back to index 0 if all layers are gm-only.
export function activeLayerIndex(map: Map): number {
  const idx = map.layers.findIndex((l) => !l.gm_only);
  return idx >= 0 ? idx : 0;
}

// Untagged enum (matches Rust serde): a Rect has `rect`, a Path has `path`.
export type Carve = RectCarve | PathCarve;
export type RectCarve = { id: string; rect: [number, number, number, number] };
export type PathCarve = { id: string; path: [number, number][]; width: number };

export type Wall = { id: string; segment: [[number, number], [number, number]] };
export type MapObject = {
  id: string;
  type: string;
  at: [number, number];
  facing?: "n" | "s" | "e" | "w" | "ns" | "ew";
};
export type Note = { at: [number, number]; text: string };

export function isRectCarve(c: Carve): c is RectCarve {
  return "rect" in c;
}

export function nextId(prefix: string, existing: { id: string }[]): string {
  let n = existing.length + 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${prefix}${n}`;
    if (!existing.some((e) => e.id === candidate)) return candidate;
    n += 1;
  }
}

export function addCarve(map: Map, carve: Carve): Map {
  return addToActiveLayer(map, (l) => ({ ...l, carves: [...l.carves, carve] }));
}

export function removeCarve(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    carves: l.carves.filter((c) => c.id !== id),
  }));
}

export function addObject(map: Map, obj: MapObject): Map {
  return addToActiveLayer(map, (l) => ({
    ...l,
    objects: [...(l.objects ?? []), obj],
  }));
}

export function removeObject(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    objects: (l.objects ?? []).filter((o) => o.id !== id),
  }));
}

export function updateObject(
  map: Map,
  id: string,
  patch: Partial<MapObject>,
): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    objects: (l.objects ?? []).map((o) =>
      o.id === id ? { ...o, ...patch } : o,
    ),
  }));
}

export function addWall(map: Map, wall: Wall): Map {
  return addToActiveLayer(map, (l) => ({
    ...l,
    walls: [...(l.walls ?? []), wall],
  }));
}

export function removeWall(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    walls: (l.walls ?? []).filter((w) => w.id !== id),
  }));
}

export function updateCarve(map: Map, id: string, patch: Partial<RectCarve>): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    carves: l.carves.map((c) =>
      c.id === id && isRectCarve(c) ? { ...c, ...patch } : c,
    ),
  }));
}

export function updateWall(map: Map, id: string, patch: Partial<Wall>): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    walls: (l.walls ?? []).map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
}

/// Move an entity between the gm-only layer and the main layer. Creates the
/// target layer if it doesn't exist.
export function setEntityGmOnly(map: Map, id: string, gmOnly: boolean): Map {
  // Snapshot the entity, then drop it from wherever it is, then drop it into
  // the layer matching the desired gm_only flag.
  let entity: { kind: "carve" | "object" | "wall"; payload: Carve | MapObject | Wall } | null = null;
  for (const layer of map.layers) {
    const c = layer.carves.find((c) => c.id === id);
    if (c) { entity = { kind: "carve", payload: c }; break; }
    const o = (layer.objects ?? []).find((o) => o.id === id);
    if (o) { entity = { kind: "object", payload: o }; break; }
    const w = (layer.walls ?? []).find((w) => w.id === id);
    if (w) { entity = { kind: "wall", payload: w }; break; }
  }
  if (!entity) return map;

  // Drop from all layers.
  let next: Map = updateAllLayers(map, (l) => ({
    ...l,
    carves: l.carves.filter((c) => c.id !== id),
    objects: (l.objects ?? []).filter((o) => o.id !== id),
    walls: (l.walls ?? []).filter((w) => w.id !== id),
  }));

  // Ensure a target layer with the matching gm_only flag exists.
  let targetIdx = next.layers.findIndex((l) => Boolean(l.gm_only) === gmOnly);
  if (targetIdx < 0) {
    next = {
      ...next,
      layers: [
        ...next.layers,
        {
          id: gmOnly ? "secrets" : "main",
          carves: [],
          walls: [],
          objects: [],
          gm_only: gmOnly,
        },
      ],
    };
    targetIdx = next.layers.length - 1;
  }

  return {
    ...next,
    layers: next.layers.map((l, i) => {
      if (i !== targetIdx) return l;
      if (entity!.kind === "carve") {
        return { ...l, carves: [...l.carves, entity!.payload as Carve] };
      }
      if (entity!.kind === "object") {
        return { ...l, objects: [...(l.objects ?? []), entity!.payload as MapObject] };
      }
      return { ...l, walls: [...(l.walls ?? []), entity!.payload as Wall] };
    }),
  };
}

function addToActiveLayer(map: Map, fn: (l: Layer) => Layer): Map {
  const idx = activeLayerIndex(map);
  return {
    ...map,
    layers: map.layers.map((l, i) => (i === idx ? fn(l) : l)),
  };
}

function updateAllLayers(map: Map, fn: (l: Layer) => Layer): Map {
  return { ...map, layers: map.layers.map(fn) };
}

/// Find which layer an entity lives in. -1 if not found.
export function findEntityLayer(map: Map, id: string): number {
  for (let i = 0; i < map.layers.length; i++) {
    const l = map.layers[i];
    if (l.carves.some((c) => c.id === id)) return i;
    if ((l.objects ?? []).some((o) => o.id === id)) return i;
    if ((l.walls ?? []).some((w) => w.id === id)) return i;
  }
  return -1;
}

/// Object kinds we expose as toolbar tools. Defaults pre-fill the placed
/// MapObject — facing is `ew` for doors (slot bridges horizontal gap),
/// `s` for stairs (going off-south), unset otherwise.
export const OBJECT_TOOLS = [
  { id: "door", label: "Door", defaultFacing: "ew" as const },
  { id: "secret-door", label: "Secret door", defaultFacing: "ew" as const },
  { id: "locked-door", label: "Locked door", defaultFacing: "ew" as const },
  { id: "pit-trap", label: "Pit trap" },
  { id: "stairs-down", label: "Stairs ↓", defaultFacing: "s" as const },
  { id: "stairs-up", label: "Stairs ↑", defaultFacing: "n" as const },
  { id: "altar", label: "Altar" },
  { id: "fountain", label: "Fountain" },
  { id: "column", label: "Column" },
] as const;

export type ObjectTool = (typeof OBJECT_TOOLS)[number]["id"];

/// Snap denominator. The actual snap step is `1 / SnapMode` cells. 12 is the
/// finest representable position (matches the base-12 internal coord system).
export type SnapMode = 1 | 2 | 3 | 4 | 6 | 12;

export const SNAP_OPTIONS: { value: SnapMode; label: string }[] = [
  { value: 1, label: "1 cell" },
  { value: 2, label: "½" },
  { value: 3, label: "⅓" },
  { value: 4, label: "¼" },
  { value: 6, label: "⅙" },
  { value: 12, label: "¹⁄₁₂" },
];
