import { bridge } from './engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useComponentStore } from '../store/componentStore';
import { useConsoleStore } from '../store/consoleStore';

type ScriptFn = (entity: { id: number }, engine: typeof engineProxy, deltaMs: number) => void;

// Track currently pressed keys for engine.getKey()
const _pressedKeys = new Set<string>();

// Entity ID en cours d'exécution (pour attribuer les logs à la bonne entité)
let _currentEntityId = -1;

let _keyListenersAttached = false;
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let _onKeyUp:   ((e: KeyboardEvent) => void) | null = null;

export function initInputTracking() {
  if (_keyListenersAttached) return;
  const skip = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  };
  _onKeyDown = (e: KeyboardEvent) => { if (!skip(e)) _pressedKeys.add(e.key.toLowerCase()); };
  _onKeyUp   = (e: KeyboardEvent) => { if (!skip(e)) _pressedKeys.delete(e.key.toLowerCase()); };
  window.addEventListener('keydown', _onKeyDown);
  window.addEventListener('keyup',   _onKeyUp);
  _keyListenersAttached = true;
}

export function clearInputTracking() {
  if (_onKeyDown) { window.removeEventListener('keydown', _onKeyDown); _onKeyDown = null; }
  if (_onKeyUp)   { window.removeEventListener('keyup',   _onKeyUp);   _onKeyUp   = null; }
  _pressedKeys.clear();
  _keyListenersAttached = false;
}

// API proxy exposed to user scripts
const engineProxy = {
  // Position (local space — relative to parent if any)
  getPosition: (id: number): [number, number, number] => {
    return bridge.getTransform(id).position;
  },
  setPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setPosition(id, x, y, z);
  },
  // Position (world space)
  getWorldPosition: (id: number): [number, number, number] => {
    return bridge.getWorldTransform(id).position;
  },
  setWorldPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setWorldPosition(id, x, y, z);
  },
  // Rotation (local space, Euler degrees)
  getRotation: (id: number): [number, number, number] => {
    return bridge.getTransform(id).rotation;
  },
  setRotation: (id: number, x: number, y: number, z: number) => {
    bridge.setRotation(id, x, y, z);
  },
  // Rotation (world space, Euler degrees)
  getWorldRotation: (id: number): [number, number, number] => {
    return bridge.getWorldTransform(id).rotation;
  },
  // Scale
  getScale: (id: number): [number, number, number] => {
    return bridge.getTransform(id).scale;
  },
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
  log: (...args: unknown[]) => {
    const msg    = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const source = _currentEntityId >= 0 ? bridge.getEntityName(_currentEntityId) : 'Script';
    useConsoleStore.getState().append('log', msg, source);
  },
  warn: (...args: unknown[]) => {
    const msg    = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const source = _currentEntityId >= 0 ? bridge.getEntityName(_currentEntityId) : 'Script';
    useConsoleStore.getState().append('warn', msg, source);
  },
};

interface CompiledScript {
  entityId: number;
  onUpdate?: ScriptFn;
  hasError:  boolean;
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
    const entityName = bridge.getEntityName(entity.id);
    try {
      fn = new Function('entity', 'engine', 'deltaMs', script) as ScriptFn;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useConsoleStore.getState().append('error', `Compile error: ${msg}`, entityName);
      continue;
    }
    compiledScripts.push({ entityId: entity.id, onUpdate: fn, hasError: false });
    try {
      _currentEntityId = entity.id;
      fn({ id: entity.id }, engineProxy, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useConsoleStore.getState().append('error', `onStart error: ${msg}`, entityName);
    } finally {
      _currentEntityId = -1;
    }
  }
}

export function tickScripts(deltaMs: number) {
  for (const cs of compiledScripts) {
    if (cs.hasError) continue;
    try {
      _currentEntityId = cs.entityId;
      cs.onUpdate?.({ id: cs.entityId }, engineProxy, deltaMs);
    } catch (e) {
      cs.hasError = true;
      const msg        = e instanceof Error ? e.message : String(e);
      const entityName = bridge.getEntityName(cs.entityId);
      useConsoleStore.getState().append('error', `Runtime error: ${msg}`, entityName);
    } finally {
      _currentEntityId = -1;
    }
  }
}
