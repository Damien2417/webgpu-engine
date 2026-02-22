# WebUnity Editor Implementation Plan (Phase 7)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Créer un éditeur web complet style Unity dans `editor/` — viewport WebGPU, scene graph, inspector, gizmos, asset browser, play/stop.

**Architecture:** App React 18 + Zustand dans `editor/` (Vite standalone), partageant `engine-core/pkg/` WASM avec game-app. Le WASM nécessite 6 nouvelles fonctions API exposées via wasm_bindgen avant le scaffolding React. Les gizmos utilisent un overlay `<canvas 2D>` positionné en `position:absolute` sur le canvas WebGPU.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, vite-plugin-wasm, engine-core WASM (Rust/glam)

---

## Task 1: Ajouter l'API éditeur à engine-core

**Contexte :** L'éditeur a besoin de lire l'état du monde WASM (liste d'entités, transforms, matrices caméra). Ces fonctions n'existent pas encore dans `engine-core/src/lib.rs`.

**Files:**
- Modify: `engine-core/src/lib.rs` — ajouter `entity_names` dans World + 6 nouvelles méthodes

**Step 1: Ajouter `entity_names` dans la struct World**

Dans `engine-core/src/lib.rs`, ligne 148 (après `persistent_entities: HashSet<usize>`), ajouter :

```rust
    entity_names: HashMap<String, usize>,  // FAUX — on veut id→name
```

**Correction** — utiliser `HashMap<usize, String>` pour mapper id → nom :

Trouver la struct World (ligne ~95) et ajouter **après** `persistent_entities: HashSet<usize>,` :

```rust
    entity_names: HashMap<usize, String>,
```

**Step 2: Initialiser `entity_names` dans `World::new`**

Dans `World::new` (ligne ~691), ajouter dans le struct literal de retour, après `texture_registry: HashMap::new(),` :

```rust
            entity_names:        HashMap::new(),
```

**Step 3: Ajouter les 6 méthodes dans le bloc `#[wasm_bindgen] impl World` (ligne ~696)**

Insérer après `pub fn create_entity` (ligne ~701) :

```rust
    /// Retourne le nom de l'entité (défaut: "Entity {id}").
    pub fn get_entity_name(&self, id: usize) -> String {
        self.entity_names
            .get(&id)
            .cloned()
            .unwrap_or_else(|| format!("Entity {}", id))
    }

    /// Définit le nom d'une entité.
    pub fn set_entity_name(&mut self, id: usize, name: String) {
        self.entity_names.insert(id, name);
    }

    /// Supprime une entité et tous ses composants.
    pub fn remove_entity(&mut self, id: usize) {
        self.transforms.remove(id);
        self.mesh_renderers.remove(id);
        self.materials.remove(id);
        self.rigid_bodies.remove(id);
        self.colliders.remove(id);
        self.point_lights.remove(id);
        self.entity_gpus.remove(id);
        self.entity_names.remove(&id);
        self.persistent_entities.remove(&id);
    }

    /// Liste les IDs de toutes les entités qui ont un Transform.
    pub fn get_entity_ids(&self) -> js_sys::Uint32Array {
        let ids: Vec<u32> = self.transforms
            .iter_ids()
            .map(|id| id as u32)
            .collect();
        js_sys::Uint32Array::from(ids.as_slice())
    }

    /// Retourne [px, py, pz, rx, ry, rz, sx, sy, sz] pour l'entité.
    /// Retourne 9 zéros si l'entité n'a pas de Transform.
    pub fn get_transform_array(&self, id: usize) -> js_sys::Float32Array {
        if let Some(t) = self.transforms.get(id) {
            let data = [
                t.position.x, t.position.y, t.position.z,
                t.rotation.x, t.rotation.y, t.rotation.z,
                t.scale.x,    t.scale.y,    t.scale.z,
            ];
            js_sys::Float32Array::from(data.as_slice())
        } else {
            js_sys::Float32Array::from([0f32; 9].as_slice())
        }
    }

    /// Retourne la matrice view*proj [16 f32, column-major] pour les gizmos.
    /// glam::as_cols_array() : [col0.xyzw, col1.xyzw, col2.xyzw, col3.xyzw]
    pub fn get_view_proj(&self) -> js_sys::Float32Array {
        let aspect = self.config.width as f32 / self.config.height as f32;
        let vp = self.camera.proj_matrix(aspect) * self.camera.view_matrix();
        js_sys::Float32Array::from(vp.to_cols_array().as_slice())
    }
```

**Step 4: Vérifier que SparseSet expose `iter_ids()`**

Ouvrir `engine-core/src/ecs/sparse_set.rs`. Chercher une méthode `iter_ids` ou équivalent. Si elle n'existe pas, l'ajouter :

```rust
pub fn iter_ids(&self) -> impl Iterator<Item = usize> + '_ {
    self.sparse.iter().enumerate()
        .filter_map(|(id, &slot)| {
            if slot != usize::MAX { Some(id) } else { None }
        })
}
```

Adapter selon l'implémentation existante de SparseSet.

**Step 5: Rebuilder le WASM**

Dans `engine-core/` :

```bash
cd engine-core
wasm-pack build --target web --out-dir pkg
```

Vérifier la sortie : `[INFO]: ✨ Your wasm pkg is ready to publish at ./pkg` — aucune erreur Rust.

**Step 6: Commit**

```bash
git add engine-core/src/lib.rs engine-core/src/ecs/sparse_set.rs engine-core/pkg/
git commit -m "feat(engine): API éditeur — get_entity_ids, get_transform_array, get_view_proj, remove_entity, entity_names"
```

---

## Task 2: Scaffolding `editor/`

**Contexte :** Créer le projet Vite + React + TypeScript dans `editor/`. Copier la config Vite de `game-app/` (même setup WASM).

**Files:**
- Create: `editor/package.json`
- Create: `editor/vite.config.ts`
- Create: `editor/tsconfig.json`
- Create: `editor/index.html`
- Create: `editor/src/main.tsx`
- Create: `editor/src/App.tsx`

**Step 1: Créer `editor/package.json`**

```json
{
  "name": "webunity-editor",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.3"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "typescript": "~5.9.3",
    "vite": "^7.3.1",
    "vite-plugin-top-level-await": "^1.6.0",
    "vite-plugin-wasm": "^3.5.0"
  }
}
```

**Step 2: Créer `editor/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: { exclude: ['engine-core'] },
  server: { fs: { allow: ['..'] } },
});
```

**Note :** `@vitejs/plugin-react` n'est pas dans les devDependencies ci-dessus — l'ajouter :
```json
"@vitejs/plugin-react": "^4.4.1"
```

**Step 3: Créer `editor/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

**Step 4: Créer `editor/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebUnity Editor</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; overflow: hidden; }
      body { background: #1e1e1e; color: #d4d4d4; font-family: 'Segoe UI', sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Créer `editor/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 6: Créer `editor/src/App.tsx` (placeholder)**

```tsx
export default function App() {
  return <div style={{ color: 'white', padding: 20 }}>WebUnity Editor — loading…</div>;
}
```

**Step 7: Installer les dépendances**

```bash
cd editor
npm install
```

**Step 8: Vérifier que Vite démarre**

```bash
npm run dev
```

Ouvrir `http://localhost:5173`. Attendu : page blanche avec "WebUnity Editor — loading…"

**Step 9: Commit**

```bash
git add editor/
git commit -m "feat(editor): scaffolding Vite + React + TypeScript + Zustand"
```

---

## Task 3: Layout CSS Grid 4-panneaux + thème dark

**Contexte :** Mettre en place le layout Unity-style avec CSS Grid : MenuBar (top), Toolbar (top-center), SceneGraph (left), Viewport (center), Inspector (right), AssetBrowser (bottom).

**Files:**
- Create: `editor/src/styles/theme.css`
- Modify: `editor/src/App.tsx`
- Create: `editor/src/components/MenuBar/MenuBar.tsx` (placeholder)
- Create: `editor/src/components/Toolbar/Toolbar.tsx` (placeholder)
- Create: `editor/src/components/SceneGraph/SceneGraph.tsx` (placeholder)
- Create: `editor/src/components/Viewport/Viewport.tsx` (placeholder)
- Create: `editor/src/components/Inspector/Inspector.tsx` (placeholder)
- Create: `editor/src/components/AssetBrowser/AssetBrowser.tsx` (placeholder)

**Step 1: Créer `editor/src/styles/theme.css`**

```css
:root {
  --bg-deep:    #1e1e1e;
  --bg-panel:   #252526;
  --bg-header:  #2d2d30;
  --bg-hover:   #3e3e42;
  --bg-select:  #094771;
  --border:     #3f3f46;
  --text:       #cccccc;
  --text-dim:   #858585;
  --accent:     #4fc3f7;
  --accent-dim: #0288d1;
  --red:        #f44747;
  --green:      #4ec9b0;
  --blue:       #569cd6;
  --yellow:     #dcdcaa;
  --font-size:  12px;
  --font-mono:  'Consolas', monospace;
}
```

**Step 2: Importer le thème dans `editor/src/main.tsx`**

Ajouter en haut du fichier, avant le render :
```tsx
import './styles/theme.css';
```

**Step 3: Créer les composants placeholder**

Créer chacun de ces fichiers avec un composant minimal (nom affiché) :

`editor/src/components/MenuBar/MenuBar.tsx` :
```tsx
export default function MenuBar() {
  return <div className="menubar">File Edit</div>;
}
```

`editor/src/components/Toolbar/Toolbar.tsx` :
```tsx
export default function Toolbar() {
  return <div className="toolbar">Toolbar</div>;
}
```

`editor/src/components/SceneGraph/SceneGraph.tsx` :
```tsx
export default function SceneGraph() {
  return <div className="panel">Scene Graph</div>;
}
```

`editor/src/components/Viewport/Viewport.tsx` :
```tsx
export default function Viewport() {
  return <div className="panel" style={{ background: '#000' }}>Viewport</div>;
}
```

`editor/src/components/Inspector/Inspector.tsx` :
```tsx
export default function Inspector() {
  return <div className="panel">Inspector</div>;
}
```

`editor/src/components/AssetBrowser/AssetBrowser.tsx` :
```tsx
export default function AssetBrowser() {
  return <div className="panel">Asset Browser</div>;
}
```

**Step 4: Implémenter le layout CSS Grid dans `editor/src/App.tsx`**

```tsx
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
  menubar:   { gridArea: 'menubar',  background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 8px', gap: 16 },
  toolbar:   { gridArea: 'toolbar',  background: 'var(--bg-panel)',  borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 },
  scene:     { gridArea: 'scene',    background: 'var(--bg-panel)',  borderRight: '1px solid var(--border)', overflow: 'auto' },
  viewport:  { gridArea: 'viewport', background: '#000', position: 'relative', overflow: 'hidden' },
  inspector: { gridArea: 'inspector', background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)', overflow: 'auto' },
  assets:    { gridArea: 'assets',   background: 'var(--bg-panel)',  borderTop: '1px solid var(--border)', overflow: 'auto' },
};

export default function App() {
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
```

**Step 5: Vérifier dans le browser**

```bash
npm run dev
```

Attendu : layout 4-panneaux visible, fond sombre, panneaux distincts.

**Step 6: Commit**

```bash
git add editor/
git commit -m "feat(editor): layout CSS Grid 4-panneaux + thème dark Unity"
```

---

## Task 4: Engine types + Bridge

**Contexte :** Créer le singleton `engineBridge` qui initialise le WASM et expose une API TypeScript propre pour le reste de l'éditeur.

**Files:**
- Create: `editor/src/engine/types.ts`
- Create: `editor/src/engine/engineBridge.ts`

**Step 1: Créer `editor/src/engine/types.ts`**

```typescript
export type EntityId = number;

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number]; // euler degrés
  scale:    [number, number, number];
}

export interface EntityData {
  id:        EntityId;
  name:      string;
  transform: Transform;
  hasMesh:   boolean;
}
```

**Step 2: Créer `editor/src/engine/engineBridge.ts`**

```typescript
import init, { World } from '../../../engine-core/pkg/engine_core.js';
import type { EntityId, Transform } from './types';

class EngineBridge {
  private world: World | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private _isPlaying = false;

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    await init();
    this.canvas = canvas;
    this.world = await World.new(canvas);
  }

  get isReady(): boolean { return this.world !== null; }
  get isPlaying(): boolean { return this._isPlaying; }

  // ── Entités ────────────────────────────────────────────────────────────────

  createEntity(name?: string): EntityId {
    if (!this.world) throw new Error('Bridge not initialized');
    const id = this.world.create_entity();
    this.world.add_transform(id, 0, 0, 0);
    if (name) this.world.set_entity_name(id, name);
    return id;
  }

  removeEntity(id: EntityId): void {
    this.world?.remove_entity(id);
  }

  getEntityIds(): EntityId[] {
    if (!this.world) return [];
    return Array.from(this.world.get_entity_ids());
  }

  getEntityName(id: EntityId): string {
    return this.world?.get_entity_name(id) ?? `Entity ${id}`;
  }

  setEntityName(id: EntityId, name: string): void {
    this.world?.set_entity_name(id, name);
  }

  addMeshRenderer(id: EntityId): void {
    this.world?.add_mesh_renderer(id);
  }

  // ── Transform ──────────────────────────────────────────────────────────────

  getTransform(id: EntityId): Transform {
    if (!this.world) return { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] };
    const a = this.world.get_transform_array(id);
    return {
      position: [a[0], a[1], a[2]],
      rotation: [a[3], a[4], a[5]],
      scale:    [a[6], a[7], a[8]],
    };
  }

  setPosition(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_position(id, x, y, z);
  }

  setRotation(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_rotation(id, x, y, z);
  }

  setScale(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_scale(id, x, y, z);
  }

  // ── Caméra ─────────────────────────────────────────────────────────────────

  setCamera(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): void {
    this.world?.set_camera(ex, ey, ez, tx, ty, tz);
  }

  getViewProj(): Float32Array {
    if (!this.world) return new Float32Array(16);
    return this.world.get_view_proj();
  }

  // ── Scène ──────────────────────────────────────────────────────────────────

  saveScene(): string {
    return this.world?.save_scene() ?? '{}';
  }

  loadScene(json: string): void {
    this.world?.load_scene(json);
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  startLoop(onFrame?: () => void): void {
    const loop = () => {
      this.world?.render_frame(16.67);
      onFrame?.();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// Singleton
export const bridge = new EngineBridge();
```

**Step 3: Commit**

```bash
git add editor/src/engine/
git commit -m "feat(editor): engine bridge + types TypeScript"
```

---

## Task 5: Zustand stores

**Files:**
- Create: `editor/src/store/editorStore.ts`
- Create: `editor/src/store/sceneStore.ts`

**Step 1: Créer `editor/src/store/editorStore.ts`**

```typescript
import { create } from 'zustand';
import type { EntityId } from '../engine/types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

interface EditorState {
  selectedId:    EntityId | null;
  gizmoMode:     GizmoMode;
  isPlaying:     boolean;
  sceneSnapshot: string | null;

  select:        (id: EntityId | null) => void;
  setGizmoMode:  (mode: GizmoMode) => void;
  setPlaying:    (v: boolean) => void;
  setSnapshot:   (json: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedId:    null,
  gizmoMode:     'translate',
  isPlaying:     false,
  sceneSnapshot: null,

  select:       (id)   => set({ selectedId: id }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setPlaying:   (v)    => set({ isPlaying: v }),
  setSnapshot:  (json) => set({ sceneSnapshot: json }),
}));
```

**Step 2: Créer `editor/src/store/sceneStore.ts`**

```typescript
import { create } from 'zustand';
import { bridge } from '../engine/engineBridge';
import type { EntityId, EntityData } from '../engine/types';

interface SceneState {
  entities: EntityData[];

  refresh:       () => void;
  addEntity:     (name?: string) => EntityId;
  removeEntity:  (id: EntityId) => void;
  updatePosition:(id: EntityId, x: number, y: number, z: number) => void;
  updateRotation:(id: EntityId, x: number, y: number, z: number) => void;
  updateScale:   (id: EntityId, x: number, y: number, z: number) => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  entities: [],

  refresh: () => {
    const ids = bridge.getEntityIds();
    const entities: EntityData[] = ids.map(id => ({
      id,
      name:      bridge.getEntityName(id),
      transform: bridge.getTransform(id),
      hasMesh:   true, // simplifié — toujours vrai pour l'instant
    }));
    set({ entities });
  },

  addEntity: (name) => {
    const id = bridge.createEntity(name ?? `Entity ${bridge.getEntityIds().length}`);
    bridge.addMeshRenderer(id);
    get().refresh();
    return id;
  },

  removeEntity: (id) => {
    bridge.removeEntity(id);
    get().refresh();
  },

  updatePosition: (id, x, y, z) => {
    bridge.setPosition(id, x, y, z);
    get().refresh();
  },

  updateRotation: (id, x, y, z) => {
    bridge.setRotation(id, x, y, z);
    get().refresh();
  },

  updateScale: (id, x, y, z) => {
    bridge.setScale(id, x, y, z);
    get().refresh();
  },
}));
```

**Step 3: Commit**

```bash
git add editor/src/store/
git commit -m "feat(editor): Zustand stores — editorStore + sceneStore"
```

---

## Task 6: Viewport — canvas WebGPU + caméra orbitale

**Contexte :** Le viewport initialise le bridge WASM, lance la render loop et gère une caméra orbitale (drag souris = orbite autour de la cible).

**Files:**
- Modify: `editor/src/components/Viewport/Viewport.tsx`

**Step 1: Implémenter `Viewport.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';

// Caméra orbitale : distance, azimuth (rad), elevation (rad), target
const orbit = { distance: 8, azimuth: 0.5, elevation: 0.4, tx: 0, ty: 0, tz: 0 };

function orbitToEye() {
  const { distance, azimuth, elevation, tx, ty, tz } = orbit;
  const x = tx + distance * Math.cos(elevation) * Math.sin(azimuth);
  const y = ty + distance * Math.sin(elevation);
  const z = tz + distance * Math.cos(elevation) * Math.cos(azimuth);
  return { x, y, z };
}

export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const refresh   = useSceneStore(s => s.refresh);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    // Taille initiale
    const resize = () => {
      const parent = canvas.parentElement!;
      canvas.width  = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();

    (async () => {
      await bridge.initialize(canvas);
      applyCamera();
      refresh();
      bridge.startLoop(refresh);
    })();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => { bridge.stopLoop(); ro.disconnect(); };
  }, []);

  function applyCamera() {
    const e = orbitToEye();
    bridge.setCamera(e.x, e.y, e.z, orbit.tx, orbit.ty, orbit.tz);
  }

  // Drag souris = orbite
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0, lastY = 0;

    const onDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onUp   = () => { dragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      orbit.azimuth   -= dx * 0.005;
      orbit.elevation  = Math.max(-1.5, Math.min(1.5, orbit.elevation + dy * 0.005));
      applyCamera();
    };
    const onWheel = (e: WheelEvent) => {
      orbit.distance = Math.max(1, orbit.distance + e.deltaY * 0.01);
      applyCamera();
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative', cursor: 'grab' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
```

**Step 2: Vérifier dans le browser**

`npm run dev` — le viewport doit afficher un canvas WebGPU noir (scène vide). Drag souris = orbite. Scroll = zoom.

**Step 3: Commit**

```bash
git add editor/src/components/Viewport/
git commit -m "feat(editor): Viewport WebGPU + caméra orbitale (drag/scroll)"
```

---

## Task 7: Scene Graph

**Files:**
- Modify: `editor/src/components/SceneGraph/SceneGraph.tsx`

**Step 1: Implémenter `SceneGraph.tsx`**

```tsx
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';

const s: Record<string, React.CSSProperties> = {
  root:   { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { padding: '6px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 },
  list:   { flex: 1, overflow: 'auto' },
  item:   { padding: '3px 8px 3px 20px', cursor: 'pointer', userSelect: 'none' },
  addBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 6px', fontSize: 'var(--font-size)' },
};

export default function SceneGraph() {
  const entities   = useSceneStore(s => s.entities);
  const addEntity  = useSceneStore(s => s.addEntity);
  const removeEntity = useSceneStore(s => s.removeEntity);
  const selectedId = useEditorStore(s => s.selectedId);
  const select     = useEditorStore(s => s.select);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Scene</span>
        <button style={s.addBtn} onClick={() => { const id = addEntity(); select(id); }}>+ Add</button>
      </div>
      <div style={s.list}>
        {entities.map(e => (
          <div
            key={e.id}
            style={{ ...s.item, background: e.id === selectedId ? 'var(--bg-select)' : 'transparent' }}
            onClick={() => select(e.id)}
            onContextMenu={(ev) => { ev.preventDefault(); removeEntity(e.id); if (selectedId === e.id) select(null); }}
          >
            ▸ {e.name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Note :** Clic droit sur une entité = supprimer (contextmenu). Améliorer avec un vrai menu contextuel plus tard.

**Step 2: Vérifier**

Cliquer "Add" → une entité "Entity 0" apparaît dans la liste. Cliquer l'entité = la sélectionne (fond bleu). Clic droit = suppression.

**Step 3: Commit**

```bash
git add editor/src/components/SceneGraph/
git commit -m "feat(editor): SceneGraph — liste entités, sélection, add/remove"
```

---

## Task 8: Inspector — TransformPanel

**Files:**
- Modify: `editor/src/components/Inspector/Inspector.tsx`
- Create: `editor/src/components/Inspector/TransformPanel.tsx`
- Create: `editor/src/components/Inspector/Vec3Input.tsx`

**Step 1: Créer `editor/src/components/Inspector/Vec3Input.tsx`**

Composant réutilisable : 3 inputs numériques avec label XYZ.

```tsx
interface Vec3InputProps {
  label:    string;
  value:    [number, number, number];
  onChange: (x: number, y: number, z: number) => void;
  step?:    number;
}

const s: Record<string, React.CSSProperties> = {
  row:   { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 },
  label: { width: 70, color: 'var(--text-dim)', flexShrink: 0 },
  field: { display: 'flex', gap: 2, flex: 1 },
  input: {
    flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '2px 4px', borderRadius: 2, fontSize: 11,
    width: 0, // laisse flex contrôler la largeur
  },
};

const AXIS = ['X', 'Y', 'Z'] as const;

export default function Vec3Input({ label, value, onChange, step = 0.1 }: Vec3InputProps) {
  const handle = (axis: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value) || 0;
    const next: [number, number, number] = [...value] as [number, number, number];
    next[axis] = v;
    onChange(next[0], next[1], next[2]);
  };

  return (
    <div style={s.row}>
      <span style={s.label}>{label}</span>
      <div style={s.field}>
        {[0, 1, 2].map(i => (
          <input
            key={i}
            type="number"
            step={step}
            value={parseFloat(value[i].toFixed(3))}
            onChange={handle(i)}
            style={{ ...s.input, borderColor: i === 0 ? '#e74c3c' : i === 1 ? '#2ecc71' : '#3498db' }}
            title={AXIS[i]}
          />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Créer `editor/src/components/Inspector/TransformPanel.tsx`**

```tsx
import Vec3Input from './Vec3Input';
import { useSceneStore } from '../../store/sceneStore';
import type { EntityId } from '../../engine/types';

const s: Record<string, React.CSSProperties> = {
  section: { padding: '8px 10px', borderBottom: '1px solid var(--border)' },
  title:   { fontWeight: 600, color: 'var(--accent)', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' },
};

export default function TransformPanel({ entityId }: { entityId: EntityId }) {
  const entity          = useSceneStore(s => s.entities.find(e => e.id === entityId));
  const updatePosition  = useSceneStore(s => s.updatePosition);
  const updateRotation  = useSceneStore(s => s.updateRotation);
  const updateScale     = useSceneStore(s => s.updateScale);

  if (!entity) return null;
  const { position, rotation, scale } = entity.transform;

  return (
    <div style={s.section}>
      <div style={s.title}>Transform</div>
      <Vec3Input label="Position" value={position} onChange={(x,y,z) => updatePosition(entityId, x, y, z)} />
      <Vec3Input label="Rotation" value={rotation} onChange={(x,y,z) => updateRotation(entityId, x, y, z)} step={1} />
      <Vec3Input label="Scale"    value={scale}    onChange={(x,y,z) => updateScale(entityId, x, y, z)}    />
    </div>
  );
}
```

**Step 3: Modifier `Inspector.tsx`**

```tsx
import { useEditorStore } from '../../store/editorStore';
import TransformPanel from './TransformPanel';

const s: React.CSSProperties = { height: '100%', overflowY: 'auto' };

const header: React.CSSProperties = {
  padding: '6px 8px', background: 'var(--bg-header)',
  borderBottom: '1px solid var(--border)', fontWeight: 600,
};

export default function Inspector() {
  const selectedId = useEditorStore(s => s.selectedId);

  return (
    <div style={s}>
      <div style={header}>Inspector</div>
      {selectedId !== null
        ? <TransformPanel entityId={selectedId} />
        : <div style={{ padding: 12, color: 'var(--text-dim)' }}>No entity selected</div>
      }
    </div>
  );
}
```

**Step 4: Vérifier**

Ajouter une entité, la sélectionner → l'inspector affiche 3 champs Position/Rotation/Scale. Modifier la position → le cube se déplace dans le viewport.

**Step 5: Commit**

```bash
git add editor/src/components/Inspector/
git commit -m "feat(editor): Inspector TransformPanel — inputs position/rotation/scale liés au WASM"
```

---

## Task 9: Toolbar — Play/Stop + Gizmo mode

**Files:**
- Modify: `editor/src/components/Toolbar/Toolbar.tsx`

**Step 1: Implémenter `Toolbar.tsx`**

```tsx
import { useEditorStore, type GizmoMode } from '../../store/editorStore';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';

const btn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--bg-select)' : 'var(--bg-hover)',
  border: '1px solid var(--border)',
  color: active ? 'var(--accent)' : 'var(--text)',
  borderRadius: 3, padding: '3px 10px', cursor: 'pointer',
  fontSize: 'var(--font-size)',
});

const sep: React.CSSProperties = {
  width: 1, height: 20, background: 'var(--border)', margin: '0 6px',
};

export default function Toolbar() {
  const { gizmoMode, setGizmoMode, isPlaying, setPlaying, setSnapshot, sceneSnapshot } = useEditorStore();
  const refresh = useSceneStore(s => s.refresh);

  const play = () => {
    const snap = bridge.saveScene();
    setSnapshot(snap);
    setPlaying(true);
    bridge.startLoop(refresh);
  };

  const stop = () => {
    bridge.stopLoop();
    if (sceneSnapshot) {
      bridge.loadScene(sceneSnapshot);
      refresh();
    }
    setPlaying(false);
    setSnapshot(null);
  };

  const MODES: { key: GizmoMode; label: string; shortcut: string }[] = [
    { key: 'translate', label: '↔ Move',   shortcut: 'W' },
    { key: 'rotate',    label: '↻ Rotate', shortcut: 'E' },
    { key: 'scale',     label: '⤡ Scale',  shortcut: 'R' },
  ];

  return (
    <>
      {MODES.map(m => (
        <button key={m.key} style={btn(gizmoMode === m.key && !isPlaying)} onClick={() => setGizmoMode(m.key)} title={`${m.label} (${m.shortcut})`} disabled={isPlaying}>
          {m.label}
        </button>
      ))}
      <div style={sep} />
      {isPlaying
        ? <button style={btn(false)} onClick={stop} title="Stop (retour Edit)">■ Stop</button>
        : <button style={{ ...btn(false), color: '#4caf50' }} onClick={play} title="Play">▶ Play</button>
      }
    </>
  );
}
```

**Step 2: Ajouter keyboard shortcuts dans `App.tsx`**

Dans le composant `App`, ajouter un `useEffect` global :

```tsx
import { useEffect } from 'react';
import { useEditorStore } from './store/editorStore';

// Dans App():
const { setGizmoMode, isPlaying } = useEditorStore();
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (isPlaying) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
    if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
    if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [isPlaying]);
```

**Step 3: Vérifier**

Boutons de mode actifs, ▶ Play lance la loop, ■ Stop restaure la scène.

**Step 4: Commit**

```bash
git add editor/src/components/Toolbar/ editor/src/App.tsx
git commit -m "feat(editor): Toolbar Play/Stop + modes gizmo + keyboard W/E/R"
```

---

## Task 10: Gizmo overlay — Translate (W)

**Contexte :** Overlay `<canvas 2D>` positionné en `position:absolute` sur le viewport. Projecte la position 3D de l'entité sélectionnée en 2D et dessine 3 flèches XYZ. Drag sur une flèche → translate l'entité.

**Files:**
- Create: `editor/src/components/Viewport/GizmoOverlay.tsx`
- Create: `editor/src/utils/gizmo.ts`
- Modify: `editor/src/components/Viewport/Viewport.tsx`

**Step 1: Créer `editor/src/utils/gizmo.ts`**

```typescript
// Projection d'un point 3D vers screen space.
// viewProj : Float32Array[16] column-major (glam as_cols_array)
// v_clip = viewProj * [x, y, z, 1]  (colonne-vecteur, multiplication à gauche)
// vp[i] = colonne i/4, ligne i%4
export function project(
  worldPos: [number, number, number],
  viewProj: Float32Array,
  width: number,
  height: number
): [number, number] | null {
  const [x, y, z] = worldPos;
  // clip_x = col0.x*x + col1.x*y + col2.x*z + col3.x
  const cx = viewProj[0]*x + viewProj[4]*y + viewProj[8]*z  + viewProj[12];
  const cy = viewProj[1]*x + viewProj[5]*y + viewProj[9]*z  + viewProj[13];
  const cw = viewProj[3]*x + viewProj[7]*y + viewProj[11]*z + viewProj[15];
  if (Math.abs(cw) < 1e-6) return null;
  const ndcX =  cx / cw;
  const ndcY =  cy / cw;
  if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) return null;
  return [
    (ndcX + 1) * 0.5 * width,
    (1 - ndcY) * 0.5 * height,
  ];
}

// Longueur en pixels des flèches gizmo
export const GIZMO_LENGTH = 80;

// Couleurs des axes XYZ
export const AXIS_COLORS = ['#e74c3c', '#2ecc71', '#3498db'] as const;

// Directions des axes monde
export const AXIS_DIRS: [number, number, number][] = [
  [1, 0, 0], // X
  [0, 1, 0], // Y
  [0, 0, 1], // Z
];
```

**Step 2: Créer `editor/src/components/Viewport/GizmoOverlay.tsx`**

```tsx
import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { bridge } from '../../engine/engineBridge';
import { project, GIZMO_LENGTH, AXIS_COLORS, AXIS_DIRS } from '../../utils/gizmo';

const HANDLE_RADIUS = 6;

export default function GizmoOverlay({ width, height }: { width: number; height: number }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const dragAxis    = useRef<number | null>(null);
  const dragStart   = useRef<[number, number]>([0, 0]);

  const selectedId  = useEditorStore(s => s.selectedId);
  const gizmoMode   = useEditorStore(s => s.gizmoMode);
  const isPlaying   = useEditorStore(s => s.isPlaying);
  const entity      = useSceneStore(s => s.entities.find(e => e.id === selectedId));
  const updatePos   = useSceneStore(s => s.updatePosition);

  const getEndpoints = useCallback(() => {
    if (!entity || gizmoMode !== 'translate') return null;
    const vp = bridge.getViewProj();
    const origin = project(entity.transform.position, vp, width, height);
    if (!origin) return null;

    const tips = AXIS_DIRS.map(dir => {
      const scale = entity.transform.scale;
      const worldTip: [number, number, number] = [
        entity.transform.position[0] + dir[0],
        entity.transform.position[1] + dir[1],
        entity.transform.position[2] + dir[2],
      ];
      return project(worldTip, vp, width, height);
    });
    return { origin, tips };
  }, [entity, gizmoMode, width, height]);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (!entity || isPlaying || gizmoMode !== 'translate') return;

    const ends = getEndpoints();
    if (!ends) return;
    const { origin, tips } = ends;

    tips.forEach((tip, i) => {
      if (!tip) return;
      // Flèche
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(tip[0], tip[1]);
      ctx.strokeStyle = AXIS_COLORS[i];
      ctx.lineWidth = 2;
      ctx.stroke();
      // Handle
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = AXIS_COLORS[i];
      ctx.fill();
    });

    // Origine
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }, [entity, gizmoMode, isPlaying, width, height, getEndpoints]);

  // Drag handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entity || gizmoMode !== 'translate') return;

    const onDown = (e: MouseEvent) => {
      const ends = getEndpoints();
      if (!ends) return;
      const mx = e.offsetX, my = e.offsetY;
      ends.tips.forEach((tip, i) => {
        if (!tip) return;
        const dx = mx - tip[0], dy = my - tip[1];
        if (Math.sqrt(dx*dx + dy*dy) < HANDLE_RADIUS + 4) {
          dragAxis.current = i;
          dragStart.current = [e.clientX, e.clientY];
          e.stopPropagation();
        }
      });
    };

    const onMove = (e: MouseEvent) => {
      const axis = dragAxis.current;
      if (axis === null || !entity) return;
      const dx = e.clientX - dragStart.current[0];
      const dy = e.clientY - dragStart.current[1];
      dragStart.current = [e.clientX, e.clientY];
      const delta = (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * 0.02;
      const [px, py, pz] = entity.transform.position;
      updatePos(
        entity.id,
        px + (axis === 0 ? delta : 0),
        py + (axis === 1 ? delta : 0),
        pz + (axis === 2 ? delta : 0),
      );
    };

    const onUp = () => { dragAxis.current = null; };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [entity, gizmoMode, getEndpoints, updatePos]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute', top: 0, left: 0,
        pointerEvents: isPlaying ? 'none' : 'auto',
        cursor: dragAxis.current !== null ? 'grabbing' : 'default',
      }}
    />
  );
}
```

**Step 3: Modifier `Viewport.tsx` pour inclure l'overlay**

Dans le return de `Viewport`, ajouter GizmoOverlay dans le `<div>` wrapper :

```tsx
import GizmoOverlay from './GizmoOverlay';
import { useState } from 'react';

// Dans Viewport(), ajouter state pour dimensions :
const [dims, setDims] = useState({ w: 0, h: 0 });

// Dans le ResizeObserver callback, ajouter :
setDims({ w: parent.clientWidth, h: parent.clientHeight });

// Dans le return :
<div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative', cursor: 'grab' }}>
  <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
  <GizmoOverlay width={dims.w} height={dims.h} />
</div>
```

**Step 4: Vérifier**

Ajouter une entité, la sélectionner, mode Translate (W) → 3 flèches XYZ apparaissent sur l'entité. Drag sur une flèche → l'entité se déplace sur cet axe.

**Step 5: Commit**

```bash
git add editor/src/components/Viewport/ editor/src/utils/
git commit -m "feat(editor): gizmo overlay translate — flèches XYZ drag sur entité sélectionnée"
```

---

## Task 11: MenuBar — File (New / Save / Load)

**Files:**
- Modify: `editor/src/components/MenuBar/MenuBar.tsx`

**Step 1: Implémenter `MenuBar.tsx`**

```tsx
import { useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';

const s: Record<string, React.CSSProperties> = {
  root:  { display: 'flex', alignItems: 'center', gap: 2 },
  menu:  { position: 'relative' },
  btn:   { background: 'none', border: 'none', color: 'var(--text)', padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-size)', borderRadius: 3 },
  title: { marginLeft: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: 1, fontSize: 13 },
};

export default function MenuBar() {
  const fileRef   = useRef<HTMLInputElement>(null);
  const refresh   = useSceneStore(s => s.refresh);
  const select    = useEditorStore(s => s.select);

  const handleNew = () => {
    if (!confirm('Nouvelle scène ? Les modifications non sauvegardées seront perdues.')) return;
    bridge.loadScene('{"entities":[],"directional_light":null}');
    select(null);
    refresh();
  };

  const handleSave = () => {
    const json = bridge.saveScene();
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'scene.json' });
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const json = ev.target?.result as string;
      bridge.loadScene(json);
      select(null);
      refresh();
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={s.root}>
      <span style={s.title}>WebUnity</span>
      <button style={s.btn} onClick={handleNew}>New</button>
      <button style={s.btn} onClick={handleSave}>Save</button>
      <button style={s.btn} onClick={() => fileRef.current?.click()}>Load</button>
      <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
    </div>
  );
}
```

**Step 2: Vérifier**

Ajouter des entités, Save → télécharge `scene.json`. New → scène vide. Load → recharge la scène.

**Step 3: Commit**

```bash
git add editor/src/components/MenuBar/
git commit -m "feat(editor): MenuBar File — New / Save JSON / Load JSON"
```

---

## Task 12: Asset Browser — Import textures

**Contexte :** L'asset browser permet d'importer des PNG/JPG depuis le filesystem et les assigne comme texture albedo de l'entité sélectionnée.

**Files:**
- Modify: `editor/src/components/AssetBrowser/AssetBrowser.tsx`

**Step 1: Implémenter `AssetBrowser.tsx`**

```tsx
import { useState, useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';

interface AssetItem { name: string; url: string; texId: number; }

const s: Record<string, React.CSSProperties> = {
  root:    { height: '100%', display: 'flex', flexDirection: 'column' },
  header:  { padding: '4px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 },
  grid:    { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, flex: 1, overflowY: 'auto' },
  item:    { width: 64, cursor: 'pointer', textAlign: 'center' },
  thumb:   { width: 64, height: 64, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)' },
  name:    { fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  addBtn:  { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 'var(--font-size)' },
};

export default function AssetBrowser() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const fileRef  = useRef<HTMLInputElement>(null);
  const selectedId = useEditorStore(s => s.selectedId);

  const importTexture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const texId = bridge['world']?.upload_texture(
        bitmap.width, bitmap.height, imageData.data, true
      ) ?? -1;
      // Note: bridge.world est privé — exposer une méthode uploadTexture dans engineBridge
      if (texId >= 0) {
        const url = URL.createObjectURL(file);
        setAssets(prev => [...prev, { name: file.name, url, texId }]);
      }
    }
    e.target.value = '';
  };

  const applyToSelected = (texId: number) => {
    if (selectedId === null) return;
    bridge['world']?.add_material(selectedId, texId);
    // Note: exposer addMaterial dans engineBridge
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Assets</span>
        <button style={s.addBtn} onClick={() => fileRef.current?.click()}>+ Import</button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={importTexture} />
      </div>
      <div style={s.grid}>
        {assets.map((a, i) => (
          <div key={i} style={s.item} onClick={() => applyToSelected(a.texId)} title={`Appliquer ${a.name} à l'entité sélectionnée`}>
            <img src={a.url} style={s.thumb} alt={a.name} />
            <div style={s.name}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Note :** Ce composant accède directement à `bridge['world']` (hack temporaire). Ajouter les méthodes `uploadTexture` et `addMaterial` dans `engineBridge.ts` :

```typescript
// Dans engineBridge.ts :
uploadTexture(width: number, height: number, data: Uint8ClampedArray, mipmaps = true): number {
  return this.world?.upload_texture(width, height, data, mipmaps) ?? -1;
}

addMaterial(entityId: EntityId, texId: number): void {
  this.world?.add_material(entityId, texId);
}
```

Puis utiliser `bridge.uploadTexture(...)` et `bridge.addMaterial(...)` dans AssetBrowser.

**Step 2: Vérifier**

Import une texture PNG → thumbnail affiché dans le panneau. Sélectionner une entité, cliquer la texture → elle s'applique dans le viewport.

**Step 3: Commit**

```bash
git add editor/src/components/AssetBrowser/ editor/src/engine/engineBridge.ts
git commit -m "feat(editor): Asset Browser — import textures, appliquer à entité sélectionnée"
```

---

## Task 13: Push + commit final

**Step 1: Vérifier que tout compile sans erreur TypeScript**

```bash
cd editor
npm run build
```

Attendu : `✓ built in X.XXs` sans erreurs TS.

**Step 2: S'assurer que game-app fonctionne toujours**

```bash
cd ../game-app
npm run dev
```

Attendu : le jeu démo tourne normalement.

**Step 3: Commit final et push**

```bash
cd ..
git add .
git commit -m "feat(editor): Phase 7 complet — WebUnity Editor (viewport, scene graph, inspector, gizmos, assets, play/stop)"
git push origin main
```

---

## Notes d'implémentation

### SparseSet.iter_ids()

Vérifier l'implémentation de SparseSet dans `engine-core/src/ecs/sparse_set.rs`. Selon le design (array dense + lookup sparse), iter_ids peut être :

```rust
// Si SparseSet stocke dense: Vec<(usize, T)>
pub fn iter_ids(&self) -> impl Iterator<Item = usize> + '_ {
    self.dense.iter().map(|(id, _)| *id)
}

// Ou si sparse: Vec<usize> (MAX = vide) + dense: Vec<T>
pub fn iter_ids(&self) -> impl Iterator<Item = usize> + '_ {
    self.sparse.iter().enumerate()
        .filter_map(|(id, &slot)| if slot != usize::MAX { Some(id) } else { None })
}
```

Adapter selon le code existant.

### Projection glam column-major

`vp.to_cols_array()` retourne `[col0.x, col0.y, col0.z, col0.w, col1.x, ...]`.
Multiplication `v_clip = vp * [x, y, z, 1]` :
- `clip.x = vp[0]*x + vp[4]*y + vp[8]*z + vp[12]`
- `clip.y = vp[1]*x + vp[5]*y + vp[9]*z + vp[13]`
- `clip.w = vp[3]*x + vp[7]*y + vp[11]*z + vp[15]`

### Caméra orbitale Edit mode

En mode Edit, le bridge ne doit PAS appeler `world.update()` (qui active la physique FPS). Utiliser uniquement `render_frame()`. En mode Play, appeler `update()` + `render_frame()`.
