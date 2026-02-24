import React, { useState, useRef, useEffect } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';
import { useComponentStore } from '../../store/componentStore';
import { bridge } from '../../engine/engineBridge';

const s: Record<string, React.CSSProperties> = {
  root:   { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' },
  list:   { flex: 1, overflow: 'auto' },
  item:   { padding: '4px 8px 4px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  addBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 7px', fontSize: 11 },
  search: { width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', padding: '3px 6px', fontSize: 11, boxSizing: 'border-box' as const },
};

export default function SceneGraph() {
  const entities         = useSceneStore(s => s.entities);
  const addEntity        = useSceneStore(s => s.addEntity);
  const removeEntity     = useSceneStore(s => s.removeEntity);
  const duplicateEntity  = useSceneStore(s => s.duplicateEntity);
  const refresh          = useSceneStore(s => s.refresh);
  const selectedId       = useEditorStore(s => s.selectedId);
  const select           = useEditorStore(s => s.select);
  const setGizmoMode     = useEditorStore(s => s.setGizmoMode);

  const [search, setSearch]         = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal]   = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : entities;

  const startRename = (id: number, name: string) => {
    setRenamingId(id);
    setRenameVal(name);
    setTimeout(() => renameRef.current?.select(), 10);
  };

  const commitRename = () => {
    if (renamingId !== null && renameVal.trim()) {
      bridge.setEntityName(renamingId, renameVal.trim());
      refresh();
    }
    setRenamingId(null);
  };

  // Capture undo snapshot before destructive operations
  const snapBefore = () => {
    useEditorStore.getState().pushUndo({
      engineJson: bridge.saveScene(),
      editorMeta: useComponentStore.getState().serialize() as Record<number, unknown>,
    });
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
      if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
      if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
        snapBefore();
        removeEntity(selectedId);
        select(null);
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D') && selectedId !== null) {
        e.preventDefault();
        snapBefore();
        const newId = duplicateEntity(selectedId);
        if (newId !== null) select(newId);
      }
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('editor:save'));
      }
      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const currentSnap = {
          engineJson: bridge.saveScene(),
          editorMeta: useComponentStore.getState().serialize() as Record<number, unknown>,
        };
        const snap = useEditorStore.getState().undo(currentSnap);
        if (snap) {
          bridge.loadScene(snap.engineJson);
          useComponentStore.getState().deserialize(snap.editorMeta as Record<number, import('../../engine/types').EntityComponents>);
          refresh();
        }
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        const currentSnap = {
          engineJson: bridge.saveScene(),
          editorMeta: useComponentStore.getState().serialize() as Record<number, unknown>,
        };
        const snap = useEditorStore.getState().redo(currentSnap);
        if (snap) {
          bridge.loadScene(snap.engineJson);
          useComponentStore.getState().deserialize(snap.editorMeta as Record<number, import('../../engine/types').EntityComponents>);
          refresh();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select, removeEntity, duplicateEntity, setGizmoMode, refresh]);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Scene</span>
        <button style={s.addBtn} onClick={() => { const id = addEntity(); select(id); }} title="Add Entity">+</button>
      </div>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
        <input
          style={s.search}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div style={s.list}>
        {filtered.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--text-dim)', fontSize: 11 }}>
            {search ? 'No results' : 'Empty scene — click + to add'}
          </div>
        )}
        {filtered.map(e => (
          <div
            key={e.id}
            style={{
              ...s.item,
              background: e.id === selectedId ? 'var(--bg-select)' : 'transparent',
              color:      e.id === selectedId ? '#fff' : 'var(--text)',
            }}
            onClick={() => select(e.id)}
            onDoubleClick={() => startRename(e.id, e.name)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              snapBefore();
              removeEntity(e.id);
              if (selectedId === e.id) select(null);
            }}
            title="Double-click to rename | Right-click to delete | Ctrl+D to duplicate"
          >
            <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>▸</span>
            {renamingId === e.id ? (
              <input
                ref={renameRef}
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--accent)', color: '#fff', borderRadius: 2, padding: '0 4px', fontSize: 12, width: '80%' }}
                value={renameVal}
                onChange={ev => setRenameVal(ev.target.value)}
                onBlur={commitRename}
                onKeyDown={ev => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenamingId(null); }}
                onClick={ev => ev.stopPropagation()}
              />
            ) : e.name}
          </div>
        ))}
      </div>
    </div>
  );
}
