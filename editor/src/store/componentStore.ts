import { create } from 'zustand';
import type { EntityId, EntityComponents } from '../engine/types';

interface ComponentStoreState {
  components: Record<EntityId, EntityComponents>;

  getComponents:   (id: EntityId) => EntityComponents;
  setComponent:    <K extends keyof EntityComponents>(id: EntityId, key: K, value: EntityComponents[K]) => void;
  removeComponent: <K extends keyof EntityComponents>(id: EntityId, key: K) => void;
  removeEntity:    (id: EntityId) => void;
  clearAll:        () => void;
  serialize:       () => Record<EntityId, EntityComponents>;
  deserialize:     (data: Record<EntityId, EntityComponents>) => void;
}

export const useComponentStore = create<ComponentStoreState>((set, get) => ({
  components: {},

  getComponents: (id) => get().components[id] ?? {},

  setComponent: (id, key, value) =>
    set(s => ({
      components: {
        ...s.components,
        [id]: { ...s.components[id], [key]: value },
      },
    })),

  removeComponent: (id, key) =>
    set(s => {
      const next = { ...s.components[id] };
      delete next[key];
      return { components: { ...s.components, [id]: next } };
    }),

  removeEntity: (id) =>
    set(s => {
      const next = { ...s.components };
      delete next[id];
      return { components: next };
    }),

  clearAll: () => set({ components: {} }),

  serialize: () => get().components,

  deserialize: (data) => set({ components: data }),
}));
