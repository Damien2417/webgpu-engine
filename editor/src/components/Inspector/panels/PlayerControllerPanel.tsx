import React, { useEffect } from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function PlayerControllerPanel({ entityId }: { entityId: EntityId }) {
  const { removeComponent } = useComponentStore();

  useEffect(() => {
    bridge.setPlayer(entityId);
  }, [entityId]);

  return (
    <PanelSection
      title="Player Controller"
      onRemove={() => removeComponent(entityId, 'isPlayer')}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Cette entité est le joueur FPS.<br />
        En Play : WASD + souris, Espace = saut.
      </div>
    </PanelSection>
  );
}
