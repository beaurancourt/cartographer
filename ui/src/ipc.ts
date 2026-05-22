import { invoke } from "@tauri-apps/api/core";

// Mirror of cartographer_core::model — kept loose since the Rust side is the
// source of truth and we just round-trip the value back through `render_map_svg`.
export type Map = unknown;

export async function loadMap(path: string): Promise<Map> {
  return await invoke<Map>("load_map", { path });
}

export async function parseMap(yaml: string): Promise<Map> {
  return await invoke<Map>("parse_map", { yaml });
}

export async function renderMapSvg(map: Map, showGrid = true): Promise<string> {
  return await invoke<string>("render_map_svg", { map, showGrid });
}

export async function exportImage(map: Map, path: string): Promise<void> {
  await invoke("export_image", { map, path });
}
