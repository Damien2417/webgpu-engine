import { bridge } from './engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useComponentStore } from '../store/componentStore';

type ScriptFn = (entity: { id: number }, engine: typeof engineProxy, deltaMs: number) => void;

// Track currently pressed keys for engine.getKey()
const _pressedKeys = new Set<string>();

let _keyListenersAttached = false;

export function initInputTracking() {
  if (_keyListenersAttached) return;
  const onDown = (e: KeyboardEvent) => _pressedKeys.add(e.key.toLowerCase());
  const onUp   = (e: KeyboardEvent) => _pressedKeys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup',   onUp);
  _keyListenersAttached = true;
}

export function clearInputTracking() {
  _pressedKeys.clear();
}

// API proxy exposed to user scripts
const engineProxy = {
  // Position
  getPosition: (id: number): [number, number, number] => {
    return bridge.getTransform(id).position;
  },
  setPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setPosition(id, x, y, z);
  },
  // Rotation
  getRotation: (id: number): [number, number, number] => {
    return bridge.getTransform(id).rotation;
  },
  setRotation: (id: number, x: number, y: number, z: number) => {
    bridge.setRotation(id, x, y, z);
  },
  // Scale
  setScale: (id: number, x: number, y: number, z: number) => {
    bridge.setScale(id, x, y, z);
  },
  // Velocity (requires RigidBody component on entity)
  getVelocity: (id: number): [number, number, number] => {
    return bridge.getVelocity(id);
  },
  setVelocity: (id: number, x: number, y: number, z: number) => {
    bridge.setVelocity(id, x, y, z);
  },
  // Input
  getKey: (key: string): boolean => {
    return _pressedKeys.has(key.toLowerCase());
  },
  // Entity management
  spawnEntity: (name: string): number => {
    const id = bridge.createEntity(name);
    bridge.addMeshRenderer(id);
    useSceneStore.getState().refresh();
    return id;
  },
  destroyEntity: (id: number) => {
    bridge.removeEntity(id);
    useSceneStore.getState().refresh();
  },
  getEntityIds: (): number[] => bridge.getEntityIds(),
  getEntityName: (id: number): string => bridge.getEntityName(id),
  // Tag lookup
  getEntityByTag: (tag: string): number | null => {
    return bridge.getEntityByTag(tag);
  },
  // Logging
  log: (...args: unknown[]) => console.log('[Script]', ...args),
};

interface CompiledScript {
  entityId: number;
  onUpdate?: ScriptFn;
}

let compiledScripts: CompiledScript[] = [];

export function initScripts() {
  compiledScripts = [];
  initInputTracking();
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
