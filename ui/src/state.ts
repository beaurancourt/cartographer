// TS mirror of cartographer-core::model. Loose where it doesn't matter to
// the editor; the Rust side is the source of truth and re-validates on save.

export type Map = {
  version: number;
  grid: { cell_size: number; ft_per_cell?: number; units?: string };
  background: { style: "ink" | "parchment" | "clean" | "blueprint" };
  layers: Layer[];
  notes?: Note[];
};

export type Audience = "shared" | "player" | "gm";

export type Layer = {
  id: string;
  style?: object;
  carves: Carve[];
  walls?: Wall[];
  doors?: Door[];
  stairs?: Stairs[];
  objects?: MapObject[];
  audience?: Audience;
};

export type Door = {
  id: string;
  segment: [[number, number], [number, number]];
  kind?: "door" | "secret-door" | "locked-door";
};

export type Stairs = {
  id: string;
  anchors: [[number, number], [number, number], [number, number]];
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
export type Note = { id: string; at: [number, number]; text: string };

export type View = "gm" | "player";

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

/// The four canonical layer ids, plus their default audience. Map files are
/// expected to contain these layers; missing ones are created lazily.
export const LAYER_IDS = ["terrain", "object", "player", "gm"] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export const LAYER_DEFAULT_AUDIENCE: Record<LayerId, Audience> = {
  terrain: "shared",
  object: "shared",
  player: "player",
  gm: "gm",
};

export const LAYER_LABEL: Record<LayerId, string> = {
  terrain: "Terrain",
  object: "Object",
  player: "Player",
  gm: "GM",
};

/// Where new entities of each type land by default.
export function defaultLayerForCarve(): LayerId {
  return "terrain";
}
export function defaultLayerForWall(): LayerId {
  return "terrain";
}
export function defaultLayerForObject(_type: string): LayerId {
  return "object";
}
export function defaultLayerForDoor(kind: Door["kind"]): LayerId {
  // Secret doors are GM-visible-as-secret + player-discovery-only — they go
  // on the player layer so players see them once revealed. Locked doors
  // appear in both views (player sees a plain door); they belong on object.
  return kind === "secret-door" ? "player" : "object";
}
export function defaultLayerForStairs(): LayerId {
  return "object";
}

// ── mutators ────────────────────────────────────────────────────────────────

export function addCarve(map: Map, carve: Carve): Map {
  return addToLayer(map, defaultLayerForCarve(), (l) => ({
    ...l,
    carves: [...l.carves, carve],
  }));
}

export function addWall(map: Map, wall: Wall): Map {
  return addToLayer(map, defaultLayerForWall(), (l) => ({
    ...l,
    walls: [...(l.walls ?? []), wall],
  }));
}

export function addObject(map: Map, obj: MapObject): Map {
  return addToLayer(map, defaultLayerForObject(obj.type), (l) => ({
    ...l,
    objects: [...(l.objects ?? []), obj],
  }));
}

export function removeCarve(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    carves: l.carves.filter((c) => c.id !== id),
  }));
}

export function removeObject(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    objects: (l.objects ?? []).filter((o) => o.id !== id),
  }));
}

export function removeWall(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    walls: (l.walls ?? []).filter((w) => w.id !== id),
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

export function addDoor(map: Map, door: Door): Map {
  return addToLayer(map, defaultLayerForDoor(door.kind), (l) => ({
    ...l,
    doors: [...(l.doors ?? []), door],
  }));
}

export function removeDoor(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    doors: (l.doors ?? []).filter((d) => d.id !== id),
  }));
}

export function updateDoor(map: Map, id: string, patch: Partial<Door>): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    doors: (l.doors ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
  }));
}

export function addStairs(map: Map, stairs: Stairs): Map {
  return addToLayer(map, defaultLayerForStairs(), (l) => ({
    ...l,
    stairs: [...(l.stairs ?? []), stairs],
  }));
}

export function removeStairs(map: Map, id: string): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    stairs: (l.stairs ?? []).filter((s) => s.id !== id),
  }));
}

export function updateStairs(map: Map, id: string, patch: Partial<Stairs>): Map {
  return updateAllLayers(map, (l) => ({
    ...l,
    stairs: (l.stairs ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));
}

export function addNote(map: Map, note: Note): Map {
  return { ...map, notes: [...(map.notes ?? []), note] };
}

export function removeNote(map: Map, id: string): Map {
  return { ...map, notes: (map.notes ?? []).filter((n) => n.id !== id) };
}

export function updateNote(map: Map, id: string, patch: Partial<Note>): Map {
  return {
    ...map,
    notes: (map.notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)),
  };
}

/// Move an entity to a different layer. Creates the target layer if needed.
export function setEntityLayer(map: Map, id: string, targetLayerId: string): Map {
  let entity:
    | { kind: "carve"; payload: Carve }
    | { kind: "object"; payload: MapObject }
    | { kind: "wall"; payload: Wall }
    | { kind: "door"; payload: Door }
    | { kind: "stairs"; payload: Stairs }
    | null = null;
  for (const layer of map.layers) {
    const c = layer.carves.find((c) => c.id === id);
    if (c) { entity = { kind: "carve", payload: c }; break; }
    const o = (layer.objects ?? []).find((o) => o.id === id);
    if (o) { entity = { kind: "object", payload: o }; break; }
    const w = (layer.walls ?? []).find((w) => w.id === id);
    if (w) { entity = { kind: "wall", payload: w }; break; }
    const d = (layer.doors ?? []).find((d) => d.id === id);
    if (d) { entity = { kind: "door", payload: d }; break; }
    const st = (layer.stairs ?? []).find((s) => s.id === id);
    if (st) { entity = { kind: "stairs", payload: st }; break; }
  }
  if (!entity) return map;

  // Drop the entity from every layer.
  let next: Map = updateAllLayers(map, (l) => ({
    ...l,
    carves: l.carves.filter((c) => c.id !== id),
    objects: (l.objects ?? []).filter((o) => o.id !== id),
    walls: (l.walls ?? []).filter((w) => w.id !== id),
    doors: (l.doors ?? []).filter((d) => d.id !== id),
    stairs: (l.stairs ?? []).filter((s) => s.id !== id),
  }));

  // Re-insert into the target layer (creating it if missing).
  next = addToLayer(next, targetLayerId as LayerId, (l) => {
    switch (entity!.kind) {
      case "carve":  return { ...l, carves: [...l.carves, entity!.payload] };
      case "object": return { ...l, objects: [...(l.objects ?? []), entity!.payload] };
      case "wall":   return { ...l, walls: [...(l.walls ?? []), entity!.payload] };
      case "door":   return { ...l, doors: [...(l.doors ?? []), entity!.payload] };
      case "stairs": return { ...l, stairs: [...(l.stairs ?? []), entity!.payload] };
    }
  });
  return next;
}

function addToLayer(map: Map, layerId: string, fn: (l: Layer) => Layer): Map {
  let idx = map.layers.findIndex((l) => l.id === layerId);
  let layers = map.layers;
  if (idx < 0) {
    // Lazily create the layer with its canonical audience.
    const audience = (LAYER_DEFAULT_AUDIENCE as Record<string, Audience>)[layerId] ?? "shared";
    layers = [
      ...layers,
      { id: layerId, carves: [], walls: [], objects: [], audience },
    ];
    idx = layers.length - 1;
  }
  return {
    ...map,
    layers: layers.map((l, i) => (i === idx ? fn(l) : l)),
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
    if ((l.doors ?? []).some((d) => d.id === id)) return i;
    if ((l.stairs ?? []).some((s) => s.id === id)) return i;
  }
  return -1;
}

/// Bounding box of all map content in *cell* coordinates.
export function mapBbox(map: Map): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  function grow(x: number, y: number, x2: number, y2: number) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
    any = true;
  }

  for (const layer of map.layers) {
    for (const c of layer.carves) {
      if (isRectCarve(c)) {
        const [x, y, w, h] = c.rect;
        grow(x, y, x + w, y + h);
      } else {
        for (const p of c.path) grow(p[0], p[1], p[0] + 1, p[1] + 1);
      }
    }
    for (const w of layer.walls ?? []) {
      const [[ax, ay], [bx, by]] = w.segment;
      grow(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    }
    for (const d of layer.doors ?? []) {
      const [[ax, ay], [bx, by]] = d.segment;
      grow(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    }
    for (const st of layer.stairs ?? []) {
      for (const p of st.anchors) grow(p[0], p[1], p[0], p[1]);
    }
    for (const o of layer.objects ?? []) {
      grow(o.at[0], o.at[1], o.at[0] + 1, o.at[1] + 1);
    }
  }
  if (!any) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/// Object kinds we expose as toolbar tools. Doors and stairs aren't here —
/// they're their own anchor-based tools (see DOOR_TOOLS / "stairs" tool).
export const OBJECT_TOOLS = [
  { id: "pit-trap", label: "Pit trap" },
  { id: "altar", label: "Altar" },
  { id: "fountain", label: "Fountain" },
  { id: "column", label: "Column" },
  { id: "fireplace", label: "Fireplace" },
  { id: "statue", label: "Statue" },
  { id: "throne", label: "Throne" },
  { id: "rubble", label: "Rubble" },
  { id: "water", label: "Water" },
] as const;

export type ObjectTool = (typeof OBJECT_TOOLS)[number]["id"];

export const DOOR_TOOLS = [
  { id: "door", label: "Door", kind: "door" as const },
  { id: "secret-door", label: "Secret door", kind: "secret-door" as const },
  { id: "locked-door", label: "Locked door", kind: "locked-door" as const },
] as const;

export type DoorTool = (typeof DOOR_TOOLS)[number]["id"];

export type SnapMode = 1 | 2 | 3 | 4 | 6 | 12;

export const SNAP_OPTIONS: { value: SnapMode; label: string }[] = [
  { value: 1, label: "1 cell" },
  { value: 2, label: "½" },
  { value: 3, label: "⅓" },
  { value: 4, label: "¼" },
  { value: 6, label: "⅙" },
  { value: 12, label: "¹⁄₁₂" },
];
