import { create } from 'zustand';
import type { EntityId } from '../engine/types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

type Snapshot = { engineJson: string; editorMeta: Record<number, unknown> };

interface EditorState {
  selectedId:    EntityId | null;
  gizmoMode:     GizmoMode;
  isPlaying:     boolean;
  sceneSnapshot: string | null;

  select:       (id: EntityId | null) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setPlaying:   (v: boolean) => void;
  setSnapshot:  (json: string | null) => void;

  isPaused:   boolean;
  setPaused:  (v: boolean) => void;

  undoStack:  Snapshot[];
  redoStack:  Snapshot[];
  pushUndo:   (snap: Snapshot) => void;
  /** Pop the undo stack. Pass `currentSnap` to push it onto the redo stack. */
  undo:       (currentSnap: Snapshot) => Snapshot | null;
  /** Pop the redo stack. Pass `currentSnap` to push it onto the undo stack. */
  redo:       (currentSnap: Snapshot) => Snapshot | null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedId:    null,
  gizmoMode:     'translate',
  isPlaying:     false,
  sceneSnapshot: null,

  select:       (id)   => set({ selectedId: id }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setPlaying:   (v)    => set({ isPlaying: v }),
  setSnapshot:  (json) => set({ sceneSnapshot: json }),

  isPaused:  false,
  setPaused: (v) => set({ isPaused: v }),

  undoStack: [],
  redoStack: [],
  pushUndo: (snap) => set(s => ({
    undoStack: [...s.undoStack.slice(-19), snap],
    redoStack: [],
  })),
  undo: (currentSnap) => {
    const s = get();
    const snap = s.undoStack[s.undoStack.length - 1];
    if (!snap) return null;
    set(prev => ({
      undoStack: prev.undoStack.slice(0, -1),
      redoStack: [...prev.redoStack.slice(-19), currentSnap],
    }));
    return snap;
  },
  redo: (currentSnap) => {
    const s = get();
    const snap = s.redoStack[s.redoStack.length - 1];
    if (!snap) return null;
    set(prev => ({
      redoStack: prev.redoStack.slice(0, -1),
      undoStack: [...prev.undoStack.slice(-19), currentSnap],
    }));
    return snap;
  },
}));
