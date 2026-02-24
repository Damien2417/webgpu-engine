import React from 'react';
import { useEditorStore, type GizmoMode } from '../../store/editorStore';
import { useComponentStore } from '../../store/componentStore';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';

const btn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--bg-select)' : 'var(--bg-hover)',
  border: '1px solid var(--border)',
  color: active ? 'var(--accent)' : 'var(--text)',
  borderRadius: 3, padding: '3px 10px', cursor: 'pointer',
  fontSize: 11, lineHeight: 1.4,
});

const MODES: { key: GizmoMode; label: string; shortcut: string }[] = [
  { key: 'translate', label: '↔ Move',   shortcut: 'W' },
  { key: 'rotate',    label: '↻ Rotate', shortcut: 'E' },
  { key: 'scale',     label: '⤡ Scale',  shortcut: 'R' },
];

export default function Toolbar() {
  const { gizmoMode, setGizmoMode, isPlaying, setPlaying, setSnapshot, sceneSnapshot, select } = useEditorStore();
  const refresh = useSceneStore(s => s.refresh);

  const play = () => {
    // Save BOTH engine state AND editor metadata (component store)
    const engineJson = bridge.saveScene();
    const editorMeta = useComponentStore.getState().serialize();
    setSnapshot(JSON.stringify({ engineJson, editorMeta }));
    bridge.stopLoop();
    setPlaying(true);
  };

  const stop = () => {
    bridge.stopLoop();
    if (sceneSnapshot) {
      try {
        const snap = JSON.parse(sceneSnapshot);
        bridge.loadScene(snap.engineJson);
        useComponentStore.getState().deserialize(snap.editorMeta);
      } catch {
        bridge.loadScene(sceneSnapshot); // legacy: plain engine JSON
      }
      refresh();
    }
    setPlaying(false);
    setSnapshot(null);
    select(null);
  };

  return (
    <>
      {MODES.map(m => (
        <button
          key={m.key}
          style={btn(gizmoMode === m.key && !isPlaying)}
          onClick={() => setGizmoMode(m.key)}
          title={`${m.label} (${m.shortcut})`}
          disabled={isPlaying}
        >
          {m.label}
        </button>
      ))}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 6px' }} />
      {isPlaying
        ? <button style={btn(false)} onClick={stop}>■ Stop</button>
        : <button style={{ ...btn(false), color: '#4caf50' }} onClick={play}>▶ Play</button>
      }
    </>
  );
}
