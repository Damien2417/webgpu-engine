import React, { useEffect } from 'react';
import { useEditorStore } from './store/editorStore';
import MenuBar from './components/MenuBar/MenuBar';
import Toolbar from './components/Toolbar/Toolbar';
import SceneGraph from './components/SceneGraph/SceneGraph';
import Viewport from './components/Viewport/Viewport';
import Inspector from './components/Inspector/Inspector';
import AssetBrowser from './components/AssetBrowser/AssetBrowser';
import { saveSessionToLocalStorage, startAutoSessionSave } from './engine/sessionPersistence';

export default function App() {
  const { setGizmoMode, isPlaying } = useEditorStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPlaying || e.target instanceof HTMLInputElement) return;
      if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
      if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
      if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, setGizmoMode]);

  useEffect(() => {
    const onBeforeUnload = () => saveSessionToLocalStorage();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveSessionToLocalStorage();
    };
    const stopAutosave = startAutoSessionSave();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      stopAutosave();
    };
  }, []);

  return (
    <div className="editor-root">
      <div className="editor-slot editor-menubar"><MenuBar /></div>
      <div className="editor-slot editor-toolbar"><Toolbar /></div>
      <div className="editor-rail-left">
        <div className="editor-slot editor-scene"><SceneGraph /></div>
        <div className="editor-slot editor-assets"><AssetBrowser /></div>
      </div>
      <div className="editor-slot editor-viewport"><Viewport /></div>
      <div className="editor-slot editor-inspector"><Inspector /></div>
    </div>
  );
}
