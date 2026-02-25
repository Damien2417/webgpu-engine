import { create } from 'zustand';
import type { EntityId } from '../engine/types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

type Snapshot = { engineJson: string; editorMeta: Record<number, unknown> };

interface EditorState {
  selectedIds:    EntityId[];
  gizmoMode:      GizmoMode;
  isPlaying:      boolean;
  sceneSnapshot:  string | null;

  /** Sélection unique — efface les autres */
  select:         (id: EntityId | null) => void;
  /** Ctrl+Clic — ajoute ou retire */
  toggleSelect:   (id: EntityId) => void;
  /** Ctrl+A — tout sélectionner */
  selectAll:      (allIds: EntityId[]) => void;
  /** Escape / clic fond vide */
  clearSelection: () => void;

  setGizmoMode: (mode: GizmoMode) => void;
  setPlaying:   (v: boolean) => void;
  setSnapshot:  (json: string | null) => void;

  isPaused:    boolean;
  setPaused:   (v: boolean) => void;

  aiPanelOpen: boolean;
  setAiPanel:  (v: boolean) => void;

  undoStack:  Snapshot[];
  redoStack:  Snapshot[];
  pushUndo:   (snap: Snapshot) => void;
  /** Pop the undo stack. Pass `currentSnap` to push it onto the redo stack. */
  undo:       (currentSnap: Snapshot) => Snapshot | null;
  /** Pop the redo stack. Pass `currentSnap` to push it onto the undo stack. */
  redo:       (currentSnap: Snapshot) => Snapshot | null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedIds:   [],
  gizmoMode:     'translate',
  isPlaying:     false,
  sceneSnapshot: null,

  select:         (id)     => set({ selectedIds: id !== null ? [id] : [] }),
  toggleSelect:   (id)     => set(s => ({
    selectedIds: s.selectedIds.includes(id)
      ? s.selectedIds.filter(x => x !== id)
      : [...s.selectedIds, id],
  })),
  selectAll:      (allIds) => set({ selectedIds: allIds }),
  clearSelection: ()       => set({ selectedIds: [] }),

  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setPlaying:   (v)    => set({ isPlaying: v }),
  setSnapshot:  (json) => set({ sceneSnapshot: json }),

  isPaused:    false,
  setPaused:   (v) => set({ isPaused: v }),

  aiPanelOpen: false,
  setAiPanel:  (v) => set({ aiPanelOpen: v }),

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
