import { bridge } from './engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useComponentStore } from '../store/componentStore';

type ScriptFn = (entity: { id: number }, engine: typeof engineProxy, deltaMs: number) => void;

// API proxy exposed to user scripts
const engineProxy = {
  getPosition: (id: number): [number, number, number] => {
    const t = bridge.getTransform(id);
    return t.position;
  },
  setPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setPosition(id, x, y, z);
  },
  getEntityByTag: (tag: string): number | null => {
    return bridge.getEntityByTag(tag);
  },
  log: (...args: unknown[]) => console.log('[Script]', ...args),
};

interface CompiledScript {
  entityId: number;
  onUpdate?: ScriptFn;
}

let compiledScripts: CompiledScript[] = [];

export function initScripts() {
  compiledScripts = [];
  const entities = useSceneStore.getState().entities;
  const compStore = useComponentStore.getState();

  for (const entity of entities) {
    const script = compStore.getComponents(entity.id).script;
    if (!script || !script.trim()) continue;

    let fn: ScriptFn;
    try {
      fn = new Function('entity', 'engine', 'deltaMs', script) as ScriptFn;
    } catch (e) {
      console.error(`[Script] Compile error on entity ${entity.id}:`, e);
      continue;
    }
    compiledScripts.push({ entityId: entity.id, onUpdate: fn });
    try {
      fn({ id: entity.id }, engineProxy, 0);
    } catch (e) {
      console.error(`[Script] onStart error on entity ${entity.id}:`, e);
    }
  }
}

export function tickScripts(deltaMs: number) {
  for (const cs of compiledScripts) {
    try {
      cs.onUpdate?.({ id: cs.entityId }, engineProxy, deltaMs);
    } catch (e) {
      console.error(`[Script] Runtime error on entity ${cs.entityId}:`, e);
    }
  }
}
