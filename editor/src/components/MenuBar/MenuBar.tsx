import React, { useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';
import { useComponentStore } from '../../store/componentStore';

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
    useComponentStore.getState().clearAll();
    select(null);
    refresh();
  };

  const handleSave = () => {
    const engineJson = bridge.saveScene();
    const editorMeta = useComponentStore.getState().serialize();
    const fullScene  = JSON.stringify(
      { engineScene: JSON.parse(engineJson), editorMeta },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([fullScene], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'scene.json' }).click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        if (parsed.engineScene && parsed.editorMeta) {
          // Extended format: engine scene + editor metadata
          bridge.loadScene(JSON.stringify(parsed.engineScene));
          useComponentStore.getState().deserialize(parsed.editorMeta);
        } else {
          // Legacy format: raw engine scene JSON
          bridge.loadScene(text);
        }
      } catch {
        bridge.loadScene(text);
      }
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
