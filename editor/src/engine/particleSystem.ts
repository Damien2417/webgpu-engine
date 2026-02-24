import { bridge } from './engineBridge';
import type { EntityId, ParticleData } from './types';
import { useSceneStore } from '../store/sceneStore';
import { useComponentStore } from '../store/componentStore';

interface Particle {
  id:        EntityId;
  emitterId: EntityId;  // which emitter spawned this particle
  lifetime:  number;
  maxLife:   number;
  velocity:  [number, number, number];
}

const activeParticles: Particle[] = [];
const emitterConfigs  = new Map<EntityId, ParticleData>();
const emitterTimers   = new Map<EntityId, number>();

const DEFAULT_CFG: ParticleData = {
  rate: 20,
  lifetime: 1.8,
  speed: 3,
  spread: 0.3,
  gravity: 2,
  sizeStart: 0.16,
  sizeEnd: 0.02,
  colorStart: [1.0, 0.65, 0.15],
  colorEnd: [0.9, 0.1, 0.0],
};

function normalizeCfg(input: any): ParticleData {
  return {
    rate: typeof input?.rate === 'number' ? input.rate : DEFAULT_CFG.rate,
    lifetime: typeof input?.lifetime === 'number' ? input.lifetime : DEFAULT_CFG.lifetime,
    speed: typeof input?.speed === 'number' ? input.speed : DEFAULT_CFG.speed,
    spread: typeof input?.spread === 'number' ? input.spread : DEFAULT_CFG.spread,
    gravity: typeof input?.gravity === 'number' ? input.gravity : DEFAULT_CFG.gravity,
    sizeStart: typeof input?.sizeStart === 'number' ? input.sizeStart : 0.1,
    sizeEnd: typeof input?.sizeEnd === 'number' ? input.sizeEnd : 0.0,
    colorStart: Array.isArray(input?.colorStart)
      ? input.colorStart
      : (Array.isArray(input?.color) ? input.color : DEFAULT_CFG.colorStart),
    colorEnd: Array.isArray(input?.colorEnd)
      ? input.colorEnd
      : (Array.isArray(input?.color) ? input.color : DEFAULT_CFG.colorEnd),
  };
}

function syncEmittersFromComponentStore() {
  const components = useComponentStore.getState().components;
  const nextIds = new Set<EntityId>();

  for (const [idStr, comps] of Object.entries(components)) {
    if (!comps.particle) continue;
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    nextIds.add(id);
    emitterConfigs.set(id, normalizeCfg(comps.particle));
    if (!emitterTimers.has(id)) emitterTimers.set(id, 0);
  }

  for (const id of Array.from(emitterConfigs.keys())) {
    if (!nextIds.has(id)) {
      emitterConfigs.delete(id);
      emitterTimers.delete(id);
    }
  }
}

export function registerEmitter(emitterId: EntityId, config: ParticleData) {
  emitterConfigs.set(emitterId, normalizeCfg(config));
  if (!emitterTimers.has(emitterId)) emitterTimers.set(emitterId, 0);
}

export function unregisterEmitter(emitterId: EntityId) {
  emitterConfigs.delete(emitterId);
  emitterTimers.delete(emitterId);
}

export function clearParticles() {
  for (const p of activeParticles) bridge.removeEntity(p.id);
  activeParticles.length = 0;
  // Keep emitterConfigs intact so emitters resume on next Play press.
  // Only reset the timers so spawn intervals restart cleanly.
  emitterTimers.clear();
  for (const id of emitterConfigs.keys()) emitterTimers.set(id, 0);
}

export function tickParticles(deltaMs: number) {
  syncEmittersFromComponentStore();
  const dt = deltaMs / 1000;

  // Spawn new particles from all registered emitters
  for (const [emitterId, cfg] of emitterConfigs) {
    const t = (emitterTimers.get(emitterId) ?? 0) + dt;
    emitterTimers.set(emitterId, t);
    const interval = 1.0 / cfg.rate;
    while (emitterTimers.get(emitterId)! >= interval) {
      emitterTimers.set(emitterId, emitterTimers.get(emitterId)! - interval);
      const pos = bridge.getTransform(emitterId).position;
      const id  = bridge.createEntity('__particle__');
      bridge.addMeshRenderer(id);
      bridge.setPosition(id, pos[0], pos[1], pos[2]);
      bridge.setScale(id, cfg.sizeStart, cfg.sizeStart, cfg.sizeStart);
      bridge.addPbrMaterial(id, -1, 0.0, 1.0);
      bridge.setEmissive(id, cfg.colorStart[0], cfg.colorStart[1], cfg.colorStart[2]);
      const spread = cfg.spread;
      const rx = (Math.random() - 0.5) * 2 * spread;
      const rz = (Math.random() - 0.5) * 2 * spread;
      const len = Math.hypot(rx, 1.0, rz) || 1;
      activeParticles.push({
        id,
        emitterId,
        lifetime: 0,
        maxLife:  cfg.lifetime,
        velocity: [rx / len * cfg.speed, 1.0 / len * cfg.speed, rz / len * cfg.speed],
      });
    }
  }

  // Update + age particles
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.lifetime += dt;
    if (p.lifetime >= p.maxLife) {
      bridge.removeEntity(p.id);
      activeParticles.splice(i, 1);
      continue;
    }
    // Use gravity from the emitter that spawned this particle
    const cfg = emitterConfigs.get(p.emitterId);
    const gravity = cfg?.gravity ?? 0;

    const t = bridge.getTransform(p.id);
    const [x, y, z] = t.position;
    p.velocity[1] -= gravity * dt;
    bridge.setPosition(p.id,
      x + p.velocity[0] * dt,
      y + p.velocity[1] * dt,
      z + p.velocity[2] * dt,
    );
    const tNorm = Math.max(0, Math.min(1, p.lifetime / p.maxLife));
    const sizeStart = cfg?.sizeStart ?? 0.1;
    const sizeEnd = cfg?.sizeEnd ?? 0.0;
    const size = sizeStart + (sizeEnd - sizeStart) * tNorm;
    bridge.setScale(p.id, size, size, size);
    const c0 = cfg?.colorStart ?? [1, 0.65, 0.15];
    const c1 = cfg?.colorEnd ?? [0.9, 0.1, 0.0];
    bridge.setEmissive(
      p.id,
      c0[0] + (c1[0] - c0[0]) * tNorm,
      c0[1] + (c1[1] - c0[1]) * tNorm,
      c0[2] + (c1[2] - c0[2]) * tNorm,
    );
  }
  // Notify scene of changes
  if (activeParticles.length > 0) useSceneStore.getState().refresh();
}
