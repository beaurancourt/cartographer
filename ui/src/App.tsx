import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exportImage, loadMap, renderMapSvg, type Map } from "./ipc";

export function App() {
  const [map, setMap] = useState<Map | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (map === null) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    renderMapSvg(map)
      .then((s) => !cancelled && setSvg(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [map]);

  async function handleOpen() {
    setError(null);
    const picked = await open({
      filters: [{ name: "Cartographer map", extensions: ["yaml", "yml"] }],
      multiple: false,
    });
    if (!picked || typeof picked !== "string") return;
    try {
      const m = await loadMap(picked);
      setMap(m);
      setPath(picked);
    } catch (e) {
      setError(String(e));
      setMap(null);
    }
  }

  async function handleExport() {
    if (!map) return;
    setError(null);
    const picked = await save({
      filters: [
        { name: "PNG", extensions: ["png"] },
        { name: "JPG", extensions: ["jpg", "jpeg"] },
        { name: "SVG", extensions: ["svg"] },
      ],
    });
    if (!picked) return;
    try {
      await exportImage(map, picked);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={handleOpen}>Open YAML…</button>
        <button onClick={handleExport} disabled={!map}>
          Export image…
        </button>
        <div className="spacer" />
        {path && <span className="path">{path}</span>}
      </div>
      <div className="canvas">
        {error && <pre className="error">{error}</pre>}
        {!error && svg && <div dangerouslySetInnerHTML={{ __html: svg }} />}
        {!error && !svg && (
          <div className="empty">
            <h2>Cartographer</h2>
            <p>
              Open a <code>.yaml</code> map file to render it. Try{" "}
              <code>examples/small-tomb.yaml</code> from the repository.
            </p>
            <p style={{ marginTop: "1rem" }}>
              Phase 2 is read-only preview. Carving rooms in the UI lands in
              Phase 3.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
