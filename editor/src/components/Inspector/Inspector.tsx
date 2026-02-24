import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import TransformPanel from './TransformPanel';
import ComponentPanels from './ComponentPanels';
import AddComponentButton from './AddComponentButton';

export default function Inspector() {
  const selectedId = useEditorStore(s => s.selectedId);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div className="panel-header">
        <span className="panel-header-title">Inspector</span>
      </div>
      {selectedId !== null ? (
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
