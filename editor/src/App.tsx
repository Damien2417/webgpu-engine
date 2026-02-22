import React, { useEffect } from 'react';
import { useEditorStore } from './store/editorStore';
import MenuBar from './components/MenuBar/MenuBar';
import Toolbar from './components/Toolbar/Toolbar';
import SceneGraph from './components/SceneGraph/SceneGraph';
import Viewport from './components/Viewport/Viewport';
import Inspector from './components/Inspector/Inspector';
import AssetBrowser from './components/AssetBrowser/AssetBrowser';

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'grid',
    width: '100vw',
    height: '100vh',
    gridTemplateRows: '28px 36px 1fr 180px',
    gridTemplateColumns: '240px 1fr 280px',
    gridTemplateAreas: `
      "menubar  menubar  menubar"
      "toolbar  toolbar  toolbar"
      "scene    viewport inspector"
      "assets   assets   assets"
    `,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    fontSize: 'var(--font-size)',
    overflow: 'hidden',
  },
  menubar:   { gridArea: 'menubar',   background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16 },
  toolbar:   { gridArea: 'toolbar',   background: 'var(--bg-panel)',  borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 },
  scene:     { gridArea: 'scene',     background: 'var(--bg-panel)',  borderRight: '1px solid var(--border)', overflow: 'auto' },
  viewport:  { gridArea: 'viewport',  background: '#000', position: 'relative', overflow: 'hidden' },
  inspector: { gridArea: 'inspector', background: 'var(--bg-panel)',  borderLeft: '1px solid var(--border)', overflow: 'auto' },
  assets:    { gridArea: 'assets',    background: 'var(--bg-panel)',  borderTop: '1px solid var(--border)', overflow: 'auto' },
};

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

  return (
    <div style={styles.root}>
      <div style={styles.menubar}><MenuBar /></div>
      <div style={styles.toolbar}><Toolbar /></div>
      <div style={styles.scene}><SceneGraph /></div>
      <div style={styles.viewport}><Viewport /></div>
      <div style={styles.inspector}><Inspector /></div>
      <div style={styles.assets}><AssetBrowser /></div>
    </div>
  );
}
