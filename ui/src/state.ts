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
  return {
    ...map,
    layers: map.layers.map((l, i) =>
      i === 0 ? { ...l, carves: [...l.carves, carve] } : l,
    ),
  };
}

export function removeCarve(map: Map, id: string): Map {
  return {
    ...map,
    layers: map.layers.map((l, i) =>
      i === 0 ? { ...l, carves: l.carves.filter((c) => c.id !== id) } : l,
    ),
  };
}
