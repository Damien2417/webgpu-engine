import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function MeshRendererPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const meshType = getComponents(entityId).meshType ?? 'cube';

  const handleChange = (val: 'cube' | 'plane') => {
    setComponent(entityId, 'meshType', val);
    bridge.setMeshType(entityId, val);
  };

  return (
    <PanelSection title="Mesh Renderer" onRemove={() => removeComponent(entityId, 'meshType')}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, gap: 8 }}>
        <span style={{ color: 'var(--text-dim)', width: 70 }}>Mesh Type</span>
        <select
          value={meshType}
          onChange={e => handleChange(e.target.value as 'cube' | 'plane')}
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            fontSize: 11,
            padding: '2px 4px',
          }}
        >
          <option value="cube">Cube</option>
          <option value="plane">Plane</option>
        </select>
      </div>
    </PanelSection>
  );
}
