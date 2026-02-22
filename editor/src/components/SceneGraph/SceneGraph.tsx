import React from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';

const s: Record<string, React.CSSProperties> = {
  root:   { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' },
  list:   { flex: 1, overflow: 'auto' },
  item:   { padding: '4px 8px 4px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  addBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 7px', fontSize: 11 },
};

export default function SceneGraph() {
  const entities     = useSceneStore(s => s.entities);
  const addEntity    = useSceneStore(s => s.addEntity);
  const removeEntity = useSceneStore(s => s.removeEntity);
  const selectedId   = useEditorStore(s => s.selectedId);
  const select       = useEditorStore(s => s.select);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Scene</span>
        <button style={s.addBtn} onClick={() => { const id = addEntity(); select(id); }} title="Ajouter une entité">+</button>
      </div>
      <div style={s.list}>
        {entities.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--text-dim)', fontSize: 11 }}>
            Scène vide — cliquer + pour ajouter
          </div>
        )}
        {entities.map(e => (
          <div
            key={e.id}
            style={{
              ...s.item,
              background: e.id === selectedId ? 'var(--bg-select)' : 'transparent',
              color:      e.id === selectedId ? '#fff' : 'var(--text)',
            }}
            onClick={() => select(e.id)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              removeEntity(e.id);
              if (selectedId === e.id) select(null);
            }}
            title="Clic droit = supprimer"
          >
            <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>▸</span>
            {e.name}
          </div>
        ))}
      </div>
    </div>
  );
}
