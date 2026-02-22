# WebUnity Editor — FPS-Ready Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rendre l'éditeur WebUnity capable de builder et jouer une démo FPS complète avec niveaux, physique, ennemis scriptables.

**Architecture:** Système de composants à la Unity exposé dans l'Inspector via bouton "Add Component". Les métadonnées editor (mesh type, scripts, tags) sont gérées côté TypeScript dans un store séparé et sérialisées dans un format JSON étendu. Le moteur Rust gère physique/rendu nativement, l'IA ennemie est du scripting JS utilisateur.

**Tech Stack:** Rust/WASM (wgpu 28, glam), React 18, TypeScript, Zustand 5, Vite 7

---

## Contexte critique avant de commencer

**Bug existant :** La boucle play actuelle (`bridge.startLoop`) appelle uniquement `render_frame()` — jamais `update()`. La physique FPS et la caméra première-personne ne fonctionnent donc pas en play mode. Ce bug est corrigé en Task 9.

**Ce qui existe déjà dans le moteur Rust :**
- `set_player(id)`, `set_input(keys, dx, dy)`, `update(delta_ms)` — physique FPS complète
- `add_rigid_body(id, is_static)`, `add_collider_aabb(id, hx, hy, hz)`
- `add_point_light(id, ...)`, `add_directional_light(...)`
- `add_pbr_material(id, tex_id, metallic, roughness)`, `set_emissive(id, r, g, b)`
- **Absent :** mesh Plane, `set_mesh_type()`, `set_tag()`, `get_entity_by_tag()`

**Ce qui existe dans le bridge TypeScript (engineBridge.ts) :**
- `createEntity`, `addMeshRenderer`, `getTransform`, `setPosition/Rotation/Scale`
- `uploadTexture`, `addMaterial`, `saveScene`, `loadScene`
- **Absent :** les méthodes wrappant les APIs physique/lumière/PBR/input

---

## Task 1 : Plane mesh dans engine-core

**Files:**
- Modify: `engine-core/src/ecs/components.rs`
- Modify: `engine-core/src/mesh.rs`
- Modify: `engine-core/src/lib.rs` (render + set_mesh_type)

**Step 1 : Ajouter Plane à MeshType**

Dans `engine-core/src/ecs/components.rs`, ligne 19–21 :
```rust
pub enum MeshType {
    Cube,
    Plane,
}
```

**Step 2 : Ajouter PLANE_VERTICES/INDICES dans mesh.rs**

Après la constante `CUBE_INDICES` (fin du fichier) :
```rust
/// Plan horizontal XZ centré sur l'origine (face +Y).
pub const PLANE_VERTICES: &[Vertex] = &[
    Vertex { position: [-0.5, 0.0, -0.5], color: [0.5, 0.5, 0.5], uv: [0.0, 0.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, 0.0, -0.5], color: [0.5, 0.5, 0.5], uv: [1.0, 0.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, 0.0,  0.5], color: [0.5, 0.5, 0.5], uv: [1.0, 1.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [-0.5, 0.0,  0.5], color: [0.5, 0.5, 0.5], uv: [0.0, 1.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
];

pub const PLANE_INDICES: &[u16] = &[0, 1, 2, 0, 2, 3];
```

**Step 3 : Mettre à jour l'import dans lib.rs**

Ligne 12 de `lib.rs`, changer :
```rust
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES};
```
en :
```rust
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES, PLANE_INDICES, PLANE_VERTICES};
```

**Step 4 : Ajouter set_mesh_type() dans lib.rs**

Dans le bloc `#[wasm_bindgen] impl World` qui contient `add_mesh_renderer`, ajouter après cette méthode :
```rust
/// Change le type de mesh d'une entité existante ("cube" ou "plane").
pub fn set_mesh_type(&mut self, id: usize, mesh_type: &str) {
    let mt = match mesh_type {
        "plane" => MeshType::Plane,
        _       => MeshType::Cube,
    };
    if let Some(mr) = self.mesh_renderers.get_mut(id) {
        mr.mesh_type = mt;
    }
}

/// Retourne le type de mesh d'une entité ("cube" | "plane").
pub fn get_mesh_type(&self, id: usize) -> String {
    match self.mesh_renderers.get(id) {
        Some(mr) => match mr.mesh_type {
            MeshType::Cube  => "cube".to_string(),
            MeshType::Plane => "plane".to_string(),
        },
        None => "cube".to_string(),
    }
}
```

**Step 5 : Mettre à jour render_frame pour utiliser le bon mesh**

Dans `render_frame()`, chercher le passage qui crée les vertex/index buffers pour le rendu. Il y a une boucle sur les entités avec mesh_renderer. Remplacer le code qui utilise toujours `CUBE_VERTICES`/`CUBE_INDICES` par :
```rust
let (verts, idxs): (&[Vertex], &[u16]) = match mr.mesh_type {
    MeshType::Cube  => (CUBE_VERTICES, CUBE_INDICES),
    MeshType::Plane => (PLANE_VERTICES, PLANE_INDICES),
};
```
*(Chercher dans render_frame la création du vertex_buffer avec CUBE_VERTICES et remplacer)*

**Step 6 : Rebuild WASM**
```bash
cd engine-core
wasm-pack build --target web --out-dir pkg
```
Vérifier que `engine-core/pkg/engine_core.js` et `engine_core_bg.wasm` sont mis à jour.

**Step 7 : Tester dans le navigateur**
```bash
cd editor && npm run dev
```
Créer une entité, et dans la console browser : `bridge.world.set_mesh_type(0, 'plane')` — l'entité doit devenir un plan plat.

**Step 8 : Commit**
```bash
git add engine-core/src/ecs/components.rs engine-core/src/mesh.rs engine-core/src/lib.rs engine-core/pkg/
git commit -m "feat(engine): Plane mesh + set_mesh_type/get_mesh_type WASM API"
```

---

## Task 2 : Étendre engineBridge.ts avec les APIs manquantes

**Files:**
- Modify: `editor/src/engine/engineBridge.ts`

**Step 1 : Ajouter les méthodes physique/PBR/lumières**

Dans `engineBridge.ts`, après la méthode `addMaterial()` (ligne ~89), ajouter :

```typescript
// ── Matériaux PBR ────────────────────────────────────────────────────────────

addPbrMaterial(entityId: EntityId, texId: number, metallic: number, roughness: number): void {
  this.world?.add_pbr_material(entityId, texId, metallic, roughness);
}

setEmissive(entityId: EntityId, r: number, g: number, b: number): void {
  this.world?.set_emissive(entityId, r, g, b);
}

// ── Mesh type ────────────────────────────────────────────────────────────────

setMeshType(entityId: EntityId, meshType: 'cube' | 'plane'): void {
  this.world?.set_mesh_type(entityId, meshType);
}

getMeshType(entityId: EntityId): 'cube' | 'plane' {
  return (this.world?.get_mesh_type(entityId) as 'cube' | 'plane') ?? 'cube';
}

// ── Physique ─────────────────────────────────────────────────────────────────

addRigidBody(entityId: EntityId, isStatic: boolean): void {
  this.world?.add_rigid_body(entityId, isStatic);
}

addCollider(entityId: EntityId, hx: number, hy: number, hz: number): void {
  this.world?.add_collider_aabb(entityId, hx, hy, hz);
}

// ── Lumières ─────────────────────────────────────────────────────────────────

addPointLight(entityId: EntityId, r: number, g: number, b: number, intensity: number): void {
  this.world?.add_point_light(entityId, r, g, b, intensity);
}

addDirectionalLight(dx: number, dy: number, dz: number, r: number, g: number, b: number, intensity: number): void {
  this.world?.add_directional_light(dx, dy, dz, r, g, b, intensity);
}

// ── Player / Input ────────────────────────────────────────────────────────────

setPlayer(entityId: EntityId): void {
  this.world?.set_player(entityId);
}

setInput(keys: number, mouseDx: number, mouseDy: number): void {
  this.world?.set_input(keys, mouseDx, mouseDy);
}

// ── Simulation ────────────────────────────────────────────────────────────────

update(deltaMs: number): void {
  this.world?.update(deltaMs);
}
```

**Step 2 : Fixer la boucle render pour utiliser un vrai delta-time**

La méthode `startLoop` utilise un delta hardcodé de 16.67ms. Remplacer :
```typescript
startLoop(onFrame?: () => void): void {
  if (this.rafId !== null) return;
  let lastTime = performance.now();
  const loop = (now: number) => {
    const deltaMs = Math.min(now - lastTime, 50); // cap 50ms
    lastTime = now;
    this.world?.render_frame(deltaMs);
    onFrame?.();
    this.rafId = requestAnimationFrame(loop);
  };
  this.rafId = requestAnimationFrame(loop);
}
```

**Step 3 : Ajouter startGameLoop (différent de startLoop — appelle aussi update)**
```typescript
startGameLoop(onFrame?: (deltaMs: number) => void): void {
  if (this.rafId !== null) return;
  let lastTime = performance.now();
  const loop = (now: number) => {
    const deltaMs = Math.min(now - lastTime, 50);
    lastTime = now;
    this.world?.update(deltaMs);
    this.world?.render_frame(deltaMs);
    onFrame?.(deltaMs);
    this.rafId = requestAnimationFrame(loop);
  };
  this.rafId = requestAnimationFrame(loop);
}
```

**Step 4 : Tester en console browser**
```javascript
// Dans console browser du dev server :
bridge.addRigidBody(0, false);
bridge.addCollider(0, 0.5, 0.5, 0.5);
// Pas d'erreur = OK
```

**Step 5 : Commit**
```bash
git add editor/src/engine/engineBridge.ts
git commit -m "feat(editor): bridge — PBR, physics, lights, player, input, game loop APIs"
```

---

## Task 3 : ComponentStore — métadonnées composants côté React

**Files:**
- Create: `editor/src/store/componentStore.ts`
- Modify: `editor/src/engine/types.ts`

**Step 1 : Étendre types.ts**

Ouvrir `editor/src/engine/types.ts` et ajouter après les types existants :
```typescript
export interface MaterialData {
  texId:    number;          // -1 = pas de texture
  metallic: number;          // 0.0–1.0
  roughness: number;         // 0.0–1.0
  emissive: [number, number, number]; // RGB 0.0–1.0
}

export interface RigidbodyData {
  isStatic: boolean;
}

export interface ColliderData {
  hx: number;
  hy: number;
  hz: number;
}

export interface PointLightData {
  r: number; g: number; b: number;
  intensity: number;
}

export interface DirectionalLightData {
  dx: number; dy: number; dz: number;
  r: number; g: number; b: number;
  intensity: number;
}

export interface EntityComponents {
  meshType?:         'cube' | 'plane';
  material?:         MaterialData;
  rigidbody?:        RigidbodyData;
  collider?:         ColliderData;
  pointLight?:       PointLightData;
  directionalLight?: DirectionalLightData;
  isPlayer?:         boolean;
  script?:           string;
}
```

**Step 2 : Créer componentStore.ts**
```typescript
import { create } from 'zustand';
import type { EntityId } from '../engine/types';
import type { EntityComponents } from '../engine/types';

interface ComponentStoreState {
  components: Record<EntityId, EntityComponents>;

  getComponents:    (id: EntityId) => EntityComponents;
  setComponent:     <K extends keyof EntityComponents>(id: EntityId, key: K, value: EntityComponents[K]) => void;
  removeComponent:  <K extends keyof EntityComponents>(id: EntityId, key: K) => void;
  removeEntity:     (id: EntityId) => void;
  clearAll:         () => void;
  serialize:        () => Record<EntityId, EntityComponents>;
  deserialize:      (data: Record<EntityId, EntityComponents>) => void;
}

export const useComponentStore = create<ComponentStoreState>((set, get) => ({
  components: {},

  getComponents: (id) => get().components[id] ?? {},

  setComponent: (id, key, value) =>
    set(s => ({
      components: {
        ...s.components,
        [id]: { ...s.components[id], [key]: value },
      },
    })),

  removeComponent: (id, key) =>
    set(s => {
      const next = { ...s.components[id] };
      delete next[key];
      return { components: { ...s.components, [id]: next } };
    }),

  removeEntity: (id) =>
    set(s => {
      const next = { ...s.components };
      delete next[id];
      return { components: next };
    }),

  clearAll: () => set({ components: {} }),

  serialize: () => get().components,

  deserialize: (data) => set({ components: data }),
}));
```

**Step 3 : Mettre à jour sceneStore.removeEntity pour nettoyer componentStore**

Dans `sceneStore.ts`, importer `useComponentStore` et appeler `useComponentStore.getState().removeEntity(id)` dans `removeEntity()`.

**Step 4 : Commit**
```bash
git add editor/src/store/componentStore.ts editor/src/engine/types.ts editor/src/store/sceneStore.ts
git commit -m "feat(editor): componentStore + types étendus pour système de composants"
```

---

## Task 4 : Bouton "Add Component" dans l'Inspector

**Files:**
- Modify: `editor/src/components/Inspector/Inspector.tsx`
- Create: `editor/src/components/Inspector/AddComponentButton.tsx`

**Step 1 : Créer AddComponentButton.tsx**
```tsx
import React, { useState } from 'react';
import { useComponentStore } from '../../store/componentStore';
import type { EntityId } from '../../engine/types';

const AVAILABLE_COMPONENTS = [
  { key: 'meshType',         label: 'Mesh Renderer' },
  { key: 'material',         label: 'Material (PBR)' },
  { key: 'rigidbody',        label: 'Rigidbody' },
  { key: 'collider',         label: 'Box Collider' },
  { key: 'pointLight',       label: 'Point Light' },
  { key: 'directionalLight', label: 'Directional Light' },
  { key: 'isPlayer',         label: 'Player Controller' },
  { key: 'script',           label: 'Script' },
] as const;

const DEFAULT_VALUES: Record<string, unknown> = {
  meshType:         'cube',
  material:         { texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0] },
  rigidbody:        { isStatic: true },
  collider:         { hx: 0.5, hy: 0.5, hz: 0.5 },
  pointLight:       { r: 1, g: 1, b: 1, intensity: 5.0 },
  directionalLight: { dx: 0.3, dy: -1, dz: 0.5, r: 1, g: 0.95, b: 0.8, intensity: 1.5 },
  isPlayer:         true,
  script:           '// onStart(entity, engine) {}\n// onUpdate(entity, engine, deltaMs) {}',
};

export default function AddComponentButton({ entityId }: { entityId: EntityId }) {
  const [open, setOpen] = useState(false);
  const { getComponents, setComponent } = useComponentStore();
  const existing = getComponents(entityId);

  const available = AVAILABLE_COMPONENTS.filter(c => existing[c.key] === undefined);

  if (available.length === 0) return null;

  return (
    <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '4px 0', cursor: 'pointer', fontSize: 11 }}
      >
        + Add Component
      </button>
      {open && (
        <div style={{ marginTop: 4, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 3 }}>
          {available.map(c => (
            <div
              key={c.key}
              onClick={() => {
                setComponent(entityId, c.key as keyof typeof DEFAULT_VALUES, DEFAULT_VALUES[c.key] as never);
                setOpen(false);
              }}
              style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 11, color: 'var(--text)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2 : Mettre à jour Inspector.tsx**
```tsx
import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import TransformPanel from './TransformPanel';
import AddComponentButton from './AddComponentButton';
import ComponentPanels from './ComponentPanels';

export default function Inspector() {
  const selectedId = useEditorStore(s => s.selectedId);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>
        Inspector
      </div>
      {selectedId !== null ? (
        <>
          <TransformPanel entityId={selectedId} />
          <ComponentPanels entityId={selectedId} />
          <AddComponentButton entityId={selectedId} />
        </>
      ) : (
        <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11 }}>No entity selected</div>
      )}
    </div>
  );
}
```

**Step 3 : Vérifier dans le browser**
Sélectionner une entité → "Add Component" apparaît en bas de l'Inspector.
Cliquer → dropdown des composants disponibles.

**Step 4 : Commit**
```bash
git add editor/src/components/Inspector/Inspector.tsx editor/src/components/Inspector/AddComponentButton.tsx
git commit -m "feat(editor): Inspector — bouton Add Component avec dropdown"
```

---

## Task 5 : Panels de composants (MeshRenderer, Material, Rigidbody, Collider)

**Files:**
- Create: `editor/src/components/Inspector/ComponentPanels.tsx`
- Create: `editor/src/components/Inspector/panels/MeshRendererPanel.tsx`
- Create: `editor/src/components/Inspector/panels/MaterialPanel.tsx`
- Create: `editor/src/components/Inspector/panels/RigidbodyPanel.tsx`
- Create: `editor/src/components/Inspector/panels/ColliderPanel.tsx`

**Step 1 : Créer un composant utilitaire PanelSection**

Au début de `ComponentPanels.tsx` (ou dans un fichier partagé), définir :
```tsx
function PanelSection({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'var(--bg-header)', fontSize: 11, fontWeight: 600 }}>
        <span>{title}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10 }}>✕</button>
      </div>
      <div style={{ padding: '6px 8px' }}>{children}</div>
    </div>
  );
}
```

**Step 2 : MeshRendererPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function MeshRendererPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const meshType = getComponents(entityId).meshType ?? 'cube';

  const handleChange = (val: 'cube' | 'plane') => {
    setComponent(entityId, 'meshType', val);
    bridge.setMeshType(entityId, val);
  };

  return (
    <PanelSection title="Mesh Renderer" onRemove={() => removeComponent(entityId, 'meshType')}>
      <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Mesh Type</label>
      <select
        value={meshType}
        onChange={e => handleChange(e.target.value as 'cube' | 'plane')}
        style={{ marginLeft: 8, background: 'var(--bg-hover)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11 }}
      >
        <option value="cube">Cube</option>
        <option value="plane">Plane</option>
      </select>
    </PanelSection>
  );
}
```

*(Note : `PanelSection` doit être importé ou défini dans le même fichier)*

**Step 3 : MaterialPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import { useSceneStore } from '../../../store/sceneStore';
import type { EntityId, MaterialData } from '../../../engine/types';

export default function MaterialPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const mat: MaterialData = getComponents(entityId).material ?? { texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0] };

  const apply = (next: MaterialData) => {
    setComponent(entityId, 'material', next);
    if (next.texId >= 0) {
      bridge.addPbrMaterial(entityId, next.texId, next.metallic, next.roughness);
    }
    bridge.setEmissive(entityId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  return (
    <PanelSection title="Material (PBR)" onRemove={() => removeComponent(entityId, 'material')}>
      <Row label="Metallic">
        <input type="range" min={0} max={1} step={0.01} value={mat.metallic}
          onChange={e => apply({ ...mat, metallic: parseFloat(e.target.value) })} style={{ width: 80 }} />
        <span style={{ fontSize: 10, marginLeft: 4 }}>{mat.metallic.toFixed(2)}</span>
      </Row>
      <Row label="Roughness">
        <input type="range" min={0} max={1} step={0.01} value={mat.roughness}
          onChange={e => apply({ ...mat, roughness: parseFloat(e.target.value) })} style={{ width: 80 }} />
        <span style={{ fontSize: 10, marginLeft: 4 }}>{mat.roughness.toFixed(2)}</span>
      </Row>
      <Row label="Emissive R">
        <input type="range" min={0} max={1} step={0.01} value={mat.emissive[0]}
          onChange={e => apply({ ...mat, emissive: [parseFloat(e.target.value), mat.emissive[1], mat.emissive[2]] })} style={{ width: 80 }} />
      </Row>
    </PanelSection>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11 }}>
      <span style={{ color: 'var(--text-dim)', width: 70 }}>{label}</span>
      {children}
    </div>
  );
}
```

**Step 4 : RigidbodyPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function RigidbodyPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const rb = getComponents(entityId).rigidbody ?? { isStatic: true };

  const toggle = () => {
    const next = { isStatic: !rb.isStatic };
    setComponent(entityId, 'rigidbody', next);
    bridge.addRigidBody(entityId, next.isStatic);
  };

  return (
    <PanelSection title="Rigidbody" onRemove={() => removeComponent(entityId, 'rigidbody')}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
        <input type="checkbox" checked={rb.isStatic} onChange={toggle} />
        <span>Is Static</span>
      </label>
    </PanelSection>
  );
}
```

**Step 5 : ColliderPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function ColliderPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const col = getComponents(entityId).collider ?? { hx: 0.5, hy: 0.5, hz: 0.5 };

  const apply = (next: typeof col) => {
    setComponent(entityId, 'collider', next);
    bridge.addCollider(entityId, next.hx, next.hy, next.hz);
  };

  return (
    <PanelSection title="Box Collider" onRemove={() => removeComponent(entityId, 'collider')}>
      {(['hx', 'hy', 'hz'] as const).map(axis => (
        <div key={axis} style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11 }}>
          <span style={{ color: 'var(--text-dim)', width: 70 }}>Half {axis.toUpperCase()}</span>
          <input
            type="number" step={0.1} min={0.01} value={col[axis]}
            onChange={e => apply({ ...col, [axis]: parseFloat(e.target.value) || 0.01 })}
            style={{ width: 60, background: 'var(--bg-hover)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11, padding: '1px 4px' }}
          />
        </div>
      ))}
    </PanelSection>
  );
}
```

**Step 6 : Créer ComponentPanels.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../store/componentStore';
import type { EntityId } from '../../engine/types';
import MeshRendererPanel from './panels/MeshRendererPanel';
import MaterialPanel from './panels/MaterialPanel';
import RigidbodyPanel from './panels/RigidbodyPanel';
import ColliderPanel from './panels/ColliderPanel';

export default function ComponentPanels({ entityId }: { entityId: EntityId }) {
  const { getComponents } = useComponentStore();
  const c = getComponents(entityId);

  return (
    <>
      {c.meshType    !== undefined && <MeshRendererPanel entityId={entityId} />}
      {c.material    !== undefined && <MaterialPanel entityId={entityId} />}
      {c.rigidbody   !== undefined && <RigidbodyPanel entityId={entityId} />}
      {c.collider    !== undefined && <ColliderPanel entityId={entityId} />}
    </>
  );
}
```

**Step 7 : Vérifier dans le browser**
Sélectionner entité → Add Component → Rigidbody → le panel apparaît avec checkbox Is Static.
Cocher/décocher → aucune erreur dans la console.

**Step 8 : Commit**
```bash
git add editor/src/components/Inspector/
git commit -m "feat(editor): panels MeshRenderer, Material, Rigidbody, Collider dans Inspector"
```

---

## Task 6 : Panels Light et PlayerController

**Files:**
- Create: `editor/src/components/Inspector/panels/LightPanel.tsx`
- Create: `editor/src/components/Inspector/panels/PlayerControllerPanel.tsx`
- Modify: `editor/src/components/Inspector/ComponentPanels.tsx`

**Step 1 : LightPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, PointLightData, DirectionalLightData } from '../../../engine/types';

export default function LightPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const c = getComponents(entityId);

  // Determine if it's a point or directional light
  const isPoint = c.pointLight !== undefined;
  const isDirectional = c.directionalLight !== undefined;

  if (isPoint) {
    const pl: PointLightData = c.pointLight!;
    const apply = (next: PointLightData) => {
      setComponent(entityId, 'pointLight', next);
      bridge.addPointLight(entityId, next.r, next.g, next.b, next.intensity);
    };
    return (
      <PanelSection title="Point Light" onRemove={() => removeComponent(entityId, 'pointLight')}>
        <SliderRow label="Intensity" value={pl.intensity} min={0} max={20} step={0.1} onChange={v => apply({ ...pl, intensity: v })} />
        <SliderRow label="R" value={pl.r} min={0} max={1} step={0.01} onChange={v => apply({ ...pl, r: v })} />
        <SliderRow label="G" value={pl.g} min={0} max={1} step={0.01} onChange={v => apply({ ...pl, g: v })} />
        <SliderRow label="B" value={pl.b} min={0} max={1} step={0.01} onChange={v => apply({ ...pl, b: v })} />
      </PanelSection>
    );
  }

  if (isDirectional) {
    const dl: DirectionalLightData = c.directionalLight!;
    const apply = (next: DirectionalLightData) => {
      setComponent(entityId, 'directionalLight', next);
      bridge.addDirectionalLight(next.dx, next.dy, next.dz, next.r, next.g, next.b, next.intensity);
    };
    return (
      <PanelSection title="Directional Light" onRemove={() => removeComponent(entityId, 'directionalLight')}>
        <SliderRow label="Intensity" value={dl.intensity} min={0} max={5} step={0.05} onChange={v => apply({ ...dl, intensity: v })} />
        <SliderRow label="Dir X" value={dl.dx} min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dx: v })} />
        <SliderRow label="Dir Y" value={dl.dy} min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dy: v })} />
        <SliderRow label="Dir Z" value={dl.dz} min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dz: v })} />
      </PanelSection>
    );
  }

  return null;
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11 }}>
      <span style={{ color: 'var(--text-dim)', width: 70 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} style={{ width: 80 }} />
      <span style={{ fontSize: 10, marginLeft: 4 }}>{value.toFixed(2)}</span>
    </div>
  );
}
```

**Step 2 : PlayerControllerPanel.tsx**
```tsx
import React, { useEffect } from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId } from '../../../engine/types';

export default function PlayerControllerPanel({ entityId }: { entityId: EntityId }) {
  const { removeComponent } = useComponentStore();

  // Appliquer set_player au moteur dès que le composant est monté
  useEffect(() => {
    bridge.setPlayer(entityId);
    return () => {
      // Note : pas de "unset_player" dans l'API moteur — sera écrasé au prochain set_player
    };
  }, [entityId]);

  return (
    <PanelSection title="Player Controller" onRemove={() => {
      removeComponent(entityId, 'isPlayer');
      // Le joueur actif reste dans le moteur jusqu'au reload de scène
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Cette entité est le joueur FPS.<br />
        En play mode : WASD + souris, Espace = saut.
      </div>
    </PanelSection>
  );
}
```

**Step 3 : Mettre à jour ComponentPanels.tsx**

Ajouter les imports et les panels Light + PlayerController :
```tsx
import LightPanel from './panels/LightPanel';
import PlayerControllerPanel from './panels/PlayerControllerPanel';

// Dans le JSX, ajouter :
{(c.pointLight !== undefined || c.directionalLight !== undefined) && <LightPanel entityId={entityId} />}
{c.isPlayer !== undefined && <PlayerControllerPanel entityId={entityId} />}
```

**Step 4 : Commit**
```bash
git add editor/src/components/Inspector/
git commit -m "feat(editor): panels Light (Point/Directional) et PlayerController"
```

---

## Task 7 : Script Panel + Save/Load étendu

**Files:**
- Create: `editor/src/components/Inspector/panels/ScriptPanel.tsx`
- Modify: `editor/src/components/Inspector/ComponentPanels.tsx`
- Modify: `editor/src/components/MenuBar/MenuBar.tsx`

**Step 1 : ScriptPanel.tsx**
```tsx
import React from 'react';
import { useComponentStore } from '../../../store/componentStore';
import type { EntityId } from '../../../engine/types';

export default function ScriptPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const script = getComponents(entityId).script ?? '';

  return (
    <PanelSection title="Script (JS)" onRemove={() => removeComponent(entityId, 'script')}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
        Lifecycle: <code>onStart(entity, engine)</code>, <code>onUpdate(entity, engine, deltaMs)</code>
      </div>
      <textarea
        value={script}
        onChange={e => setComponent(entityId, 'script', e.target.value)}
        spellCheck={false}
        style={{
          width: '100%', height: 120, background: '#1a1a2e', color: '#e0e0ff',
          border: '1px solid var(--border)', borderRadius: 3, fontSize: 10,
          fontFamily: 'monospace', padding: 6, resize: 'vertical', boxSizing: 'border-box',
        }}
      />
    </PanelSection>
  );
}
```

**Step 2 : Mettre à jour ComponentPanels.tsx**
```tsx
import ScriptPanel from './panels/ScriptPanel';
// Ajouter :
{c.script !== undefined && <ScriptPanel entityId={entityId} />}
```

**Step 3 : Étendre le format de sauvegarde dans MenuBar.tsx**

Ouvrir `editor/src/components/MenuBar/MenuBar.tsx` et lire le code existant.

Modifier la fonction de sauvegarde pour combiner le JSON moteur + les métadonnées editor :
```typescript
import { useComponentStore } from '../../store/componentStore';

// Dans la fonction handleSave :
const engineJson  = bridge.saveScene();
const editorMeta  = useComponentStore.getState().serialize();
const fullScene   = JSON.stringify({ engineScene: JSON.parse(engineJson), editorMeta }, null, 2);
// Écrire fullScene dans le fichier
```

Modifier la fonction de chargement :
```typescript
// Dans handleLoad, après avoir lu le fichier JSON :
const parsed = JSON.parse(text);
if (parsed.engineScene && parsed.editorMeta) {
  // Format étendu
  bridge.loadScene(JSON.stringify(parsed.engineScene));
  useComponentStore.getState().deserialize(parsed.editorMeta);
} else {
  // Format legacy (JSON moteur direct)
  bridge.loadScene(text);
}
```

**Step 4 : Tester save/load**
1. Ajouter une entité, lui ajouter Rigidbody + Script
2. File → Save → enregistrer en `.json`
3. File → New (remet à zéro)
4. File → Load → recharger le fichier sauvé
5. Vérifier que Rigidbody et Script sont bien restaurés dans l'Inspector

**Step 5 : Commit**
```bash
git add editor/src/components/Inspector/panels/ScriptPanel.tsx editor/src/components/Inspector/ComponentPanels.tsx editor/src/components/MenuBar/MenuBar.tsx
git commit -m "feat(editor): ScriptPanel + save/load étendu avec métadonnées composants"
```

---

## Task 8 : Tags dans le moteur Rust (pour scripting)

**Files:**
- Modify: `engine-core/src/lib.rs`

**Step 1 : Ajouter le champ tags dans World**

Dans la struct `World` (vers ligne 94 de lib.rs), dans le bloc non-wasm, ajouter le champ :
```rust
// Tags pour le scripting
tags: std::collections::HashMap<usize, String>,
```

**Step 2 : Initialiser tags dans World::new()**
Dans le bloc `World { ... }` (init de la struct), ajouter :
```rust
tags: std::collections::HashMap::new(),
```

**Step 3 : Ajouter les méthodes WASM set_tag / get_entity_by_tag**

Dans le bloc `#[wasm_bindgen] impl World`, ajouter :
```rust
/// Assigne un tag string à une entité (ex: "player", "enemy", "wall").
pub fn set_tag(&mut self, id: usize, tag: &str) {
    self.tags.insert(id, tag.to_string());
}

/// Retourne le premier ID d'entité qui a ce tag, ou u32::MAX si aucun.
pub fn get_entity_by_tag(&self, tag: &str) -> u32 {
    self.tags
        .iter()
        .find(|(_, t)| t.as_str() == tag)
        .map(|(&id, _)| id as u32)
        .unwrap_or(u32::MAX)
}

/// Retourne le tag d'une entité (chaîne vide si aucun).
pub fn get_tag(&self, id: usize) -> String {
    self.tags.get(&id).cloned().unwrap_or_default()
}
```

**Step 4 : Ajouter les méthodes dans engineBridge.ts**
```typescript
setTag(entityId: EntityId, tag: string): void {
  this.world?.set_tag(entityId, tag);
}

getEntityByTag(tag: string): EntityId | null {
  const id = this.world?.get_entity_by_tag(tag) ?? 0xFFFFFFFF;
  return id === 0xFFFFFFFF ? null : id;
}
```

**Step 5 : Rebuild WASM**
```bash
cd engine-core && wasm-pack build --target web --out-dir pkg
```

**Step 6 : Commit**
```bash
git add engine-core/src/lib.rs engine-core/pkg/ editor/src/engine/engineBridge.ts
git commit -m "feat(engine): tags — set_tag, get_entity_by_tag, get_tag"
```

---

## Task 9 : FPS Play Mode — pointer lock + input + game loop

**Files:**
- Modify: `editor/src/components/Viewport/Viewport.tsx`
- Modify: `editor/src/components/Toolbar/Toolbar.tsx`

**Step 1 : Créer un hook useFpsInput dans Viewport.tsx**

Ce hook s'attache/détache selon `isPlaying` :
```typescript
import { useEditorStore } from '../../store/editorStore';

// Ajouter dans le composant Viewport, APRÈS le hook d'orbit camera :
const isPlaying = useEditorStore(s => s.isPlaying);

useEffect(() => {
  if (!isPlaying) return;

  const canvas = canvasRef.current;
  if (!canvas) return;

  // Accumulation delta souris entre frames
  let mouseDx = 0, mouseDy = 0;
  let keys    = 0;

  const onMouseMove = (e: MouseEvent) => {
    mouseDx += e.movementX;
    mouseDy += e.movementY;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyW')     keys |=  (1 << 0);
    if (e.code === 'KeyS')     keys |=  (1 << 1);
    if (e.code === 'KeyA')     keys |=  (1 << 2);
    if (e.code === 'KeyD')     keys |=  (1 << 3);
    if (e.code === 'Space')  { keys |=  (1 << 4); e.preventDefault(); }
    if (e.code === 'Escape') { document.exitPointerLock(); }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW')   keys &= ~(1 << 0);
    if (e.code === 'KeyS')   keys &= ~(1 << 1);
    if (e.code === 'KeyA')   keys &= ~(1 << 2);
    if (e.code === 'KeyD')   keys &= ~(1 << 3);
    if (e.code === 'Space')  keys &= ~(1 << 4);
  };

  // Injecter l'input à chaque frame (synchrone avec game loop via closure)
  // On passe les deltas accumulés et on remet à 0
  const onFrame = () => {
    bridge.setInput(keys, mouseDx, mouseDy);
    mouseDx = 0;
    mouseDy = 0;
  };

  // Pointer lock au clic sur le canvas
  const onClick = () => canvas.requestPointerLock();

  canvas.addEventListener('click', onClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Démarrer la game loop (update + render) au lieu du render seul
  bridge.stopLoop();
  bridge.startGameLoop((deltaMs) => {
    onFrame();
    refresh();
  });

  return () => {
    canvas.removeEventListener('click', onClick);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    bridge.setInput(0, 0, 0); // reset input
    document.exitPointerLock();
  };
}, [isPlaying]);
```

**Step 2 : Mettre à jour Toolbar.tsx pour la game loop**

Modifier la fonction `play()` pour ne PAS démarrer la loop (Viewport.tsx le fait via `isPlaying`) :
```typescript
const play = () => {
  setSnapshot(bridge.saveScene());
  bridge.stopLoop();   // Arrêter l'editor loop
  setPlaying(true);    // → Viewport détecte isPlaying=true et démarre la game loop
};

const stop = () => {
  bridge.stopLoop();   // Arrêter la game loop
  if (sceneSnapshot) { bridge.loadScene(sceneSnapshot); refresh(); }
  setPlaying(false);
  setSnapshot(null);
  // → Viewport détecte isPlaying=false et redémarre l'editor loop normal
};
```

**Step 3 : Redémarrer l'editor loop quand isPlaying devient false**

Ajouter un effet dans Viewport.tsx :
```typescript
useEffect(() => {
  if (!isPlaying) {
    bridge.stopLoop();
    bridge.startLoop(refresh);
  }
}, [isPlaying]);
```

**Step 4 : Tester le FPS**
1. Créer 3 entités : Floor (Plane, scale 20x1x20), Walls (Cubes), Player (Cube)
2. Floor : Add Component → Rigidbody (Static) + BoxCollider (hx=10, hy=0.1, hz=10)
3. Player : Add Component → Rigidbody (Dynamic) + BoxCollider (hx=0.4, hy=0.9, hz=0.4) + PlayerController
4. Cliquer Play → cliquer dans le viewport → pointer lock
5. Vérifier : WASD déplace, souris tourne, Espace saute, Esc sort du pointer lock

**Step 5 : Commit**
```bash
git add editor/src/components/Viewport/Viewport.tsx editor/src/components/Toolbar/Toolbar.tsx
git commit -m "feat(editor): play mode FPS — pointer lock, WASD input, game loop avec update()"
```

---

## Task 10 : Script execution loop (IA ennemie scriptable)

**Files:**
- Create: `editor/src/engine/scriptRunner.ts`
- Modify: `editor/src/components/Viewport/Viewport.tsx`

**Step 1 : Créer scriptRunner.ts**

```typescript
import { bridge } from './engineBridge';
import { useSceneStore } from '../store/sceneStore';
import { useComponentStore } from '../store/componentStore';

type ScriptFn = (entity: { id: number }, engine: typeof engineProxy, deltaMs: number) => void;

// Proxy API exposé aux scripts utilisateur
const engineProxy = {
  getPosition: (id: number): [number, number, number] => {
    const t = bridge.getTransform(id);
    return t.position;
  },
  setPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setPosition(id, x, y, z);
  },
  getEntityByTag: (tag: string): number | null => {
    return bridge.getEntityByTag(tag);
  },
  log: (...args: unknown[]) => console.log('[Script]', ...args),
};

interface CompiledScript {
  entityId: number;
  onStart?:  (entity: { id: number }, engine: typeof engineProxy) => void;
  onUpdate?: ScriptFn;
}

let compiledScripts: CompiledScript[] = [];

export function initScripts() {
  compiledScripts = [];
  const entities = useSceneStore.getState().entities;
  const compStore = useComponentStore.getState();

  for (const entity of entities) {
    const script = compStore.getComponents(entity.id).script;
    if (!script || !script.trim()) continue;

    try {
      // Compile en fonction
      const fn = new Function('entity', 'engine', 'deltaMs', script) as ScriptFn;
      const compiled: CompiledScript = {
        entityId: entity.id,
        onUpdate: fn,
      };

      // Extraire onStart si défini dans le script
      // Convention : if(typeof onStart === 'function') onStart(entity, engine)
      // Le script peut définir onStart en closure interne
      // Pour simplifier : le script entier est onUpdate, et le créateur peut gérer son propre state
      compiledScripts.push(compiled);

      // Appeler une "initialisation" de la fonction sans deltaMs pour onStart
      fn({ id: entity.id }, engineProxy, 0);
    } catch (e) {
      console.error(`[Script] Compile error on entity ${entity.id}:`, e);
    }
  }
}

export function tickScripts(deltaMs: number) {
  for (const cs of compiledScripts) {
    try {
      cs.onUpdate?.({ id: cs.entityId }, engineProxy, deltaMs);
    } catch (e) {
      console.error(`[Script] Runtime error on entity ${cs.entityId}:`, e);
    }
  }
}
```

**Step 2 : Intégrer initScripts + tickScripts dans le play mode**

Dans `Viewport.tsx`, importer et utiliser :
```typescript
import { initScripts, tickScripts } from '../../engine/scriptRunner';

// Dans l'effet isPlaying, après bridge.stopLoop() :
if (isPlaying) {
  initScripts(); // compile les scripts au démarrage
  bridge.startGameLoop((deltaMs) => {
    tickScripts(deltaMs);  // tick scripts avant input
    onFrame();
    refresh();
  });
}
```

**Step 3 : Exemple d'IA ennemie à tester**

Dans le ScriptPanel d'une entité "Enemy" :
```javascript
// Script ChasePlayer — vitesse 3 m/s, detection 15m
const speed = 3;
const playerPos = engine.getEntityByTag('player');
if (playerPos === null) return;

const myPos = engine.getPosition(entity.id);
const pPos  = engine.getPosition(playerPos);

const dx = pPos[0] - myPos[0];
const dz = pPos[2] - myPos[2];
const dist = Math.sqrt(dx*dx + dz*dz);

if (dist < 15 && dist > 0.5) {
  engine.setPosition(entity.id,
    myPos[0] + (dx/dist) * speed * (deltaMs/1000),
    myPos[1],
    myPos[2] + (dz/dist) * speed * (deltaMs/1000)
  );
}
```

**Step 4 : Tester le scripting**
1. Créer entité "Enemy" avec tag "enemy" (via `bridge.setTag(id, 'enemy')` en console pour l'instant)
2. Créer entité "Player" avec PlayerController
3. Coller le script ci-dessus dans ScriptPanel de Enemy
4. Play → l'ennemi doit se déplacer vers le joueur

**Step 5 : Commit**
```bash
git add editor/src/engine/scriptRunner.ts editor/src/components/Viewport/Viewport.tsx
git commit -m "feat(editor): script execution loop — initScripts/tickScripts, engineProxy pour IA"
```

---

## Task 11 : FPS HUD + polish final

**Files:**
- Modify: `editor/src/components/Viewport/Viewport.tsx`

**Step 1 : Ajouter le crosshair**

Dans le JSX de `Viewport.tsx`, ajouter après `<GizmoOverlay .../>` :
```tsx
{isPlaying && (
  <div style={{
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none', color: 'white', fontSize: 18, fontWeight: 'bold',
    textShadow: '0 0 3px black',
    userSelect: 'none',
  }}>
    +
  </div>
)}
{isPlaying && (
  <div style={{
    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.6)', fontSize: 10, pointerEvents: 'none',
    textShadow: '0 0 3px black',
  }}>
    Clic pour capturer la souris · Echap pour libérer
  </div>
)}
```

**Step 2 : Désactiver les gizmos en play mode**

Dans le JSX, modifier le GizmoOverlay pour ne pas le render en play mode :
```tsx
{!isPlaying && <GizmoOverlay width={dims.w} height={dims.h} />}
```

**Step 3 : Vérifier l'UX complète**
1. Mode éditeur : orbit camera, gizmos visibles, inspector accessible
2. Play : crosshair, hint "clic pour capturer", gizmos cachés
3. Stop : retour à l'état sauvegardé, gizmos réapparaissent

**Step 4 : Commit final**
```bash
git add editor/src/components/Viewport/Viewport.tsx
git commit -m "feat(editor): HUD crosshair + hint pointer lock, gizmos masqués en play mode"
```

---

## Récapitulatif des tâches

| # | Tâche | Fichiers clés | Complexité |
|---|-------|---------------|-----------|
| 1 | Plane mesh + set_mesh_type | engine-core/src/mesh.rs, components.rs, lib.rs | Rust médium |
| 2 | Bridge extensions | editor/src/engine/engineBridge.ts | TS facile |
| 3 | ComponentStore + types | editor/src/store/componentStore.ts, types.ts | TS médium |
| 4 | Add Component button | editor/src/components/Inspector/ | React médium |
| 5 | Panels MeshRenderer/Material/Rigidbody/Collider | editor/src/components/Inspector/panels/ | React médium |
| 6 | Panels Light + PlayerController | editor/src/components/Inspector/panels/ | React facile |
| 7 | ScriptPanel + Save/Load étendu | Inspector/panels/, MenuBar/ | TS médium |
| 8 | Tags dans engine | engine-core/src/lib.rs | Rust facile |
| 9 | FPS Play Mode | Viewport.tsx, Toolbar.tsx | TS complexe |
| 10 | Script execution loop | engine/scriptRunner.ts, Viewport.tsx | TS médium |
| 11 | HUD + polish | Viewport.tsx | TS facile |

**Ordre impératif :** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

Task 9 (FPS Play Mode) dépend de Task 1 (engine rebuild) et Task 2 (bridge). Les autres tâches 4–7 sont largement indépendantes entre elles une fois Task 3 fait.
