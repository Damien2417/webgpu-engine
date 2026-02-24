import { create } from 'zustand';
import { bridge } from '../engine/engineBridge';
import type { EntityId, EntityData } from '../engine/types';
import { useComponentStore } from './componentStore';

interface SceneState {
  entities: EntityData[];

  refresh:         () => void;
  addEntity:       (name?: string) => EntityId;
  removeEntity:    (id: EntityId) => void;
  duplicateEntity: (id: EntityId) => EntityId | null;
  updatePosition:  (id: EntityId, x: number, y: number, z: number) => void;
  updateRotation:  (id: EntityId, x: number, y: number, z: number) => void;
  updateScale:     (id: EntityId, x: number, y: number, z: number) => void;
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
    useComponentStore.getState().removeEntity(id);
    get().refresh();
  },

  duplicateEntity: (id) => {
    const src = get().entities.find(e => e.id === id);
    if (!src) return null;
    const newId = bridge.createEntity(src.name + ' (copy)');
    bridge.addMeshRenderer(newId);
    const t = src.transform;
    bridge.setPosition(newId, t.position[0] + 0.5, t.position[1], t.position[2]);
    bridge.setRotation(newId, t.rotation[0], t.rotation[1], t.rotation[2]);
    bridge.setScale(newId, t.scale[0], t.scale[1], t.scale[2]);
    const mt = bridge.getMeshType(id);
    bridge.setMeshType(newId, mt);
    get().refresh();
    return newId;
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
