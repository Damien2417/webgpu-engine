import { create } from 'zustand';
import { bridge } from '../engine/engineBridge';
import type { EntityId, EntityData } from '../engine/types';
import { useComponentStore } from './componentStore';
import { useEditorStore } from './editorStore';

interface SceneState {
  entities: EntityData[];

  refresh:          () => void;
  addEntity:        (name?: string) => EntityId;
  removeEntity:     (id: EntityId) => void;
  duplicateEntity:  (id: EntityId) => EntityId | null;
  updatePosition:   (id: EntityId, x: number, y: number, z: number) => void;
  updateRotation:   (id: EntityId, x: number, y: number, z: number) => void;
  updateScale:      (id: EntityId, x: number, y: number, z: number) => void;
  /** Groupe les entités sélectionnées. Retourne l'ID du groupe ou null. */
  groupSelected:    () => EntityId | null;
  /** Dégroupe l'entité sélectionnée (libère ses enfants). */
  ungroupSelected:  () => void;
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
      parentId:  bridge.getParent(id) ?? undefined,
      children:  bridge.getChildren(id),
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

  groupSelected: () => {
    const selectedIds = useEditorStore.getState().selectedIds;
    if (selectedIds.length < 2) return null;

    // Centroïde des world positions
    const positions = selectedIds.map(id => bridge.getWorldTransform(id).position);
    const cx = positions.reduce((s, p) => s + p[0], 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p[1], 0) / positions.length;
    const cz = positions.reduce((s, p) => s + p[2], 0) / positions.length;

    // Créer l'entité groupe (sans MeshRenderer)
    const groupId = bridge.createEntity('Group');
    bridge.setPosition(groupId, cx, cy, cz);

    // Reparenter chaque entité sélectionnée
    for (const id of selectedIds) {
      bridge.setParent(id, groupId);
    }

    get().refresh();
    useEditorStore.getState().select(groupId);
    return groupId;
  },

  ungroupSelected: () => {
    const selectedId = useEditorStore.getState().selectedIds.at(-1);
    if (selectedId === undefined) return;

    const entity = get().entities.find(e => e.id === selectedId);
    if (!entity) return;

    // Détacher tous les enfants
    const childIds = [...entity.children];
    for (const childId of childIds) {
      bridge.removeParent(childId);
    }

    // Supprimer le groupe s'il n'a pas de mesh
    if (!entity.hasMesh || useComponentStore.getState().getComponents(selectedId).meshType === undefined) {
      bridge.removeEntity(selectedId);
      useComponentStore.getState().removeEntity(selectedId);
    }

    get().refresh();
    useEditorStore.getState().clearSelection();
  },
}));
