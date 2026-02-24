import { create } from 'zustand';
import type { EntityId } from '../engine/types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

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

  undoStack:  { engineJson: string; editorMeta: Record<number, unknown> }[];
  redoStack:  { engineJson: string; editorMeta: Record<number, unknown> }[];
  pushUndo:   (snap: { engineJson: string; editorMeta: Record<number, unknown> }) => void;
  undo:       () => { engineJson: string; editorMeta: Record<number, unknown> } | null;
  redo:       () => { engineJson: string; editorMeta: Record<number, unknown> } | null;
}

export const useEditorStore = create<EditorState>((set) => ({
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
  undo: () => {
    const s = useEditorStore.getState();
    const snap = s.undoStack[s.undoStack.length - 1];
    if (!snap) return null;
    useEditorStore.setState(prev => ({ undoStack: prev.undoStack.slice(0, -1) }));
    return snap;
  },
  redo: () => {
    const s = useEditorStore.getState();
    const snap = s.redoStack[s.redoStack.length - 1];
    if (!snap) return null;
    useEditorStore.setState(prev => ({ redoStack: prev.redoStack.slice(0, -1) }));
    return snap;
  },
}));
