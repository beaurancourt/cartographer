import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Editor, type Selection, type Tool } from "./Editor";
import { Inspector } from "./Inspector";
import { LayerPanel } from "./LayerPanel";
import { useMapHistory } from "./history";
import { exportImage, loadMap, newMap, saveMap } from "./ipc";
import {
  DOOR_TOOLS,
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
  const [fitToken, setFitToken] = useState(0);
  const fit = useCallback(() => setFitToken((t) => t + 1), []);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
        case "t": setTool("path"); break;
        case "n": setTool("note"); break;
        case "v": setTool("select"); break;
        case "d": setTool("door"); break;
        case "s": setTool("secret-door"); break;
        case "l": setTool("locked-door"); break;
        case "i": setTool("stairs"); break;
        case "p": setTool("pit-trap"); break;
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
      await exportImage(map, picked, { view });
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app">
      {/* Slim top bar: file ops, edit, view, style, snap. */}
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
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷</button>
        <button onClick={fit} disabled={!map} title="Fit map to viewport">Fit</button>
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
        <label className="snap-picker" title="Snap precision (1/12 cell min)">
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
        {map && (
          <select
            className="style-picker"
            value={map.background.style}
            onChange={(e) =>
              setMap({
                ...map,
                background: {
                  style: e.target.value as Map["background"]["style"],
                },
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
          {/* Left palette: tools */}
          <div className="palette">
            <ToolButton current={tool} value="rect" onClick={setTool} hint="R" label="Rectangle">▭</ToolButton>
            <ToolButton current={tool} value="wall" onClick={setTool} hint="W" label="Wall">━</ToolButton>
            <ToolButton current={tool} value="path" onClick={setTool} hint="T" label="Path">⌐</ToolButton>
            <ToolButton current={tool} value="note" onClick={setTool} hint="N" label="Note">¶</ToolButton>
            <div className="palette-divider" />
            {DOOR_TOOLS.map((t) => (
              <ToolButton
                key={t.id}
                current={tool}
                value={t.id}
                onClick={setTool}
                hint={t.id === "door" ? "D" : t.id === "secret-door" ? "S" : "L"}
                label={t.label}
              >
                {t.id === "door" ? "▮" : t.id === "secret-door" ? "S" : "🔒"}
              </ToolButton>
            ))}
            <ToolButton current={tool} value="stairs" onClick={setTool} hint="I" label="Stairs">⛒</ToolButton>
            <ToolButton current={tool} value="select" onClick={setTool} hint="V" label="Select">⬚</ToolButton>
            <div className="palette-divider" />
            {OBJECT_TOOLS.map((t) => (
              <ToolButton
                key={t.id}
                current={tool}
                value={t.id}
                onClick={setTool}
                hint={objectHint(t.id)}
                label={t.label}
              >
                {objectGlyph(t.id)}
              </ToolButton>
            ))}
          </div>
          <div className="canvas-stack">
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
              fitToken={fitToken}
              hiddenLayers={hiddenLayers}
              onCursorChange={setCursor}
            />
            <div className="status-bar">
              <span className="tool-label">tool: {tool}</span>
              <span className="cursor-coords">
                {cursor ? `(${cursor[0]}, ${cursor[1]})` : "·"}
              </span>
              <span className="snap-label">snap: 1/{snap}</span>
            </div>
          </div>
          <div className="side">
            <Inspector
              map={map}
              setMap={setMap}
              selection={selection}
              setSelection={setSelection}
            />
            <LayerPanel
              map={map}
              hidden={hiddenLayers}
              setHidden={setHiddenLayers}
            />
          </div>
        </div>
      ) : (
        <div className="empty">
          <h2>Cartographer</h2>
          <p>
            Click <strong>New</strong> to start a fresh map, or{" "}
            <strong>Open…</strong> to load a YAML file.
          </p>
          <p>
            Pick a tool from the left palette, then drag/click on the canvas
            to carve rooms, place objects, and draw walls.
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
  label,
}: {
  current: Tool;
  value: Tool;
  onClick: (t: Tool) => void;
  children: React.ReactNode;
  hint?: string;
  label?: string;
}) {
  const tooltip = label
    ? `${label}${hint ? `  (${hint})` : ""}`
    : hint
      ? `${value} (${hint})`
      : value;
  return (
    <button
      className={current === value ? "palette-btn active" : "palette-btn"}
      onClick={() => onClick(value)}
      title={tooltip}
    >
      <span className="palette-glyph">{children}</span>
      {hint && <span className="palette-key">{hint}</span>}
    </button>
  );
}

function objectHint(id: string): string | undefined {
  switch (id) {
    case "pit-trap": return "P";
    case "altar": return "A";
    case "fountain": return "F";
    case "column": return "C";
    default: return undefined;
  }
}

function objectGlyph(id: string): string {
  switch (id) {
    case "pit-trap": return "⊠";
    case "altar": return "▤";
    case "fountain": return "◎";
    case "column": return "●";
    case "fireplace": return "♨";
    case "statue": return "♟";
    case "throne": return "♔";
    case "rubble": return "⁂";
    case "water": return "≋";
    default: return "·";
  }
}
