import React, { useState } from 'react';
import { useComponentStore } from '../../store/componentStore';
import { bridge } from '../../engine/engineBridge';
import type { EntityComponents } from '../../engine/types';
import type { EntityId } from '../../engine/types';

type ComponentKey = keyof EntityComponents;

const AVAILABLE_COMPONENTS: { key: ComponentKey; label: string }[] = [
  { key: 'meshType',         label: 'Mesh Renderer' },
  { key: 'material',         label: 'Material (PBR)' },
  { key: 'rigidbody',        label: 'Rigidbody' },
  { key: 'collider',         label: 'Box Collider' },
  { key: 'pointLight',       label: 'Point Light' },
  { key: 'directionalLight', label: 'Directional Light' },
  { key: 'isPlayer',         label: 'Player Controller' },
  { key: 'script',           label: 'Script' },
  { key: 'camera',           label: 'Camera' },
  { key: 'particle',         label: 'Particle Emitter' },
];

const DEFAULT_VALUES: Required<EntityComponents> = {
  meshType:         'cube',
  material:         { texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0] },
  rigidbody:        { isStatic: true },
  collider:         { hx: 0.5, hy: 0.5, hz: 0.5 },
  pointLight:       { r: 1, g: 1, b: 1, intensity: 5.0 },
  directionalLight: { dx: 0.3, dy: -1, dz: 0.5, r: 1, g: 0.95, b: 0.8, intensity: 100, coneAngle: 30 },
  isPlayer:         true,
  script:           '// Script body — runs every frame in Play mode.\n// getPosition/setPosition = LOCAL space (relative to parent).\n// Use getWorldPosition/setWorldPosition for world space.\n\n// Bobbing example (works on child entities too):\nvar baseY = null;\nif (baseY === null) baseY = engine.getPosition(entity.id)[1];\nvar [lx, , lz] = engine.getPosition(entity.id);\nengine.setPosition(entity.id, lx, baseY + Math.sin(Date.now() * 0.003) * 0.05, lz);',
  camera:           { fov: 60, near: 0.1, far: 1000, isActive: false, followEntity: false },
  particle:         {
    rate: 20,
    lifetime: 1.8,
    speed: 3,
    spread: 0.3,
    gravity: 2,
    sizeStart: 0.16,
    sizeEnd: 0.02,
    colorStart: [1.0, 0.65, 0.15],
    colorEnd: [0.9, 0.1, 0.0],
  },
};

export default function AddComponentButton({ entityId }: { entityId: EntityId }) {
  const [open, setOpen] = useState(false);
  const { getComponents, setComponent } = useComponentStore();
  const existing = getComponents(entityId);

  const available = AVAILABLE_COMPONENTS.filter(c => existing[c.key] === undefined);

  if (available.length === 0) return null;

  const applyEngineSide = (key: ComponentKey) => {
    switch (key) {
      case 'meshType': {
        const m = DEFAULT_VALUES.meshType;
        bridge.setMeshType(entityId, m);
        break;
      }
      case 'material': {
        const m = DEFAULT_VALUES.material;
        bridge.addPbrMaterial(entityId, m.texId, m.metallic, m.roughness);
        bridge.setEmissive(entityId, m.emissive[0], m.emissive[1], m.emissive[2]);
        break;
      }
      case 'rigidbody': {
        bridge.addRigidBody(entityId, DEFAULT_VALUES.rigidbody.isStatic);
        break;
      }
      case 'collider': {
        const c = DEFAULT_VALUES.collider;
        bridge.addCollider(entityId, c.hx, c.hy, c.hz);
        break;
      }
      case 'pointLight': {
        const l = DEFAULT_VALUES.pointLight;
        bridge.addPointLight(entityId, l.r, l.g, l.b, l.intensity);
        break;
      }
      case 'directionalLight': {
        const l = DEFAULT_VALUES.directionalLight;
        bridge.addDirectionalLightEntity(entityId, l.r, l.g, l.b, l.intensity, l.coneAngle);
        break;
      }
      case 'isPlayer': {
        bridge.setPlayer(entityId);
        break;
      }
      case 'camera': {
        const c = DEFAULT_VALUES.camera;
        bridge.addCamera(entityId, c.fov, c.near, c.far);
        bridge.setCameraFollowEntity(entityId, c.followEntity);
        break;
      }
      case 'script':
      case 'particle':
      default:
        break;
    }
  };

  const add = (key: ComponentKey) => {
    setComponent(entityId, key, DEFAULT_VALUES[key] as EntityComponents[typeof key]);
    applyEngineSide(key);
    setOpen(false);
  };

  return (
    <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 3,
          padding: '4px 0',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        + Add Component
      </button>
      {open && (
        <div style={{
          marginTop: 4,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          {available.map(c => (
            <div
              key={c.key}
              onClick={() => add(c.key)}
              style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 11, color: 'var(--text)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
