import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import TransformPanel from './TransformPanel';

export default function Inspector() {
  const selectedId = useEditorStore(s => s.selectedId);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>
        Inspector
      </div>
      {selectedId !== null
        ? <TransformPanel entityId={selectedId} />
        : <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11 }}>No entity selected</div>
      }
    </div>
  );
}
