import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Editor, type Tool } from "./Editor";
import { useMapHistory } from "./history";
import { exportImage, loadMap, newMap, saveMap } from "./ipc";
import { OBJECT_TOOLS } from "./state";

type Selection = { kind: "carve" | "object"; id: string };

export function App() {
  const { map, canUndo, canRedo, setMap, resetMap, undo, redo } = useMapHistory();
  const [path, setPath] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const handleNew = useCallback(async () => {
    setError(null);
    try {
      const m = await newMap();
      resetMap(m);
      setPath(null);
      setSelection(null);
    } catch (e) {
      setError(String(e));
    }
  }, [resetMap]);

  async function handleOpen() {
    setError(null);
    const picked = await open({
      filters: [{ name: "Cartographer map", extensions: ["yaml", "yml"] }],
      multiple: false,
    });
    if (!picked || typeof picked !== "string") return;
    try {
      const m = await loadMap(picked);
      resetMap(m);
      setPath(picked);
      setSelection(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSave() {
    if (!map) return;
    setError(null);
    let target = path;
    if (!target) {
      const picked = await save({
        filters: [{ name: "Cartographer map", extensions: ["yaml"] }],
        defaultPath: "map.yaml",
      });
      if (!picked) return;
      target = picked;
    }
    try {
      await saveMap(map, target);
      setPath(target);
    } catch (e) {
      setError(String(e));
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
      defaultPath: "map.png",
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
        <button onClick={handleNew}>New</button>
        <button onClick={handleOpen}>Open…</button>
        <button onClick={handleSave} disabled={!map}>
          Save{!path ? "…" : ""}
        </button>
        <button onClick={handleExport} disabled={!map}>
          Export…
        </button>
        <div className="divider" />
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          ↷
        </button>
        <div className="divider" />
        <ToolButton current={tool} value="rect" onClick={setTool}>
          Rectangle
        </ToolButton>
        <ToolButton current={tool} value="select" onClick={setTool}>
          Select
        </ToolButton>
        <div className="divider" />
        {OBJECT_TOOLS.map((t) => (
          <ToolButton key={t.id} current={tool} value={t.id} onClick={setTool}>
            {t.label}
          </ToolButton>
        ))}
        <div className="spacer" />
        {path && <span className="path">{path}</span>}
      </div>
      {error && <pre className="error">{error}</pre>}
      {map ? (
        <Editor
          map={map}
          setMap={setMap}
          tool={tool}
          selection={selection}
          setSelection={setSelection}
        />
      ) : (
        <div className="empty">
          <h2>Cartographer</h2>
          <p>
            Click <strong>New</strong> to start a fresh map, or{" "}
            <strong>Open…</strong> to load a YAML file. Drag with the{" "}
            <strong>Rectangle</strong> tool to carve rooms; click with an
            object tool to place doors, traps, stairs, etc.
          </p>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tool;
  value: Tool;
  onClick: (t: Tool) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={current === value ? "tool active" : "tool"}
      onClick={() => onClick(value)}
    >
      {children}
    </button>
  );
}
