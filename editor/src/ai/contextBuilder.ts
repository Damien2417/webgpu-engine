// ── Build a compact scene context to send to the LLM ─────────────────────────

import { bridge } from '../engine/engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useEditorStore } from '../store/editorStore';
import { useComponentStore } from '../store/componentStore';

const MAX_ENTITIES = 60; // trim context for large scenes

export interface SceneContext {
  entities: EntityContext[];
  selection: EntityContext | null;
  editorRules: EditorRules;
}

interface EntityContext {
  id:         number;
  name:       string;
  tag:        string;
  position:   [number, number, number];
  rotation:   [number, number, number];
  scale:      [number, number, number];
  components: string[];
  parentId?:  number;   // absent = entité racine
  children:   number[];
}

interface EditorRules {
  units: string;
  axes:  string;
  note:  string;
}

function buildEntityContext(id: number): EntityContext {
  const name  = bridge.getEntityName(id);
  const tag   = bridge.getTag(id);
  const t     = bridge.getTransform(id);
  const comps = useComponentStore.getState().getComponents(id);
  const componentNames = Object.keys(comps).filter(k => comps[k as keyof typeof comps] !== undefined);

  return {
    id, name, tag,
    position: t.position,
    rotation: t.rotation,
    scale:    t.scale,
    components: componentNames,
    parentId:   bridge.getParent(id) ?? undefined,
    children:   bridge.getChildren(id),
  };
}

export function buildSceneContext(): SceneContext {
  const allIds    = bridge.getEntityIds();
  const selectedId = useEditorStore.getState().selectedIds.at(-1) ?? null;

  const ids = allIds.slice(0, MAX_ENTITIES);
  const entities = ids.map(buildEntityContext);

  const selection = selectedId !== null ? buildEntityContext(selectedId) : null;

  return {
    entities,
    selection,
    editorRules: {
      units: 'meters',
      axes:  'Y-up, Z-forward',
      note:  `Scene has ${allIds.length} entities. Only first ${MAX_ENTITIES} shown if truncated.`,
    },
  };
}

/** Returns a compact JSON string to include in the LLM system prompt */
export function buildContextString(): string {
  const ctx = buildSceneContext();
  return JSON.stringify(ctx, null, 0);
}
