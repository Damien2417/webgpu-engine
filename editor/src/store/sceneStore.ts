import { create } from 'zustand';
import { bridge } from '../engine/engineBridge';
import type { EntityId, EntityData, EntityComponents } from '../engine/types';
import { useComponentStore } from './componentStore';
import { useEditorStore } from './editorStore';

interface SceneState {
  entities: EntityData[];

  refresh:          () => void;
  /** Crée une entité "physique" prête au gameplay (mesh + rigidbody + collider). */
  addPhysicalEntity:(name?: string) => EntityId;
  /** Crée un GameObject non-physique (transform seul, sans mesh/collider/rigidbody). */
  addGameObject:    (name?: string) => EntityId;
  /** Alias historique: redirigé vers addPhysicalEntity. */
  addEntity:        (name?: string) => EntityId;
  removeEntity:     (id: EntityId) => void;
  duplicateEntity:  (id: EntityId) => EntityId | null;
  updatePosition:   (id: EntityId, x: number, y: number, z: number) => void;
  updateRotation:   (id: EntityId, x: number, y: number, z: number) => void;
  updateScale:      (id: EntityId, x: number, y: number, z: number) => void;
  /** Crée une entité caméra (sans mesh, avec composant Camera par défaut). */
  addCamera:        () => EntityId;
  /** Groupe les entités sélectionnées. Retourne l'ID du groupe ou null. */
  groupSelected:    () => EntityId | null;
  /** Dégroupe l'entité sélectionnée (libère ses enfants). */
  ungroupSelected:  () => void;
  /** Relie l'entité directionalLight au moteur après un load/undo/redo. */
  syncDirectionalLightEntity: () => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  entities: [],

  refresh: () => {
    const ids = bridge.getEntityIds();
    const entities: EntityData[] = ids.map(id => ({
      id,
      name:      bridge.getEntityName(id),
      transform: bridge.getTransform(id),
      hasMesh:   bridge.hasMeshRenderer(id),
      parentId:  bridge.getParent(id) ?? undefined,
      children:  bridge.getChildren(id),
    }));
    set({ entities });
  },

  addPhysicalEntity: (name) => {
    const count = bridge.getEntityIds().length;
    const id = bridge.createEntity(name ?? `Entity ${count}`);
    bridge.addMeshRenderer(id);
    bridge.addRigidBody(id, true);
    bridge.addCollider(id, 0.5, 0.5, 0.5);
    const comps = useComponentStore.getState();
    comps.setComponent(id, 'meshType', 'cube');
    comps.setComponent(id, 'rigidbody', { isStatic: true });
    comps.setComponent(id, 'collider', { hx: 0.5, hy: 0.5, hz: 0.5 });
    get().refresh();
    return id;
  },

  addGameObject: (name) => {
    const count = bridge.getEntityIds().length;
    const id = bridge.createEntity(name ?? `GameObject ${count}`);
    get().refresh();
    return id;
  },

  addEntity: (name) => get().addPhysicalEntity(name),

  addCamera: () => {
    const count = bridge.getEntityIds().filter(id => bridge.getEntityName(id).startsWith('Camera')).length;
    const name = count === 0 ? 'Camera' : `Camera ${count}`;
    const id = bridge.createEntity(name);
    // No mesh renderer — camera entities are invisible in the scene
    const defaultCam = { fov: 60, near: 0.1, far: 1000, isActive: false, followEntity: false };
    useComponentStore.getState().setComponent(id, 'camera', defaultCam);
    bridge.addCamera(id, defaultCam.fov, defaultCam.near, defaultCam.far);
    bridge.setCameraFollowEntity(id, defaultCam.followEntity);
    get().refresh();
    return id;
  },

  removeEntity: (id) => {
    // Collecter tous les descendants AVANT la suppression (le moteur les supprime aussi).
    const collectDescendants = (rootId: EntityId): EntityId[] => {
      const result: EntityId[] = [rootId];
      const queue = [rootId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = bridge.getChildren(current);
        for (const child of children) {
          result.push(child);
          queue.push(child);
        }
      }
      return result;
    };
    const allIds = collectDescendants(id);
    const compStore = useComponentStore.getState();

    // Nettoyage des singletons globaux AVANT la suppression moteur.
    // remove_entity Rust nettoie point_lights via SparseSet, mais pas directional_light
    // (singleton global découplé de l'ECS). On le gère ici côté TS.
    for (const eid of allIds) {
      if (compStore.getComponents(eid).directionalLight !== undefined) {
        bridge.removeDirectionalLight();
        break; // une seule lumière directionnelle globale
      }
    }

    // Suppression moteur (récursive côté Rust).
    bridge.removeEntity(id);

    // Nettoyage componentStore pour chaque entité supprimée.
    for (const eid of allIds) {
      compStore.removeEntity(eid);
    }

    get().refresh();
  },

  duplicateEntity: (id) => {
    // Snapshot de l'état courant — stable pendant tout le clonage.
    const snapshot = get().entities;
    const compStore = useComponentStore.getState();

    // Tout le sous-arbre est décalé du même offset monde pour préserver
    // les positions relatives entre parent et enfants.
    const OFFSET: [number, number, number] = [0.5, 0, 0];

    /**
     * Clone récursif d'une entité et de tout son sous-arbre.
     * On utilise les positions MONDE + setParent (qui fait world→local) pour
     * que les relations locales soient identiques à la source.
     */
    const cloneSubtree = (srcId: EntityId, newParentId: EntityId | null, nameSuffix: string): EntityId | null => {
      const src = snapshot.find(e => e.id === srcId);
      if (!src) return null;

      // ── Créer l'entité ───────────────────────────────────────────────────
      const newId = bridge.createEntity(src.name + nameSuffix);

      // ── Transform monde + offset ─────────────────────────────────────────
      // Toutes les entités du sous-arbre reçoivent le même décalage monde.
      // setParent recalculera ensuite le local correct pour chaque enfant.
      const w = bridge.getWorldTransform(srcId);
      bridge.setPosition(newId, w.position[0] + OFFSET[0], w.position[1] + OFFSET[1], w.position[2] + OFFSET[2]);
      bridge.setRotation(newId, w.rotation[0], w.rotation[1], w.rotation[2]);
      bridge.setScale(newId, w.scale[0], w.scale[1], w.scale[2]);

      // ── MeshRenderer ─────────────────────────────────────────────────────
      if (src.hasMesh) {
        bridge.addMeshRenderer(newId);
        bridge.setMeshType(newId, bridge.getMeshType(srcId));
      }

      // ── Composants engine (depuis componentStore) ─────────────────────────
      const comps = compStore.getComponents(srcId);
      if (comps.material) {
        bridge.addPbrMaterial(newId, comps.material.texId, comps.material.metallic, comps.material.roughness);
        bridge.setEmissive(newId, comps.material.emissive[0], comps.material.emissive[1], comps.material.emissive[2]);
      }
      if (comps.rigidbody) bridge.addRigidBody(newId, comps.rigidbody.isStatic);
      if (comps.collider)  bridge.addCollider(newId, comps.collider.hx, comps.collider.hy, comps.collider.hz);
      if (comps.pointLight) bridge.addPointLight(newId, comps.pointLight.r, comps.pointLight.g, comps.pointLight.b, comps.pointLight.intensity);
      const tag = bridge.getTag(srcId);
      if (tag) bridge.setTag(newId, tag);

      // ── Métadonnées componentStore (pour l'Inspector) ────────────────────
      const metaToCopy: Partial<EntityComponents> = {};
      if (comps.meshType   !== undefined) metaToCopy.meshType   = comps.meshType;
      if (comps.material)   metaToCopy.material   = { ...comps.material };
      if (comps.rigidbody)  metaToCopy.rigidbody  = { ...comps.rigidbody };
      if (comps.collider)   metaToCopy.collider   = { ...comps.collider };
      if (comps.pointLight) metaToCopy.pointLight = { ...comps.pointLight };
      if (comps.script)     metaToCopy.script     = comps.script;
      if (comps.particle)   metaToCopy.particle   = { ...comps.particle };
      // isPlayer et camera sont des singletons/complexes : non copiés.
      for (const [k, v] of Object.entries(metaToCopy)) {
        compStore.setComponent(newId, k as keyof EntityComponents, v as EntityComponents[keyof EntityComponents]);
      }

      // ── Parent (setParent convertit le world→local correctement) ─────────
      if (newParentId !== null) {
        bridge.setParent(newId, newParentId);
      }

      // ── Récurse sur les enfants ───────────────────────────────────────────
      for (const childId of src.children) {
        cloneSubtree(childId, newId, '');
      }

      return newId;
    };

    // Placer le clone au même niveau que la source (même parent).
    const sourceParentId = bridge.getParent(id);
    const newId = cloneSubtree(id, sourceParentId, ' (copy)');
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

    // Détecter si toutes les entités partagent le même parent commun
    const firstParent = bridge.getParent(selectedIds[0]);
    const commonParentId = selectedIds.every(id => bridge.getParent(id) === firstParent)
      ? firstParent   // null = toutes racines, EntityId = parent commun
      : null;         // parents mixtes → groupe racine

    // Centroïde des world positions
    const positions = selectedIds.map(id => bridge.getWorldTransform(id).position);
    const cx = positions.reduce((s, p) => s + p[0], 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p[1], 0) / positions.length;
    const cz = positions.reduce((s, p) => s + p[2], 0) / positions.length;

    // Créer l'entité groupe (sans MeshRenderer)
    const groupId = bridge.createEntity('Group');
    bridge.setPosition(groupId, cx, cy, cz);

    // Si toutes les entités avaient un parent commun, hériter de ce parent
    // (doit être fait AVANT de reparenter les enfants pour que compute_world_matrix
    //  soit correct au moment du reparentage)
    if (commonParentId !== null) {
      bridge.setParent(groupId, commonParentId);
    }

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

    // Si le groupe lui-même a un parent, les enfants doivent hériter de ce
    // grand-parent après le dégroupage — pas devenir des racines orphelines.
    const groupParentId = bridge.getParent(selectedId);

    const childIds = [...entity.children];
    for (const childId of childIds) {
      if (groupParentId !== null) {
        // Reparenter l'enfant au grand-parent (world→local géré par setParent)
        bridge.setParent(childId, groupParentId);
      } else {
        // Pas de grand-parent → promouvoir à la racine
        bridge.removeParent(childId);
      }
    }

    // Supprimer le groupe s'il n'a pas de MeshRenderer
    if (!entity.hasMesh) {
      bridge.removeEntity(selectedId);
      useComponentStore.getState().removeEntity(selectedId);
    }

    get().refresh();
    useEditorStore.getState().clearSelection();
  },

  syncDirectionalLightEntity: () => {
    const comps = useComponentStore.getState().components;
    for (const [idStr, ec] of Object.entries(comps)) {
      if (ec.directionalLight !== undefined) {
        const id = Number(idStr);
        const l  = ec.directionalLight;
        bridge.addDirectionalLightEntity(id, l.r, l.g, l.b, l.intensity, l.coneAngle ?? 30);
        return;
      }
    }
  },
}));
