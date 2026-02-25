import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import TransformPanel from './TransformPanel';
import ComponentPanels from './ComponentPanels';
import AddComponentButton from './AddComponentButton';

export default function Inspector() {
  const selectedIds  = useEditorStore(s => s.selectedIds);
  const selectedId   = selectedIds.at(-1) ?? null;
  const selectedCount = selectedIds.length;

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div className="panel-header">
        <span className="panel-header-title">Inspector</span>
      </div>
      {selectedCount > 1 ? (
        <div className="panel-empty">{selectedCount} entities selected</div>
      ) : selectedId !== null ? (
        <>
          <TransformPanel entityId={selectedId} />
          <ComponentPanels entityId={selectedId} />
          <AddComponentButton entityId={selectedId} />
        </>
      ) : (
        <div className="panel-empty">No entity selected.</div>
      )}
    </div>
  );
}
