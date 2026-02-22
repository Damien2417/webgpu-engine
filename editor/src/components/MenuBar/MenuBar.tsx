import React, { useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text)',
  padding: '2px 10px', cursor: 'pointer', fontSize: 12, borderRadius: 3,
};

export default function MenuBar() {
  const fileRef  = useRef<HTMLInputElement>(null);
  const refresh  = useSceneStore(s => s.refresh);
  const select   = useEditorStore(s => s.select);

  const handleNew = () => {
    if (!confirm('Nouvelle scène ? Les modifications non sauvegardées seront perdues.')) return;
    bridge.loadScene('{"entities":[],"directional_light":null}');
    select(null);
    refresh();
  };

  const handleSave = () => {
    const json = bridge.saveScene();
    const url  = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'scene.json' }).click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      bridge.loadScene(ev.target?.result as string);
      select(null);
      refresh();
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <>
      <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13, letterSpacing: 1, marginRight: 8 }}>
        WebUnity
      </span>
      <button style={btnStyle} onClick={handleNew}>New</button>
      <button style={btnStyle} onClick={handleSave}>Save</button>
      <button style={btnStyle} onClick={() => fileRef.current?.click()}>Load</button>
      <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
    </>
  );
}
