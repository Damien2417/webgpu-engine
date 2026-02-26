import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import type { EntityId } from '../../../engine/types';

export default function ScriptPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const script = getComponents(entityId).script ?? '';

  return (
    <PanelSection title="Script (JS)" onRemove={() => removeComponent(entityId, 'script')}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
        Executed each frame in Play mode. Args: <code>entity</code>, <code>engine</code>, <code>deltaMs</code>.<br />
        <code>getPosition</code>/<code>setPosition</code> = <b>local space</b>. Use <code>getWorldPosition</code> for world space.
      </div>
      <textarea
        value={script}
        onChange={e => setComponent(entityId, 'script', e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          height: 120,
          background: '#1a1a2e',
          color: '#e0e0ff',
          border: '1px solid var(--border)',
          borderRadius: 3,
          fontSize: 10,
          fontFamily: 'monospace',
          padding: 6,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
    </PanelSection>
  );
}
