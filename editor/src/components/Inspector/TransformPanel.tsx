import React from 'react';
import Vec3Input from './Vec3Input';
import { useSceneStore } from '../../store/sceneStore';
import type { EntityId } from '../../engine/types';

export default function TransformPanel({ entityId }: { entityId: EntityId }) {
  const entity         = useSceneStore(s => s.entities.find(e => e.id === entityId));
  const updatePosition = useSceneStore(s => s.updatePosition);
  const updateRotation = useSceneStore(s => s.updateRotation);
  const updateScale    = useSceneStore(s => s.updateScale);

  if (!entity) return null;
  const { position, rotation, scale } = entity.transform;

  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Transform
      </div>
      <Vec3Input label="Position" value={position} onChange={(x, y, z) => updatePosition(entityId, x, y, z)} />
      <Vec3Input label="Rotation" value={rotation} onChange={(x, y, z) => updateRotation(entityId, x, y, z)} step={1} />
      <Vec3Input label="Scale"    value={scale}    onChange={(x, y, z) => updateScale(entityId, x, y, z)} />
    </div>
  );
}
