import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, ColliderData } from '../../../engine/types';

export default function ColliderPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const col: ColliderData = getComponents(entityId).collider ?? { hx: 0.5, hy: 0.5, hz: 0.5 };

  const apply = (next: ColliderData) => {
    setComponent(entityId, 'collider', next);
    bridge.addCollider(entityId, next.hx, next.hy, next.hz);
  };

  return (
    <PanelSection title="Box Collider" onRemove={() => removeComponent(entityId, 'collider')}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button
          onClick={() => {
            bridge.fitColliderToMesh(entityId, 0.05);
            const [hx, hy, hz] = bridge.getCollider(entityId);
            apply({ hx, hy, hz });
          }}
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            fontSize: 11,
            padding: '2px 6px',
            cursor: 'pointer',
          }}
          title="Fit collider to current mesh bounds"
        >
          Fit To Mesh
        </button>
      </div>
      {(['hx', 'hy', 'hz'] as const).map(axis => (
        <div key={axis} style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
          <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>Half {axis.toUpperCase()}</span>
          <input
            type="number"
            step={0.1}
            min={0.01}
            value={col[axis]}
            onChange={e => apply({ ...col, [axis]: Math.max(0.01, parseFloat(e.target.value) || 0.01) })}
            style={{
              width: 60,
              background: 'var(--bg-hover)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              fontSize: 11,
              padding: '1px 4px',
            }}
          />
        </div>
      ))}
    </PanelSection>
  );
}
