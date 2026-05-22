import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Editor, type Selection, type Tool } from "./Editor";
import { Inspector } from "./Inspector";
import { useMapHistory } from "./history";
import { exportImage, loadMap, newMap, saveMap } from "./ipc";
import {
  OBJECT_TOOLS,
  SNAP_OPTIONS,
  type Map,
  type SnapMode,
  type View,
} from "./state";

export function App() {
  const { map, canUndo, canRedo, setMap, resetMap, replaceMap, commitMap, undo, redo } =
    useMapHistory();
  const [path, setPath] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [snap, setSnap] = useState<SnapMode>(1);
  const [view, setView] = useState<View>("gm");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept while typing in an input/textarea/contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      if (meta) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case "r": setTool("rect"); break;
        case "w": setTool("wall"); break;
        case "v": setTool("select"); break;
        case "d": setTool("door"); break;
        case "s": setTool("secret-door"); break;
        case "l": setTool("locked-door"); break;
        case "p": setTool("pit-trap"); break;
        case "u": setTool("stairs-up"); break;
        case "j": setTool("stairs-down"); break;
        case "a": setTool("altar"); break;
        case "f": setTool("fountain"); break;
        case "c": setTool("column"); break;
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
      await exportImage(map, picked, { showGm: view === "gm" });
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
        <ToolButton current={tool} value="rect" onClick={setTool} hint="R">
          Rectangle
        </ToolButton>
        <ToolButton current={tool} value="wall" onClick={setTool} hint="W">
          Wall
        </ToolButton>
        <ToolButton current={tool} value="select" onClick={setTool} hint="V">
          Select
        </ToolButton>
        <div className="divider" />
        {OBJECT_TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            current={tool}
            value={t.id}
            onClick={setTool}
            hint={objectHint(t.id)}
          >
            {t.label}
          </ToolButton>
        ))}
        <div className="divider" />
        <div className="view-toggle" title="GM sees everything; Player hides gm-only layers">
          <button
            className={view === "gm" ? "active" : ""}
            onClick={() => setView("gm")}
          >
            GM
          </button>
          <button
            className={view === "player" ? "active" : ""}
            onClick={() => setView("player")}
          >
            Player
          </button>
        </div>
        <div className="divider" />
        <label className="snap-picker" title="Snap precision (1/12 cell minimum)">
          Snap
          <select
            value={snap}
            onChange={(e) => setSnap(Number(e.target.value) as SnapMode)}
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="divider" />
        {map && (
          <select
            className="style-picker"
            value={map.background.style}
            onChange={(e) =>
              setMap({
                ...map,
                background: { style: e.target.value as Map["background"]["style"] },
              })
            }
            title="Background style"
          >
            <option value="ink">Ink (OSR)</option>
            <option value="parchment">Parchment</option>
            <option value="clean">Clean</option>
            <option value="blueprint">Blueprint</option>
          </select>
        )}
        <div className="spacer" />
        {path && <span className="path">{path}</span>}
      </div>
      {error && <pre className="error">{error}</pre>}
      {map ? (
        <div className="main">
          <Editor
            map={map}
            setMap={setMap}
            replaceMap={replaceMap}
            commitMap={commitMap}
            tool={tool}
            snap={snap}
            view={view}
            selection={selection}
            setSelection={setSelection}
          />
          <Inspector
            map={map}
            setMap={setMap}
            selection={selection}
            setSelection={setSelection}
          />
        </div>
      ) : (
        <div className="empty">
          <h2>Cartographer</h2>
          <p>
            Click <strong>New</strong> to start a fresh map, or{" "}
            <strong>Open…</strong> to load a YAML file. Drag with the{" "}
            <strong>Rectangle</strong> tool to carve rooms; click two points
            with the <strong>Wall</strong> tool to draw a wall; click with an
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
  hint,
}: {
  current: Tool;
  value: Tool;
  onClick: (t: Tool) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      className={current === value ? "tool active" : "tool"}
      onClick={() => onClick(value)}
      title={hint ? `${value} (${hint})` : value}
    >
      {children}
      {hint && <span className="hint-key">{hint}</span>}
    </button>
  );
}

function objectHint(id: string): string | undefined {
  switch (id) {
    case "door": return "D";
    case "secret-door": return "S";
    case "locked-door": return "L";
    case "pit-trap": return "P";
    case "stairs-up": return "U";
    case "stairs-down": return "J";
    case "altar": return "A";
    case "fountain": return "F";
    case "column": return "C";
    default: return undefined;
  }
}
