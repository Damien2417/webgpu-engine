import React from 'react';
import { useEditorStore, type GizmoMode } from '../../store/editorStore';
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
  const { gizmoMode, setGizmoMode, isPlaying, setPlaying, setSnapshot, sceneSnapshot } = useEditorStore();
  const refresh = useSceneStore(s => s.refresh);

  const play = () => {
    setSnapshot(bridge.saveScene());
    setPlaying(true);
    bridge.startLoop(refresh);
  };

  const stop = () => {
    bridge.stopLoop();
    if (sceneSnapshot) { bridge.loadScene(sceneSnapshot); refresh(); }
    setPlaying(false);
    setSnapshot(null);
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
