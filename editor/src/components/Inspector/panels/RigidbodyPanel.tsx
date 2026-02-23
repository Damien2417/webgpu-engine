import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function RigidbodyPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const rb = getComponents(entityId).rigidbody ?? { isStatic: true };

  const toggle = () => {
    const next = { isStatic: !rb.isStatic };
    setComponent(entityId, 'rigidbody', next);
    bridge.addRigidBody(entityId, next.isStatic);
  };

  return (
    <PanelSection title="Rigidbody" onRemove={() => removeComponent(entityId, 'rigidbody')}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
        <input type="checkbox" checked={rb.isStatic} onChange={toggle} />
        <span style={{ color: 'var(--text)' }}>Is Static</span>
      </label>
    </PanelSection>
  );
}
