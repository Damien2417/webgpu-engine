// ── Tool executor: validates args with zod, runs handlers, returns results ────

import { z } from 'zod';
import type { ToolCall, ToolResult } from './types';
import { bridge } from '../engine/engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useEditorStore } from '../store/editorStore';
import { useComponentStore } from '../store/componentStore';

// ── Zod schemas per tool ─────────────────────────────────────────────────────

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const schemas: Record<string, z.ZodTypeAny> = {
  get_scene_summary: z.object({}),
  get_selection:     z.object({}),
  find_entities: z.object({
    query: z.string(),
    by:    z.enum(['name', 'tag', 'component']),
  }),
  create_entity: z.object({
    name:     z.string(),
    position: vec3.optional(),
    scale:    vec3.optional(),
    withMesh: z.boolean().optional().default(true),
  }),
  delete_entity: z.object({
    entityId: z.number().int().nonnegative(),
  }),
  set_transform: z.object({
    entityId: z.number().int().nonnegative(),
    position: vec3.optional(),
    rotation: vec3.optional(),
    scale:    vec3.optional(),
  }),
  duplicate_entity: z.object({
    entityId: z.number().int().nonnegative(),
    count:    z.number().int().positive().optional().default(1),
  }),
  add_component: z.object({
    entityId:      z.number().int().nonnegative(),
    componentType: z.enum(['meshRenderer', 'rigidbody', 'collider', 'pointLight', 'material']),
    initialValues: z.record(z.string(), z.unknown()).optional(),
  }),
  update_component: z.object({
    entityId:      z.number().int().nonnegative(),
    componentType: z.enum(['transform', 'meshRenderer', 'rigidbody', 'collider', 'pointLight', 'material']),
    patch:         z.record(z.string(), z.unknown()),
  }),
  set_parent: z.object({
    childId:  z.number().int().nonnegative(),
    parentId: z.number().int().nonnegative(),
  }),
  remove_parent: z.object({
    childId: z.number().int().nonnegative(),
  }),
};

// ── Tool handlers ─────────────────────────────────────────────────────────────

type Handler = (args: Record<string, unknown>) => unknown;

const handlers: Record<string, Handler> = {

  get_scene_summary: () => {
    const ids = bridge.getEntityIds();
    return ids.map(id => {
      const t = bridge.getTransform(id);
      return {
        id,
        name:     bridge.getEntityName(id),
        tag:      bridge.getTag(id),
        position: t.position,
        components: Object.keys(useComponentStore.getState().getComponents(id)),
      };
    });
  },

  get_selection: () => {
    const selectedId = useEditorStore.getState().selectedIds.at(-1) ?? null;
    if (selectedId === null) return { selection: null };
    const t = bridge.getTransform(selectedId);
    return {
      id:         selectedId,
      name:       bridge.getEntityName(selectedId),
      tag:        bridge.getTag(selectedId),
      transform:  t,
      components: useComponentStore.getState().getComponents(selectedId),
    };
  },

  find_entities: (args) => {
    const { query, by } = args as { query: string; by: 'name' | 'tag' | 'component' };
    const ids = bridge.getEntityIds();
    const q = query.toLowerCase();

    return ids.filter(id => {
      if (by === 'name') return bridge.getEntityName(id).toLowerCase().includes(q);
      if (by === 'tag')  return bridge.getTag(id).toLowerCase().includes(q);
      if (by === 'component') {
        const comps = useComponentStore.getState().getComponents(id);
        return Object.keys(comps).some(k => k.toLowerCase().includes(q));
      }
      return false;
    }).map(id => ({
      id,
      name: bridge.getEntityName(id),
      tag:  bridge.getTag(id),
    }));
  },

  create_entity: (args) => {
    const { name, position, scale, withMesh = true } = args as {
      name: string;
      position?: [number, number, number];
      scale?: [number, number, number];
      withMesh?: boolean;
    };
    const id = bridge.createEntity(name);
    if (withMesh) bridge.addMeshRenderer(id);
    if (position) bridge.setPosition(id, position[0], position[1], position[2]);
    if (scale)    bridge.setScale(id, scale[0], scale[1], scale[2]);
    useSceneStore.getState().refresh();
    return { entityId: id, name, withMesh };
  },

  delete_entity: (args) => {
    const { entityId } = args as { entityId: number };
    const ids = bridge.getEntityIds();
    if (!ids.includes(entityId)) throw new Error(`Entity ${entityId} not found`);
    useSceneStore.getState().removeEntity(entityId);
    return { deleted: entityId };
  },

  set_transform: (args) => {
    const { entityId, position, rotation, scale } = args as {
      entityId: number;
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?:    [number, number, number];
    };
    const ids = bridge.getEntityIds();
    if (!ids.includes(entityId)) throw new Error(`Entity ${entityId} not found`);
    if (position) bridge.setPosition(entityId, position[0], position[1], position[2]);
    if (rotation) bridge.setRotation(entityId, rotation[0], rotation[1], rotation[2]);
    if (scale)    bridge.setScale(entityId, scale[0], scale[1], scale[2]);
    useSceneStore.getState().refresh();
    return { entityId, applied: { position, rotation, scale } };
  },

  duplicate_entity: (args) => {
    const { entityId, count = 1 } = args as { entityId: number; count?: number };
    const ids: number[] = [];
    for (let i = 0; i < (count ?? 1); i++) {
      const newId = useSceneStore.getState().duplicateEntity(entityId);
      if (newId !== null) ids.push(newId);
    }
    return { created: ids };
  },

  add_component: (args) => {
    const { entityId, componentType, initialValues } = args as {
      entityId: number;
      componentType: string;
      initialValues?: Record<string, unknown>;
    };
    const ids = bridge.getEntityIds();
    if (!ids.includes(entityId)) throw new Error(`Entity ${entityId} not found`);

    switch (componentType) {
      case 'meshRenderer':
        bridge.addMeshRenderer(entityId);
        break;
      case 'rigidbody': {
        const isStatic = (initialValues?.isStatic as boolean) ?? false;
        bridge.addRigidBody(entityId, isStatic);
        useComponentStore.getState().setComponent(entityId, 'rigidbody', { isStatic });
        break;
      }
      case 'collider': {
        const hx = (initialValues?.hx as number) ?? 0.5;
        const hy = (initialValues?.hy as number) ?? 0.5;
        const hz = (initialValues?.hz as number) ?? 0.5;
        bridge.addCollider(entityId, hx, hy, hz);
        useComponentStore.getState().setComponent(entityId, 'collider', { hx, hy, hz });
        break;
      }
      case 'pointLight': {
        const r = (initialValues?.r as number) ?? 1;
        const g = (initialValues?.g as number) ?? 1;
        const b = (initialValues?.b as number) ?? 1;
        const intensity = (initialValues?.intensity as number) ?? 1;
        bridge.addPointLight(entityId, r, g, b, intensity);
        useComponentStore.getState().setComponent(entityId, 'pointLight', { r, g, b, intensity });
        break;
      }
    }
    return { entityId, componentType };
  },

  set_parent: (args) => {
    const { childId, parentId } = args as { childId: number; parentId: number };
    const ids = bridge.getEntityIds();
    if (!ids.includes(childId))  throw new Error(`Entity ${childId} not found`);
    if (!ids.includes(parentId)) throw new Error(`Entity ${parentId} not found`);
    bridge.setParent(childId, parentId);
    useSceneStore.getState().refresh();
    return { childId, parentId };
  },

  remove_parent: (args) => {
    const { childId } = args as { childId: number };
    const ids = bridge.getEntityIds();
    if (!ids.includes(childId)) throw new Error(`Entity ${childId} not found`);
    bridge.removeParent(childId);
    useSceneStore.getState().refresh();
    return { childId, detached: true };
  },

  update_component: (args) => {
    const { entityId, componentType, patch } = args as {
      entityId:      number;
      componentType: string;
      patch:         Record<string, unknown>;
    };
    const ids = bridge.getEntityIds();
    if (!ids.includes(entityId)) throw new Error(`Entity ${entityId} not found`);

    if (componentType === 'transform') {
      if (patch.position) {
        const p = patch.position as [number, number, number];
        bridge.setPosition(entityId, p[0], p[1], p[2]);
      }
      if (patch.rotation) {
        const r = patch.rotation as [number, number, number];
        bridge.setRotation(entityId, r[0], r[1], r[2]);
      }
      if (patch.scale) {
        const s = patch.scale as [number, number, number];
        bridge.setScale(entityId, s[0], s[1], s[2]);
      }
      useSceneStore.getState().refresh();
    } else {
      // Merge patch into componentStore
      const current = useComponentStore.getState().getComponents(entityId);
      const key = componentType as keyof typeof current;
      const merged = { ...((current[key] ?? {}) as object), ...patch };
      useComponentStore.getState().setComponent(entityId, key, merged as never);
    }
    return { entityId, componentType, patched: patch };
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const schema = schemas[call.tool];
  const handler = handlers[call.tool];

  if (!schema || !handler) {
    return { id: call.id, ok: false, result: null, warnings: [], error: `Unknown tool: ${call.tool}` };
  }

  const parsed = schema.safeParse(call.args);
  if (!parsed.success) {
    return {
      id: call.id, ok: false, result: null, warnings: [],
      error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}`,
    };
  }

  try {
    const result = await handler(parsed.data as Record<string, unknown>);
    return { id: call.id, ok: true, result, warnings: [] };
  } catch (err) {
    return {
      id: call.id, ok: false, result: null, warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

