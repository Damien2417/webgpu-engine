import React, { useEffect, useRef, useState } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';
import { useComponentStore } from '../../store/componentStore';
import { syncEditorComponentsToEngine } from '../../engine/syncEditorComponents';

export default function MenuBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useSceneStore(s => s.refresh);
  const select = useEditorStore(s => s.select);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('editor_theme');
    const shouldLight = stored === 'light';
    setIsLight(shouldLight);
    document.documentElement.setAttribute('data-theme', shouldLight ? 'light' : 'dark');
  }, []);

  const handleNew = () => {
    if (!confirm('New scene? Unsaved changes will be lost.')) return;
    bridge.loadScene('{"entities":[],"directional_light":null}');
    useComponentStore.getState().clearAll();
    select(null);
    refresh();
  };

  const handleSave = () => {
    const engineJson = bridge.saveScene();
    const editorMeta = useComponentStore.getState().serialize();
    const fullScene = JSON.stringify(
      { engineScene: JSON.parse(engineJson), editorMeta },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([fullScene], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'scene.json' }).click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const onSave = () => handleSave();
    document.addEventListener('editor:save', onSave);
    return () => document.removeEventListener('editor:save', onSave);
  }, []);

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        if (parsed.engineScene && parsed.editorMeta) {
          bridge.loadScene(JSON.stringify(parsed.engineScene));
          useComponentStore.getState().deserialize(parsed.editorMeta);
          syncEditorComponentsToEngine();
        } else {
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

  const toggleTheme = () => {
    const nextLight = !isLight;
    setIsLight(nextLight);
    localStorage.setItem('editor_theme', nextLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', nextLight ? 'light' : 'dark');
  };

  return (
    <div className="menu-bar">
      <span className="menu-brand">Nova Forge</span>
      <button className="ui-btn" onClick={handleNew}>New Scene</button>
      <button className="ui-btn" onClick={handleSave}>Save</button>
      <button className="ui-btn" onClick={() => fileRef.current?.click()}>Load</button>
      <div className="menu-spacer" />
      <button className="ui-btn" onClick={toggleTheme}>{isLight ? 'Dark Mode' : 'Light Mode'}</button>
      <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
    </div>
  );
}
