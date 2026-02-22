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
}));
