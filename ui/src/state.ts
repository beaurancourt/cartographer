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
};

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
  return updateLayer(map, (l) => ({ ...l, carves: [...l.carves, carve] }));
}

export function removeCarve(map: Map, id: string): Map {
  return updateLayer(map, (l) => ({
    ...l,
    carves: l.carves.filter((c) => c.id !== id),
  }));
}

export function addObject(map: Map, obj: MapObject): Map {
  return updateLayer(map, (l) => ({
    ...l,
    objects: [...(l.objects ?? []), obj],
  }));
}

export function removeObject(map: Map, id: string): Map {
  return updateLayer(map, (l) => ({
    ...l,
    objects: (l.objects ?? []).filter((o) => o.id !== id),
  }));
}

export function updateObject(
  map: Map,
  id: string,
  patch: Partial<MapObject>,
): Map {
  return updateLayer(map, (l) => ({
    ...l,
    objects: (l.objects ?? []).map((o) =>
      o.id === id ? { ...o, ...patch } : o,
    ),
  }));
}

export function addWall(map: Map, wall: Wall): Map {
  return updateLayer(map, (l) => ({
    ...l,
    walls: [...(l.walls ?? []), wall],
  }));
}

export function removeWall(map: Map, id: string): Map {
  return updateLayer(map, (l) => ({
    ...l,
    walls: (l.walls ?? []).filter((w) => w.id !== id),
  }));
}

function updateLayer(map: Map, fn: (l: Layer) => Layer): Map {
  return {
    ...map,
    layers: map.layers.map((l, i) => (i === 0 ? fn(l) : l)),
  };
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
