import { bridge } from './engineBridge';
import type { EntityId, ParticleData } from './types';
import { useSceneStore } from '../store/sceneStore';

interface Particle {
  id:       EntityId;
  lifetime: number;
  maxLife:  number;
  velocity: [number, number, number];
}

const activeParticles: Particle[] = [];
const emitterConfigs  = new Map<EntityId, ParticleData>();
const emitterTimers   = new Map<EntityId, number>();

export function registerEmitter(emitterId: EntityId, config: ParticleData) {
  emitterConfigs.set(emitterId, config);
  if (!emitterTimers.has(emitterId)) emitterTimers.set(emitterId, 0);
}

export function unregisterEmitter(emitterId: EntityId) {
  emitterConfigs.delete(emitterId);
  emitterTimers.delete(emitterId);
}

export function clearParticles() {
  for (const p of activeParticles) bridge.removeEntity(p.id);
  activeParticles.length = 0;
  emitterConfigs.clear();
  emitterTimers.clear();
}

export function tickParticles(deltaMs: number) {
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
      bridge.setScale(id, 0.1, 0.1, 0.1);
      bridge.addPbrMaterial(id, -1, 0.0, 1.0);
      bridge.setEmissive(id, cfg.color[0], cfg.color[1], cfg.color[2]);
      const spread = cfg.spread;
      const rx = (Math.random() - 0.5) * 2 * spread;
      const rz = (Math.random() - 0.5) * 2 * spread;
      const len = Math.hypot(rx, 1.0, rz) || 1;
      activeParticles.push({
        id,
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
    // Apply gravity from the first registered emitter config
    let gravity = 0;
    for (const cfg of emitterConfigs.values()) { gravity = cfg.gravity; break; }

    const t = bridge.getTransform(p.id);
    const [x, y, z] = t.position;
    p.velocity[1] -= gravity * dt;
    bridge.setPosition(p.id,
      x + p.velocity[0] * dt,
      y + p.velocity[1] * dt,
      z + p.velocity[2] * dt,
    );
    const frac = 1 - p.lifetime / p.maxLife;
    bridge.setScale(p.id, 0.1 * frac, 0.1 * frac, 0.1 * frac);
  }
  // Notify scene of changes
  if (activeParticles.length > 0) useSceneStore.getState().refresh();
}
