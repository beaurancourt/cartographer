import { useCallback, useReducer } from "react";
import type { Map } from "./state";

/// Bounded undo/redo for the map state. Each mutation pushes the prior value
/// onto the past stack and clears the future stack.

const MAX_HISTORY = 200;

type HistoryState = {
  past: Map[];
  current: Map | null;
  future: Map[];
};

type Action =
  | { type: "set"; map: Map }
  | { type: "reset"; map: Map | null }
  | { type: "undo" }
  | { type: "redo" };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case "set": {
      if (state.current === action.map) return state;
      const past = state.current
        ? [...state.past, state.current].slice(-MAX_HISTORY)
        : state.past;
      return { past, current: action.map, future: [] };
    }
    case "reset":
      return { past: [], current: action.map, future: [] };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        current: prev,
        future: state.current ? [state.current, ...state.future] : state.future,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: state.current ? [...state.past, state.current] : state.past,
        current: next,
        future: state.future.slice(1),
      };
    }
  }
}

export function useMapHistory() {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    current: null,
    future: [],
  });
  const setMap = useCallback((m: Map) => dispatch({ type: "set", map: m }), []);
  const resetMap = useCallback(
    (m: Map | null) => dispatch({ type: "reset", map: m }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return {
    map: state.current,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setMap,
    resetMap,
    undo,
    redo,
  };
}
