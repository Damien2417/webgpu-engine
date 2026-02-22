import { create } from 'zustand';
import { bridge } from '../engine/engineBridge';
import type { EntityId, EntityData } from '../engine/types';

interface SceneState {
  entities: EntityData[];

  refresh:        () => void;
  addEntity:      (name?: string) => EntityId;
  removeEntity:   (id: EntityId) => void;
  updatePosition: (id: EntityId, x: number, y: number, z: number) => void;
  updateRotation: (id: EntityId, x: number, y: number, z: number) => void;
  updateScale:    (id: EntityId, x: number, y: number, z: number) => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  entities: [],

  refresh: () => {
    const ids = bridge.getEntityIds();
    const entities: EntityData[] = ids.map(id => ({
      id,
      name:      bridge.getEntityName(id),
      transform: bridge.getTransform(id),
      hasMesh:   true,
    }));
    set({ entities });
  },

  addEntity: (name) => {
    const count = bridge.getEntityIds().length;
    const id = bridge.createEntity(name ?? `Entity ${count}`);
    bridge.addMeshRenderer(id);
    get().refresh();
    return id;
  },

  removeEntity: (id) => {
    bridge.removeEntity(id);
    get().refresh();
  },

  updatePosition: (id, x, y, z) => {
    bridge.setPosition(id, x, y, z);
    get().refresh();
  },

  updateRotation: (id, x, y, z) => {
    bridge.setRotation(id, x, y, z);
    get().refresh();
  },

  updateScale: (id, x, y, z) => {
    bridge.setScale(id, x, y, z);
    get().refresh();
  },
}));
