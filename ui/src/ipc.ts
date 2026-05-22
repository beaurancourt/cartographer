import { invoke } from "@tauri-apps/api/core";
import type { Map } from "./state";

export async function loadMap(path: string): Promise<Map> {
  return await invoke<Map>("load_map", { path });
}

export async function parseMap(yaml: string): Promise<Map> {
  return await invoke<Map>("parse_map", { yaml });
}

export async function newMap(): Promise<Map> {
  return await invoke<Map>("new_map");
}

export async function saveMap(map: Map, path: string): Promise<void> {
  await invoke("save_map", { map, path });
}

export async function renderMapSvg(map: Map, showGrid = true): Promise<string> {
  return await invoke<string>("render_map_svg", { map, showGrid });
}

export async function exportImage(map: Map, path: string): Promise<void> {
  await invoke("export_image", { map, path });
}
