import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';
import { useComponentStore } from '../../store/componentStore';
import { bridge } from '../../engine/engineBridge';
import type { EntityData } from '../../engine/types';

const s: Record<string, React.CSSProperties> = {
  root:   { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' },
  list:   { flex: 1, overflow: 'auto' },
  addBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 7px', fontSize: 11 },
  search: { width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', padding: '3px 6px', fontSize: 11, boxSizing: 'border-box' as const },
};

export default function SceneGraph() {
  const entities        = useSceneStore(s => s.entities);
  const addEntity       = useSceneStore(s => s.addEntity);
  const removeEntity    = useSceneStore(s => s.removeEntity);
  const duplicateEntity  = useSceneStore(s => s.duplicateEntity);
  const groupSelected    = useSceneStore(s => s.groupSelected);
  const ungroupSelected  = useSceneStore(s => s.ungroupSelected);
  const refresh          = useSceneStore(s => s.refresh);
  const selectedIds     = useEditorStore(s => s.selectedIds);
  const select          = useEditorStore(s => s.select);
  const toggleSelect    = useEditorStore(s => s.toggleSelect);
  const selectAll       = useEditorStore(s => s.selectAll);
  const clearSelection  = useEditorStore(s => s.clearSelection);
  const setGizmoMode    = useEditorStore(s => s.setGizmoMode);
  const selectedId      = selectedIds.at(-1) ?? null;

  const [search, setSearch]           = useState('');
  const [expanded, setExpanded]       = useState<Record<number, boolean>>({});
  const [renamingId, setRenamingId]   = useState<number | null>(null);
  const [renameVal, setRenameVal]     = useState('');
  const [dragOver, setDragOver]       = useState<number | 'root' | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const toggleExpand = (id: number) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

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

  // Recursive node render
  const renderNode = (e: EntityData, depth: number): React.ReactNode => {
    const isSelected   = selectedIds.includes(e.id);
    const hasChildren  = e.children.length > 0;
    const isExpanded   = expanded[e.id] ?? true;
    const isDragTarget = dragOver === e.id;

    return (
      <React.Fragment key={e.id}>
        <div
          style={{
            padding: `3px 8px 3px ${16 + depth * 14}px`,
            cursor: 'pointer',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            background: isSelected ? 'var(--bg-select)'
              : isDragTarget ? 'var(--bg-hover)'
              : 'transparent',
            color: isSelected ? '#fff' : 'var(--text)',
            borderTop: isDragTarget ? '1px solid var(--accent)' : 'none',
          }}
          onClick={(ev) => {
            if (ev.ctrlKey || ev.metaKey) toggleSelect(e.id);
            else select(e.id);
          }}
          onDoubleClick={() => {
            setRenamingId(e.id);
            setRenameVal(e.name);
            setTimeout(() => renameRef.current?.select(), 10);
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            snapBefore();
            removeEntity(e.id);
            if (isSelected) clearSelection();
          }}
          draggable
          onDragStart={(ev) => { ev.dataTransfer.setData('entityId', String(e.id)); }}
          onDragOver={(ev) => { ev.preventDefault(); setDragOver(e.id); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(ev) => {
            ev.preventDefault();
            setDragOver(null);
            const draggedId = Number(ev.dataTransfer.getData('entityId'));
            if (draggedId !== e.id) {
              snapBefore();
              bridge.setParent(draggedId, e.id);
              refresh();
            }
          }}
          title="Double-click: rename | Right-click: delete | Ctrl+D: duplicate | Drag: reparent"
        >
          {/* Chevron expand/collapse */}
          <span
            style={{ width: 12, color: 'var(--text-dim)', fontSize: 10, flexShrink: 0, cursor: hasChildren ? 'pointer' : 'default' }}
            onClick={(ev) => {
              if (hasChildren) {
                ev.stopPropagation();
                toggleExpand(e.id);
              }
            }}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
          </span>
          {/* Icon: group (no mesh) or entity */}
          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
            {hasChildren && !e.hasMesh ? '◻' : '◈'}
          </span>
          {/* Name / rename input */}
          {renamingId === e.id ? (
            <input
              ref={renameRef}
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--accent)', color: '#fff', borderRadius: 2, padding: '0 4px', fontSize: 12, width: '80%' }}
              value={renameVal}
              onChange={ev => setRenameVal(ev.target.value)}
              onBlur={commitRename}
              onKeyDown={ev => {
                if (ev.key === 'Enter') commitRename();
                if (ev.key === 'Escape') setRenamingId(null);
              }}
              onClick={ev => ev.stopPropagation()}
            />
          ) : e.name}
        </div>
        {/* Children */}
        {hasChildren && isExpanded && e.children.map(childId => {
          const child = entities.find(x => x.id === childId);
          return child ? renderNode(child, depth + 1) : null;
        })}
      </React.Fragment>
    );
  };

  // Root entities: no parent (or when searching, show all matches flat)
  const roots = search
    ? entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : entities.filter(e => e.parentId === undefined);

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
        clearSelection();
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D') && selectedId !== null) {
        e.preventDefault();
        snapBefore();
        const newId = duplicateEntity(selectedId);
        if (newId !== null) select(newId);
      }
      // Ctrl+G — grouper
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (selectedIds.length >= 2) { snapBefore(); groupSelected(); }
      }
      // Ctrl+Shift+G — dégrouper
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        snapBefore(); ungroupSelected();
      }
      // Ctrl+A — select all
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectAll(entities.map(e => e.id));
      }
      // Escape — deselect
      if (e.key === 'Escape') {
        clearSelection();
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
  }, [selectedId, selectedIds, entities, select, clearSelection, selectAll, removeEntity, duplicateEntity, groupSelected, ungroupSelected, setGizmoMode, refresh]);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Scene</span>
        <button style={s.addBtn} onClick={() => { const id = addEntity(); select(id); }} title="Add Entity">+</button>
      </div>
      {/* Root drop zone */}
      <div
        style={{
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          background: dragOver === 'root' ? 'var(--bg-hover)' : 'transparent',
        }}
        onDragOver={(ev) => { ev.preventDefault(); setDragOver('root'); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(ev) => {
          ev.preventDefault();
          setDragOver(null);
          const draggedId = Number(ev.dataTransfer.getData('entityId'));
          if (bridge.getParent(draggedId) !== null) {
            snapBefore();
            bridge.removeParent(draggedId);
            refresh();
          }
        }}
      >
        <input
          style={s.search}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div style={s.list}>
        {roots.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--text-dim)', fontSize: 11 }}>
            {search ? 'No results' : 'Empty scene — click + to add'}
          </div>
        )}
        {roots.map(e => renderNode(e, 0))}
      </div>
    </div>
  );
}
