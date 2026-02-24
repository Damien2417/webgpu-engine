# WebUnity Editor v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 critical bugs (serialization, Play/Stop snapshot, gizmos) and add 9 major features to make WebUnity a complete game editor.

**Architecture:** 11 tasks (A–K) in dependency order. Tasks A+B fix critical bugs first (must be done before anything else). Tasks C–K add features independently. Tasks F, G, H each need a WASM rebuild (`wasm-pack build --target web` from `engine-core/`).

**Tech Stack:** React 18 + TypeScript + Zustand 5 (editor @ `editor/`), Rust + wasm-pack + wgpu 28 + glam + serde_json (engine @ `engine-core/src/`)

**WASM rebuild command:** (run from project root)
```bash
cd engine-core && wasm-pack build --target web
```
Output goes to `engine-core/pkg/`. The editor imports from `../../../engine-core/pkg/engine_core.js`.

---

## Task A: Fix Rust Serialization (CRITICAL BUG — do first)

**Problem:** `emissive` lost on save/load, `mesh_type` resets to cube, entity names get new IDs each load (+1 bug), tags lost. Root cause: `scene.rs` structs missing fields, `clear_scene()` doesn't reset `next_id` or clear `entity_names`.

**Files:**
- Modify: `engine-core/src/scene.rs` — add emissive, mesh_type, name, tag fields
- Modify: `engine-core/src/lib.rs` — fix clear_scene, save_scene, load_scene
- Rebuild WASM

---

### Step 1: Update `engine-core/src/scene.rs`

Replace the entire file content with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct SceneTransform {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub scale:    [f32; 3],
}

impl Default for SceneTransform {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale:    [1.0, 1.0, 1.0],
        }
    }
}

fn default_metallic()  -> f32 { 0.0 }
fn default_roughness() -> f32 { 0.5 }

#[derive(Serialize, Deserialize)]
pub struct SceneMaterial {
    pub texture: String,
    #[serde(default)]
    pub normal_texture: String,
    #[serde(default = "default_metallic")]
    pub metallic: f32,
    #[serde(default = "default_roughness")]
    pub roughness: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emissive: Option<[f32; 3]>,
}

#[derive(Serialize, Deserialize)]
pub struct SceneRigidBody {
    pub is_static: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ScenePointLight {
    pub color:     [f32; 3],
    pub intensity: f32,
}

#[derive(Serialize, Deserialize)]
pub struct SceneDirectionalLight {
    pub direction: [f32; 3],
    pub color:     [f32; 3],
    pub intensity: f32,
}

/// Représente une entité dans le JSON de scène.
#[derive(Serialize, Deserialize, Default)]
pub struct SceneEntityData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform:     Option<SceneTransform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_renderer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material:      Option<SceneMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rigid_body:    Option<SceneRigidBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collider_aabb: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_light:   Option<ScenePointLight>,
    // NEW FIELDS:
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Structure top-level du fichier JSON de scène.
#[derive(Serialize, Deserialize, Default)]
pub struct SceneData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directional_light: Option<SceneDirectionalLight>,
    #[serde(default)]
    pub entities: Vec<SceneEntityData>,
}
```

### Step 2: Fix `clear_scene()` in `engine-core/src/lib.rs`

Find `fn clear_scene(&mut self)` (around line 1562). Add 2 lines before `self.directional_light = None;`:

```rust
    // === ADD THESE TWO LINES ===
    // Reset entity name counter (skip persistent entity IDs)
    self.next_id = self.persistent_entities
        .iter()
        .max()
        .map(|&m| m + 1)
        .unwrap_or(0);
    // Clear entity_names for removed entities
    self.entity_names.retain(|id, _| self.persistent_entities.contains(id));
    // === END ADD ===
    self.directional_light = None;
```

Also add `self.tags.retain(|id, _| self.persistent_entities.contains(id));` — replace the per-entity `self.tags.remove(&id);` line inside the `for id in all_ids` loop with this retain call after the loop:

Old `for id in all_ids` loop at ~line 1573 ends with `self.tags.remove(&id);` inside the loop. Replace the entire loop with:

```rust
        for id in &all_ids {
            self.transforms.remove(*id);
            self.mesh_renderers.remove(*id);
            self.entity_gpus.remove(*id);
            self.materials.remove(*id);
            self.rigid_bodies.remove(*id);
            self.colliders.remove(*id);
            self.point_lights.remove(*id);
        }
        self.tags.retain(|id, _| !all_ids.contains(id));
```

### Step 3: Fix `save_scene()` in `engine-core/src/lib.rs`

Find the material serialization block (~line 1514). Change:
```rust
            let material = self.materials.get(id).map(|m| SceneMaterial {
                texture:        id_to_name.get(&m.albedo_tex).cloned().unwrap_or_default(),
                normal_texture: id_to_name.get(&m.normal_tex).cloned().unwrap_or_default(),
                metallic:       m.metallic,
                roughness:      m.roughness,
            });
```
To:
```rust
            let material = self.materials.get(id).map(|m| SceneMaterial {
                texture:        id_to_name.get(&m.albedo_tex).cloned().unwrap_or_default(),
                normal_texture: id_to_name.get(&m.normal_tex).cloned().unwrap_or_default(),
                metallic:       m.metallic,
                roughness:      m.roughness,
                emissive:       Some(m.emissive.to_array()),
            });
```

Find the `entities.push(SceneEntityData { ... });` block (~line 1529). Change:
```rust
            entities.push(SceneEntityData {
                transform, mesh_renderer, material, rigid_body, collider_aabb, point_light,
            });
```
To:
```rust
            entities.push(SceneEntityData {
                transform, mesh_renderer, material, rigid_body, collider_aabb, point_light,
                mesh_type: self.mesh_renderers.get(id).map(|mr| match mr.mesh_type {
                    MeshType::Cube  => "cube".to_string(),
                    MeshType::Plane => "plane".to_string(),
                    _               => "cube".to_string(),
                }),
                name: self.entity_names.get(&id).cloned(),
                tag:  self.tags.get(&id).cloned(),
            });
```

### Step 4: Fix `load_scene()` in `engine-core/src/lib.rs`

Find the emissive line (~line 1453) inside `if let Some(mat) = entity_data.material`:
```rust
                    emissive:   glam::Vec3::ZERO,
```
Change to:
```rust
                    emissive:   glam::Vec3::from(mat.emissive.unwrap_or([0.0, 0.0, 0.0])),
```

After the `if entity_data.mesh_renderer == Some(true)` block (~line 1431), add:
```rust
            if let Some(mt) = &entity_data.mesh_type {
                self.set_mesh_type(id, mt);
            }
            if let Some(name) = entity_data.name {
                self.set_entity_name(id, name);
            }
            if let Some(tag) = &entity_data.tag {
                self.set_tag(id, tag);
            }
```

### Step 5: Rebuild WASM

```bash
cd engine-core && wasm-pack build --target web
```
Expected: compiles with no errors, `engine-core/pkg/engine_core.js` is updated.

### Step 6: Commit

```bash
git add engine-core/src/scene.rs engine-core/src/lib.rs engine-core/pkg/
git commit -m "fix(engine): serialize emissive/mesh_type/names/tags, reset next_id on clear_scene"
```

---

## Task B: Fix Play/Stop Snapshot (CRITICAL BUG — do after A)

**Problem:** Stopping Play mode loses all componentStore data (Material PBR, RigidBody, etc.) because the snapshot only saves the engine JSON, not the editor metadata.

**Files:**
- Modify: `editor/src/components/Toolbar/Toolbar.tsx`
- Modify: `editor/src/store/editorStore.ts` (add `select` to imports)

---

### Step 1: Update `editor/src/components/Toolbar/Toolbar.tsx`

Replace the entire file:

```tsx
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
```

### Step 2: Add `select` to `editorStore.ts` exports

`select` is already in the store — the import in Toolbar uses `useEditorStore()` destructuring which includes `select`. No change needed to editorStore.ts.

### Step 3: Verify fix

1. Start editor, add a cube, set metallic=0.8 in Material panel
2. Click Play, then Stop
3. Verify: metallic is still 0.8, entity name unchanged

### Step 4: Commit

```bash
git add editor/src/components/Toolbar/Toolbar.tsx
git commit -m "fix(editor): include editorMeta in play/stop snapshot to preserve component data"
```

---

## Task C: Gizmos Rotate + Scale + Viewport UX

**Problem:** Rotate and Scale gizmos return early (gizmoMode check). Also: no click-to-select in viewport, no F-to-frame camera.

**Files:**
- Modify: `editor/src/utils/gizmo.ts`
- Modify: `editor/src/components/Viewport/GizmoOverlay.tsx`
- Modify: `editor/src/components/Viewport/Viewport.tsx` (F key + click-select)

---

### Step 1: Update `editor/src/utils/gizmo.ts`

Replace the entire file:

```typescript
import type { GizmoMode } from '../store/editorStore';

export function project(
  worldPos: [number, number, number],
  viewProj: Float32Array,
  width: number,
  height: number,
): [number, number] | null {
  const [x, y, z] = worldPos;
  const m = viewProj;
  const cx = m[0]*x + m[4]*y + m[8]*z  + m[12];
  const cy = m[1]*x + m[5]*y + m[9]*z  + m[13];
  const cz = m[2]*x + m[6]*y + m[10]*z + m[14];
  const cw = m[3]*x + m[7]*y + m[11]*z + m[15];
  if (Math.abs(cw) < 1e-6) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  if (ndcZ < -1 || ndcZ > 1) return null;
  return [
    (ndcX * 0.5 + 0.5) * width,
    (1 - (ndcY * 0.5 + 0.5)) * height,
  ];
}

export const AXIS_COLORS = ['#e74c3c', '#2ecc71', '#3498db'] as const;
export const AXIS_DIRS: [number, number, number][] = [[1,0,0],[0,1,0],[0,0,1]];
export const HANDLE_R = 7;
export const ROTATE_RADII = [35, 47, 59]; // px for X, Y, Z arcs

export function drawTranslateGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
  tips: ([number, number] | null)[],
) {
  tips.forEach((tip, i) => {
    if (!tip) return;
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.strokeStyle = AXIS_COLORS[i];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = AXIS_COLORS[i];
    ctx.fill();
  });
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export function drawRotateGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
) {
  ROTATE_RADII.forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], r, 0, Math.PI * 2);
    ctx.strokeStyle = AXIS_COLORS[i];
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export function drawScaleGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
  tips: ([number, number] | null)[],
) {
  tips.forEach((tip, i) => {
    if (!tip) return;
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.strokeStyle = AXIS_COLORS[i];
    ctx.lineWidth = 2;
    ctx.stroke();
    // Draw square handle
    const s = HANDLE_R;
    ctx.fillStyle = AXIS_COLORS[i];
    ctx.fillRect(tip[0] - s/2, tip[1] - s/2, s, s);
  });
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export function hitTestTranslate(
  mx: number, my: number,
  tips: ([number, number] | null)[],
): number | null {
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i];
    if (!tip) continue;
    if (Math.hypot(mx - tip[0], my - tip[1]) < HANDLE_R + 4) return i;
  }
  return null;
}

export function hitTestRotate(
  mx: number, my: number,
  origin: [number, number],
): number | null {
  const dist = Math.hypot(mx - origin[0], my - origin[1]);
  for (let i = 0; i < ROTATE_RADII.length; i++) {
    if (Math.abs(dist - ROTATE_RADII[i]) < 6) return i;
  }
  return null;
}

export function hitTestScale(
  mx: number, my: number,
  tips: ([number, number] | null)[],
): number | null {
  const s = HANDLE_R + 4;
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i];
    if (!tip) continue;
    if (Math.abs(mx - tip[0]) < s && Math.abs(my - tip[1]) < s) return i;
  }
  return null;
}
```

### Step 2: Rewrite `editor/src/components/Viewport/GizmoOverlay.tsx`

Replace the entire file:

```tsx
import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { bridge } from '../../engine/engineBridge';
import {
  project, AXIS_COLORS, AXIS_DIRS,
  drawTranslateGizmo, drawRotateGizmo, drawScaleGizmo,
  hitTestTranslate, hitTestRotate, hitTestScale,
} from '../../utils/gizmo';

const HANDLE_R = 7;

export default function GizmoOverlay({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragAxis  = useRef<number | null>(null);
  const dragStart = useRef<[number, number]>([0, 0]);

  const selectedId  = useEditorStore(s => s.selectedId);
  const gizmoMode   = useEditorStore(s => s.gizmoMode);
  const isPlaying   = useEditorStore(s => s.isPlaying);
  const select      = useEditorStore(s => s.select);
  const entity      = useSceneStore(s => s.entities.find(e => e.id === selectedId));
  const entities    = useSceneStore(s => s.entities);
  const updatePos   = useSceneStore(s => s.updatePosition);
  const updateRot   = useSceneStore(s => s.updateRotation);
  const updateScale = useSceneStore(s => s.updateScale);

  const getScreenData = useCallback(() => {
    if (!bridge.isReady) return null;
    const vp     = bridge.getViewProj();
    if (!entity) return { vp, origin: null as null, tips: [] as ([number,number]|null)[] };
    const origin = project(entity.transform.position, vp, width, height);
    if (!origin) return null;
    const tips = AXIS_DIRS.map(dir => {
      const tip: [number,number,number] = [
        entity.transform.position[0] + dir[0],
        entity.transform.position[1] + dir[1],
        entity.transform.position[2] + dir[2],
      ];
      return project(tip, vp, width, height);
    });
    return { vp, origin, tips };
  }, [entity, width, height]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (!entity || isPlaying) return;
    const data = getScreenData();
    if (!data?.origin) return;
    const { origin, tips } = data;
    if (gizmoMode === 'translate') drawTranslateGizmo(ctx, origin, tips);
    else if (gizmoMode === 'rotate') drawRotateGizmo(ctx, origin);
    else if (gizmoMode === 'scale')  drawScaleGizmo(ctx, origin, tips);
  }, [entity, gizmoMode, isPlaying, width, height, getScreenData]);

  // Click-to-select + drag
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isPlaying || !bridge.isReady) return;

    const onDown = (e: MouseEvent) => {
      const data = getScreenData();
      let hitAxis: number | null = null;

      if (data?.origin) {
        if (gizmoMode === 'translate') hitAxis = hitTestTranslate(e.offsetX, e.offsetY, data.tips);
        else if (gizmoMode === 'rotate') hitAxis = hitTestRotate(e.offsetX, e.offsetY, data.origin);
        else if (gizmoMode === 'scale')  hitAxis = hitTestScale(e.offsetX, e.offsetY, data.tips);
      }

      if (hitAxis !== null) {
        dragAxis.current  = hitAxis;
        dragStart.current = [e.clientX, e.clientY];
        e.stopPropagation();
        return;
      }

      // Click-to-select: find nearest entity on screen
      if (!e.defaultPrevented) {
        const vp = bridge.getViewProj();
        let bestId: number | null = null;
        let bestDist = 20; // min pixel distance to select
        for (const ent of entities) {
          const sp = project(ent.transform.position, vp, width, height);
          if (!sp) continue;
          const d = Math.hypot(e.offsetX - sp[0], e.offsetY - sp[1]);
          if (d < bestDist) { bestDist = d; bestId = ent.id; }
        }
        if (bestId !== null) select(bestId);
      }
    };

    const onMove = (e: MouseEvent) => {
      const axis = dragAxis.current;
      if (axis === null || !entity) return;
      const dx = e.clientX - dragStart.current[0];
      const dy = e.clientY - dragStart.current[1];
      dragStart.current = [e.clientX, e.clientY];
      const delta = (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * 0.02;

      if (gizmoMode === 'translate') {
        const [px, py, pz] = entity.transform.position;
        updatePos(entity.id,
          px + (axis === 0 ? delta : 0),
          py + (axis === 1 ? delta : 0),
          pz + (axis === 2 ? delta : 0),
        );
      } else if (gizmoMode === 'rotate') {
        const [rx, ry, rz] = entity.transform.rotation;
        const deg = delta * 2; // scale drag to degrees
        updateRot(entity.id,
          rx + (axis === 0 ? deg : 0),
          ry + (axis === 1 ? deg : 0),
          rz + (axis === 2 ? deg : 0),
        );
      } else if (gizmoMode === 'scale') {
        const [sx, sy, sz] = entity.transform.scale;
        const scale = 1 + delta * 0.5;
        updateScale(entity.id,
          sx * (axis === 0 ? scale : 1),
          sy * (axis === 1 ? scale : 1),
          sz * (axis === 2 ? scale : 1),
        );
      }
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
  }, [entity, entities, gizmoMode, isPlaying, getScreenData, select, updatePos, updateRot, updateScale, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: isPlaying ? 'none' : 'auto' }}
    />
  );
}
```

### Step 3: Add F-to-frame in Viewport

In `editor/src/components/Viewport/Viewport.tsx`, in the keyboard effect (the one handling W/E/R shortcuts), add:

```typescript
if (e.key === 'f' || e.key === 'F') {
  // Frame selected entity
  const sel = useEditorStore.getState().selectedId;
  if (sel !== null) {
    const t = bridge.getTransform(sel);
    const [px, py, pz] = t.position;
    bridge.setCamera(px + 3, py + 3, pz + 3, px, py, pz);
  }
}
```

### Step 4: Commit

```bash
git add editor/src/utils/gizmo.ts editor/src/components/Viewport/GizmoOverlay.tsx editor/src/components/Viewport/Viewport.tsx
git commit -m "feat(editor): implement rotate+scale gizmos, click-to-select, F-to-frame"
```

---

## Task D: SceneGraph UX (Rename, Duplicate, Shortcuts, Search)

**Files:**
- Modify: `editor/src/components/SceneGraph/SceneGraph.tsx`
- Modify: `editor/src/store/sceneStore.ts` (add duplicateEntity)

---

### Step 1: Add `duplicateEntity` to `editor/src/store/sceneStore.ts`

After `removeEntity` (~line 39), add:

```typescript
  duplicateEntity: (id: EntityId) => {
    const src = get().entities.find(e => e.id === id);
    if (!src) return null;
    const newId = bridge.createEntity(src.name + ' (copy)');
    bridge.addMeshRenderer(newId);
    const t = src.transform;
    bridge.setPosition(newId, t.position[0] + 0.5, t.position[1], t.position[2]);
    bridge.setRotation(newId, t.rotation[0], t.rotation[1], t.rotation[2]);
    bridge.setScale(newId, t.scale[0], t.scale[1], t.scale[2]);
    // Copy mesh type
    const mt = bridge.getMeshType(id);
    bridge.setMeshType(newId, mt);
    get().refresh();
    return newId;
  },
```

Also add `duplicateEntity: (id: EntityId) => EntityId | null` to the interface.

### Step 2: Rewrite `editor/src/components/SceneGraph/SceneGraph.tsx`

Replace the entire file:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useEditorStore } from '../../store/editorStore';
import { bridge } from '../../engine/engineBridge';

const s: Record<string, React.CSSProperties> = {
  root:   { height: '100%', display: 'flex', flexDirection: 'column' },
  header: { padding: '5px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' },
  list:   { flex: 1, overflow: 'auto' },
  item:   { padding: '4px 8px 4px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  addBtn: { background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 7px', fontSize: 11 },
  search: { width: '100%', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', padding: '3px 6px', fontSize: 11, boxSizing: 'border-box' },
};

export default function SceneGraph() {
  const entities         = useSceneStore(s => s.entities);
  const addEntity        = useSceneStore(s => s.addEntity);
  const removeEntity     = useSceneStore(s => s.removeEntity);
  const duplicateEntity  = useSceneStore(s => s.duplicateEntity);
  const refresh          = useSceneStore(s => s.refresh);
  const selectedId       = useEditorStore(s => s.selectedId);
  const select           = useEditorStore(s => s.select);
  const setGizmoMode     = useEditorStore(s => s.setGizmoMode);

  const [search, setSearch]     = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal]   = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : entities;

  const startRename = (id: number, name: string) => {
    setRenamingId(id);
    setRenameVal(name);
    setTimeout(() => renameRef.current?.select(), 10);
  };

  const commitRename = () => {
    if (renamingId !== null && renameVal.trim()) {
      bridge.setEntityName(renamingId, renameVal.trim());
      refresh();
    }
    setRenamingId(null);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
      if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
      if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
        removeEntity(selectedId);
        select(null);
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D') && selectedId !== null) {
        e.preventDefault();
        const newId = duplicateEntity(selectedId);
        if (newId !== null) select(newId);
      }
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        // Trigger save (dispatch custom event caught by MenuBar)
        document.dispatchEvent(new CustomEvent('editor:save'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select, removeEntity, duplicateEntity, setGizmoMode]);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span>Scene</span>
        <button style={s.addBtn} onClick={() => { const id = addEntity(); select(id); }} title="Add Entity">+</button>
      </div>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
        <input
          style={s.search}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div style={s.list}>
        {filtered.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--text-dim)', fontSize: 11 }}>
            {search ? 'No results' : 'Empty scene — click + to add'}
          </div>
        )}
        {filtered.map(e => (
          <div
            key={e.id}
            style={{
              ...s.item,
              background: e.id === selectedId ? 'var(--bg-select)' : 'transparent',
              color:      e.id === selectedId ? '#fff' : 'var(--text)',
            }}
            onClick={() => select(e.id)}
            onDoubleClick={() => startRename(e.id, e.name)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              removeEntity(e.id);
              if (selectedId === e.id) select(null);
            }}
            title="Double-click to rename | Right-click to delete | Ctrl+D to duplicate"
          >
            <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>▸</span>
            {renamingId === e.id ? (
              <input
                ref={renameRef}
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--accent)', color: '#fff', borderRadius: 2, padding: '0 4px', fontSize: 12, width: '80%' }}
                value={renameVal}
                onChange={ev => setRenameVal(ev.target.value)}
                onBlur={commitRename}
                onKeyDown={ev => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenamingId(null); }}
                onClick={ev => ev.stopPropagation()}
              />
            ) : e.name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 3: Add Ctrl+S handler to MenuBar

In `editor/src/components/MenuBar/MenuBar.tsx`, add in the component body:

```typescript
  useEffect(() => {
    const onSave = () => handleSave();
    document.addEventListener('editor:save', onSave);
    return () => document.removeEventListener('editor:save', onSave);
  }, []);
```

### Step 4: Commit

```bash
git add editor/src/components/SceneGraph/SceneGraph.tsx editor/src/store/sceneStore.ts editor/src/components/MenuBar/MenuBar.tsx
git commit -m "feat(editor): inline rename, duplicate, search, Delete/Ctrl+D/Ctrl+S shortcuts in SceneGraph"
```

---

## Task E: Assets & Materials (Texture Picker, Color, assetStore)

**Problem:** `applyToSelected` in AssetBrowser calls `addMaterial` (non-PBR, doesn't update componentStore). MaterialPanel has no texture picker. Assets are only in local state (lost on page reload).

**Files:**
- Create: `editor/src/store/assetStore.ts`
- Modify: `editor/src/components/AssetBrowser/AssetBrowser.tsx`
- Modify: `editor/src/components/Inspector/panels/MaterialPanel.tsx`

---

### Step 1: Create `editor/src/store/assetStore.ts`

```typescript
import { create } from 'zustand';

export interface AssetItem {
  name:  string;
  url:   string;
  texId: number;
}

interface AssetState {
  assets: AssetItem[];
  addAsset: (a: AssetItem) => void;
  clear: () => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  addAsset: (a) => set(s => ({ assets: [...s.assets, a] })),
  clear:    () => set({ assets: [] }),
}));
```

### Step 2: Update `editor/src/components/AssetBrowser/AssetBrowser.tsx`

Replace entire file:

```tsx
import React, { useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';
import { useAssetStore } from '../../store/assetStore';
import { useComponentStore } from '../../store/componentStore';
import type { MaterialData } from '../../engine/types';

export default function AssetBrowser() {
  const assets     = useAssetStore(s => s.assets);
  const addAsset   = useAssetStore(s => s.addAsset);
  const fileRef    = useRef<HTMLInputElement>(null);
  const selectedId = useEditorStore(s => s.selectedId);

  const importTextures = async (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      const bitmap    = await createImageBitmap(file);
      const offscreen = document.createElement('canvas');
      offscreen.width  = bitmap.width;
      offscreen.height = bitmap.height;
      const ctx       = offscreen.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data }  = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const texId     = bridge.uploadTexture(bitmap.width, bitmap.height, data);
      if (texId >= 0) addAsset({ name: file.name, url: URL.createObjectURL(file), texId });
    }
    e.target.value = '';
  };

  const applyToSelected = (texId: number) => {
    if (selectedId === null) return;
    // Get or create material data in component store
    const existing = useComponentStore.getState().getComponents(selectedId).material ?? {
      texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0] as [number,number,number],
    };
    const next: MaterialData = { ...existing, texId };
    useComponentStore.getState().setComponent(selectedId, 'material', next);
    bridge.addPbrMaterial(selectedId, texId, next.metallic, next.roughness);
    bridge.setEmissive(selectedId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>
        <span>Assets</span>
        <button
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 11 }}
          onClick={() => fileRef.current?.click()}
        >+ Import</button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={importTextures} />
        {selectedId === null && assets.length > 0 && (
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', fontSize: 10 }}>— select an entity first</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, flex: 1, overflowY: 'auto' }}>
        {assets.map((a, i) => (
          <div
            key={i}
            title={`Apply ${a.name}`}
            onClick={() => applyToSelected(a.texId)}
            style={{ width: 64, cursor: selectedId !== null ? 'pointer' : 'default', textAlign: 'center', opacity: selectedId !== null ? 1 : 0.5 }}
          >
            <img src={a.url} alt={a.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)', display: 'block' }} />
            <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 3: Update `editor/src/components/Inspector/panels/MaterialPanel.tsx`

Replace entire file:

```tsx
import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { useAssetStore } from '../../../store/assetStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, MaterialData } from '../../../engine/types';

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} style={{ width: 80 }} />
      <span style={{ color: 'var(--text-dim)', width: 32, textAlign: 'right' }}>{value.toFixed(2)}</span>
    </div>
  );
}

function ColorRow({ label, r, g, b, onChange }: {
  label: string; r: number; g: number; b: number;
  onChange: (r: number, g: number, b: number) => void;
}) {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  const hexColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>{label}</span>
      <input
        type="color"
        value={hexColor}
        onChange={e => {
          const hex = e.target.value;
          const r = parseInt(hex.slice(1,3), 16) / 255;
          const g = parseInt(hex.slice(3,5), 16) / 255;
          const b = parseInt(hex.slice(5,7), 16) / 255;
          onChange(r, g, b);
        }}
        style={{ width: 40, height: 22, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3 }}
      />
      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{hexColor}</span>
    </div>
  );
}

export default function MaterialPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const assets = useAssetStore(s => s.assets);
  const mat: MaterialData = getComponents(entityId).material ?? {
    texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0],
  };

  const apply = (next: MaterialData) => {
    setComponent(entityId, 'material', next);
    bridge.addPbrMaterial(entityId, next.texId, next.metallic, next.roughness);
    bridge.setEmissive(entityId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  const currentTexName = assets.find(a => a.texId === mat.texId)?.name ?? 'None';

  return (
    <PanelSection title="Material (PBR)" onRemove={() => removeComponent(entityId, 'material')}>
      {/* Texture picker */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 11, gap: 4 }}>
        <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>Albedo</span>
        <select
          value={mat.texId}
          onChange={e => apply({ ...mat, texId: parseInt(e.target.value) })}
          style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '2px 4px', fontSize: 11 }}
        >
          <option value={-1}>None (white)</option>
          {assets.map(a => (
            <option key={a.texId} value={a.texId}>{a.name}</option>
          ))}
        </select>
      </div>
      <SliderRow label="Metallic"  value={mat.metallic}  min={0} max={1} step={0.01} onChange={v => apply({ ...mat, metallic: v })} />
      <SliderRow label="Roughness" value={mat.roughness} min={0} max={1} step={0.01} onChange={v => apply({ ...mat, roughness: v })} />
      <ColorRow  label="Emissive"  r={mat.emissive[0]} g={mat.emissive[1]} b={mat.emissive[2]}
        onChange={(r,g,b) => apply({ ...mat, emissive: [r,g,b] })} />
    </PanelSection>
  );
}
```

### Step 4: Update types.ts to ensure MaterialData.emissive is typed

In `editor/src/engine/types.ts`, ensure `MaterialData` has `emissive: [number, number, number]`. Check and update if needed.

### Step 5: Commit

```bash
git add editor/src/store/assetStore.ts editor/src/components/AssetBrowser/AssetBrowser.tsx editor/src/components/Inspector/panels/MaterialPanel.tsx
git commit -m "feat(editor): shared assetStore, texture picker in MaterialPanel, color picker for emissive, fix applyToSelected"
```

---

## Task F: 3D Model Import (OBJ + GLB)

**Files:**
- Create: `editor/src/engine/parsers/parseObj.ts`
- Create: `editor/src/engine/parsers/parseGltf.ts`
- Modify: `engine-core/src/ecs/components.rs` — add `MeshType::Custom(usize)`
- Modify: `engine-core/src/lib.rs` — add `custom_meshes`, `upload_custom_mesh`, render Custom
- Modify: `editor/src/engine/engineBridge.ts` — add `uploadCustomMesh`
- Modify: `editor/src/components/AssetBrowser/AssetBrowser.tsx` — add 3D import button
- Rebuild WASM

---

### Step 1: Create `editor/src/engine/parsers/parseObj.ts`

```typescript
export interface ParsedMesh {
  vertices: Float32Array; // 15 floats/vertex: pos3 color3 uv2 normal3 tangent4
  indices:  Uint32Array;
}

export function parseObj(text: string): ParsedMesh {
  const positions: [number,number,number][] = [];
  const normals:   [number,number,number][] = [];
  const uvs:       [number,number][]        = [];

  const vertData: number[] = [];
  const idxData:  number[] = [];
  const vmap = new Map<string, number>();

  const addVertex = (key: string, vi: number, ti: number, ni: number) => {
    if (vmap.has(key)) return vmap.get(key)!;
    const p = positions[vi] ?? [0,0,0];
    const u = uvs[ti]       ?? [0,0];
    const n = normals[ni]   ?? [0,1,0];
    const idx = vertData.length / 15;
    vertData.push(p[0],p[1],p[2], 1,1,1, u[0],1-u[1], n[0],n[1],n[2], 1,0,0,1);
    vmap.set(key, idx);
    return idx;
  };

  for (const rawLine of text.split('\n')) {
    const line  = rawLine.trim();
    const parts = line.split(/\s+/);
    if (parts[0] === 'v')  positions.push([+parts[1],+parts[2],+parts[3]]);
    else if (parts[0] === 'vn') normals.push([+parts[1],+parts[2],+parts[3]]);
    else if (parts[0] === 'vt') uvs.push([+parts[1],+parts[2]]);
    else if (parts[0] === 'f') {
      const face: number[] = [];
      for (const tok of parts.slice(1)) {
        const [vi,ti,ni] = tok.split('/').map(s => parseInt(s) - 1);
        face.push(addVertex(tok, vi, ti ?? -1, ni ?? -1));
      }
      for (let i = 1; i < face.length - 1; i++) {
        idxData.push(face[0], face[i], face[i+1]);
      }
    }
  }

  return { vertices: new Float32Array(vertData), indices: new Uint32Array(idxData) };
}
```

### Step 2: Create `editor/src/engine/parsers/parseGltf.ts`

```typescript
import type { ParsedMesh } from './parseObj';

export async function parseGlb(buffer: ArrayBuffer): Promise<ParsedMesh> {
  const view   = new DataView(buffer);
  const magic  = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a GLB file');

  const jsonLen  = view.getUint32(12, true);
  const jsonText = new TextDecoder().decode(buffer.slice(20, 20 + jsonLen));
  const gltf     = JSON.parse(jsonText);

  const binStart = 20 + jsonLen + 8; // skip BIN chunk header
  const bin      = buffer.slice(binStart);

  const getAccessorData = (accIdx: number): Float32Array | Uint16Array | Uint32Array => {
    const acc   = gltf.accessors[accIdx];
    const bv    = gltf.bufferViews[acc.bufferView];
    const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const count = acc.count;
    if (acc.componentType === 5126) return new Float32Array(bin, start, count * typeStride(acc.type));
    if (acc.componentType === 5123) return new Uint16Array(bin, start, count);
    if (acc.componentType === 5125) return new Uint32Array(bin, start, count);
    throw new Error('Unsupported componentType: ' + acc.componentType);
  };

  const typeStride = (type: string) => ({ SCALAR:1, VEC2:2, VEC3:3, VEC4:4 }[type] ?? 1);

  // First mesh, first primitive
  const prim = gltf.meshes[0].primitives[0];
  const pos  = getAccessorData(prim.attributes.POSITION)   as Float32Array;
  const nor  = prim.attributes.NORMAL    != null ? getAccessorData(prim.attributes.NORMAL)       as Float32Array : null;
  const uv   = prim.attributes.TEXCOORD_0 != null ? getAccessorData(prim.attributes.TEXCOORD_0) as Float32Array : null;
  const rawIdx = getAccessorData(prim.indices);
  const indices = new Uint32Array(rawIdx.length);
  for (let i = 0; i < rawIdx.length; i++) indices[i] = rawIdx[i];

  const vcount = pos.length / 3;
  const vdata  = new Float32Array(vcount * 15);
  for (let i = 0; i < vcount; i++) {
    const o = i * 15;
    vdata[o]   = pos[i*3];   vdata[o+1] = pos[i*3+1]; vdata[o+2] = pos[i*3+2];
    vdata[o+3] = 1; vdata[o+4] = 1; vdata[o+5] = 1; // white
    vdata[o+6] = uv ? uv[i*2] : 0;
    vdata[o+7] = uv ? 1 - uv[i*2+1] : 0;
    vdata[o+8]  = nor ? nor[i*3]   : 0;
    vdata[o+9]  = nor ? nor[i*3+1] : 1;
    vdata[o+10] = nor ? nor[i*3+2] : 0;
    vdata[o+11] = 1; vdata[o+12] = 0; vdata[o+13] = 0; vdata[o+14] = 1; // tangent
  }

  return { vertices: vdata, indices };
}
```

### Step 3: Update `engine-core/src/ecs/components.rs`

Change `MeshType` enum:
```rust
#[derive(Debug, Clone, PartialEq, Default)]
pub enum MeshType {
    #[default]
    Cube,
    Plane,
    Custom(usize),  // index into World::custom_meshes
}
```

### Step 4: Add `custom_meshes` to World in `engine-core/src/lib.rs`

In the World struct definition (around line 95), add after the existing fields:
```rust
    custom_meshes: Vec<(wgpu::Buffer, wgpu::Buffer, u32)>, // (vbuf, ibuf, index_count)
```

In `World::new()`, initialize:
```rust
    custom_meshes: Vec::new(),
```

### Step 5: Add `upload_custom_mesh` WASM binding in `engine-core/src/lib.rs`

In the `#[wasm_bindgen] impl World` block, add a new method:

```rust
    /// Upload custom mesh vertices (flat f32: 15 per vertex) and u32 indices.
    /// Returns the custom mesh index (pass to set_mesh_type as "custom:{idx}").
    pub fn upload_custom_mesh(&mut self, vertices: &[f32], indices: &[u32]) -> usize {
        use std::mem;
        // Reinterpret flat f32 slice as Vertex slice
        // Safety: Vertex is #[repr(C)] Pod, 15 f32 = 60 bytes
        assert!(vertices.len() % 15 == 0, "vertices must be multiple of 15 floats");
        let vbuf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("custom_vbuf"),
            contents: bytemuck::cast_slice(vertices),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let ibuf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("custom_ibuf"),
            contents: bytemuck::cast_slice(indices),
            usage:    wgpu::BufferUsages::INDEX,
        });
        let idx = self.custom_meshes.len();
        self.custom_meshes.push((vbuf, ibuf, indices.len() as u32));
        idx
    }
```

Also update `set_mesh_type` to accept `"custom:N"` format:
```rust
    pub fn set_mesh_type(&mut self, id: usize, mesh_type: &str) {
        let mt = if let Some(n) = mesh_type.strip_prefix("custom:") {
            MeshType::Custom(n.parse().unwrap_or(0))
        } else {
            match mesh_type {
                "plane" => MeshType::Plane,
                _       => MeshType::Cube,
            }
        };
        if let Some(mr) = self.mesh_renderers.get_mut(id) {
            mr.mesh_type = mt;
        }
    }
```

And `get_mesh_type` to return `"custom:N"`:
```rust
    pub fn get_mesh_type(&self, id: usize) -> String {
        match self.mesh_renderers.get(id) {
            Some(mr) => match &mr.mesh_type {
                MeshType::Cube       => "cube".to_string(),
                MeshType::Plane      => "plane".to_string(),
                MeshType::Custom(n)  => format!("custom:{}", n),
            },
            None => "cube".to_string(),
        }
    }
```

### Step 6: Update `render_frame` to handle Custom mesh

In the render loop inside `render_frame` (where it matches `MeshType::Cube`/`MeshType::Plane`), find the block that sets `(vertices_slice, indices_slice)` and add a Custom case. The render loop does something like:

```rust
let (vbuf_ref, ibuf_ref, idx_count) = match &mr.mesh_type {
    MeshType::Cube  => (&self.cube_vbuf,  &self.cube_ibuf,  CUBE_INDICES.len() as u32),
    MeshType::Plane => (&self.plane_vbuf, &self.plane_ibuf, PLANE_INDICES.len() as u32),
    MeshType::Custom(n) => {
        if let Some(cm) = self.custom_meshes.get(*n) {
            (&cm.0, &cm.1, cm.2)
        } else {
            (&self.cube_vbuf, &self.cube_ibuf, CUBE_INDICES.len() as u32)
        }
    }
};
```

Find the exact match in `render_frame` that references `CUBE_VERTICES`/`PLANE_VERTICES` and adapt it.

### Step 7: Add `uploadCustomMesh` to `editor/src/engine/engineBridge.ts`

After `setMeshType`:
```typescript
  uploadCustomMesh(vertices: Float32Array, indices: Uint32Array): number {
    return this.world?.upload_custom_mesh(vertices, indices) ?? -1;
  }
```

### Step 8: Add 3D model import to `editor/src/components/AssetBrowser/AssetBrowser.tsx`

Add a second file input for 3D models:

```tsx
  const modelRef = useRef<HTMLInputElement>(null);

  const import3dModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    let mesh;
    try {
      if (file.name.endsWith('.glb')) {
        const { parseGlb } = await import('../../engine/parsers/parseGltf');
        mesh = await parseGlb(buffer);
      } else if (file.name.endsWith('.obj')) {
        const { parseObj } = await import('../../engine/parsers/parseObj');
        mesh = parseObj(new TextDecoder().decode(buffer));
      } else {
        alert('Unsupported format. Use .obj or .glb');
        return;
      }
    } catch (err) {
      alert('Parse error: ' + err);
      return;
    }
    const meshIdx = bridge.uploadCustomMesh(mesh.vertices, mesh.indices);
    // Auto-create entity with this mesh
    const { addEntity } = useSceneStore.getState();
    const { select }    = useEditorStore.getState();
    const id = addEntity(file.name.replace(/\.\w+$/, ''));
    bridge.setMeshType(id, `custom:${meshIdx}`);
    select(id);
    e.target.value = '';
  };
```

Add the button and hidden input to the JSX header area:
```tsx
        <button
          style={{ background: 'none', border: '1px solid var(--border)', color: '#9b59b6', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 11 }}
          onClick={() => modelRef.current?.click()}
        >+ 3D Model</button>
        <input ref={modelRef} type="file" accept=".obj,.glb" style={{ display: 'none' }} onChange={import3dModel} />
```

Also add imports: `import { useSceneStore } from '../../store/sceneStore';`

### Step 9: Rebuild WASM

```bash
cd engine-core && wasm-pack build --target web
```

### Step 10: Commit

```bash
git add engine-core/src/ engine-core/pkg/ editor/src/engine/parsers/ editor/src/engine/engineBridge.ts editor/src/components/AssetBrowser/
git commit -m "feat: 3D model import — OBJ + GLB parsers, Rust custom mesh upload, MeshType::Custom"
```

---

## Task G: Engine Extensions (Sphere, Cylinder, Ambient, Velocity)

**Files:**
- Modify: `engine-core/src/ecs/components.rs` — add Sphere, Cylinder to MeshType
- Modify: `engine-core/src/mesh.rs` — add `generate_sphere`, `generate_cylinder`
- Modify: `engine-core/src/lib.rs` — add sphere/cylinder buffers, set_ambient_light, get/set_velocity
- Modify: `engine-core/src/shader.wgsl` — add ambient to LightUniforms
- Modify: `editor/src/engine/engineBridge.ts` — expose new bindings
- Modify: `editor/src/components/Inspector/panels/MeshPanel.tsx` (or wherever mesh type is shown)
- Rebuild WASM

---

### Step 1: Add Sphere + Cylinder to MeshType enum in `engine-core/src/ecs/components.rs`

```rust
#[derive(Debug, Clone, PartialEq, Default)]
pub enum MeshType {
    #[default]
    Cube,
    Plane,
    Custom(usize),
    Sphere,
    Cylinder,
}
```

### Step 2: Add mesh generators to `engine-core/src/mesh.rs`

Append to the file:

```rust
/// Generates a UV sphere with `segs` segments (radius = 0.5).
pub fn generate_sphere(segs: u32) -> (Vec<Vertex>, Vec<u32>) {
    let lat = segs;
    let lon = segs * 2;
    let mut verts: Vec<Vertex> = Vec::new();
    let mut idx:   Vec<u32>   = Vec::new();

    for i in 0..=lat {
        let theta     = std::f32::consts::PI * i as f32 / lat as f32;
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        for j in 0..=lon {
            let phi     = 2.0 * std::f32::consts::PI * j as f32 / lon as f32;
            let sin_phi = phi.sin();
            let cos_phi = phi.cos();
            let x = sin_theta * cos_phi;
            let y = cos_theta;
            let z = sin_theta * sin_phi;
            verts.push(Vertex {
                position: [x * 0.5, y * 0.5, z * 0.5],
                color:    [1.0, 1.0, 1.0],
                uv:       [j as f32 / lon as f32, i as f32 / lat as f32],
                normal:   [x, y, z],
                tangent:  [-sin_phi, 0.0, cos_phi, 1.0],
            });
        }
    }

    for i in 0..lat {
        for j in 0..lon {
            let c = i * (lon + 1) + j;
            let n = c + lon + 1;
            idx.extend_from_slice(&[c, n, c + 1, n, n + 1, c + 1]);
        }
    }

    (verts, idx)
}

/// Generates a cylinder with `segs` segments, height=1, radius=0.5.
pub fn generate_cylinder(segs: u32) -> (Vec<Vertex>, Vec<u32>) {
    let mut verts: Vec<Vertex> = Vec::new();
    let mut idx:   Vec<u32>   = Vec::new();
    let r = 0.5_f32;
    let h = 0.5_f32;

    // Side vertices (2 rings: bottom + top)
    for ring in 0..=1 {
        let y = if ring == 0 { -h } else { h };
        let ny = if ring == 0 { 0.0 } else { 0.0 }; // side normal Y
        for j in 0..=segs {
            let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
            let (s, c) = angle.sin_cos();
            verts.push(Vertex {
                position: [r * c, y, r * s],
                color:    [1.0, 1.0, 1.0],
                uv:       [j as f32 / segs as f32, ring as f32],
                normal:   [c, ny, s],
                tangent:  [-s, 0.0, c, 1.0],
            });
        }
    }

    // Side indices
    let ring_verts = segs + 1;
    for j in 0..segs {
        let b = j;
        let t = j + ring_verts;
        idx.extend_from_slice(&[b, t, b+1, t, t+1, b+1]);
    }

    // Top cap
    let top_center = verts.len() as u32;
    verts.push(Vertex { position: [0.0, h, 0.0], color: [1.0,1.0,1.0], uv: [0.5,0.5], normal: [0.0,1.0,0.0], tangent: [1.0,0.0,0.0,1.0] });
    let top_start = verts.len() as u32;
    for j in 0..=segs {
        let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
        let (s, c) = angle.sin_cos();
        verts.push(Vertex { position: [r*c, h, r*s], color:[1.0,1.0,1.0], uv:[0.5+0.5*c,0.5+0.5*s], normal:[0.0,1.0,0.0], tangent:[1.0,0.0,0.0,1.0] });
    }
    for j in 0..segs { idx.extend_from_slice(&[top_center, top_start+j+1, top_start+j]); }

    // Bottom cap
    let bot_center = verts.len() as u32;
    verts.push(Vertex { position: [0.0, -h, 0.0], color: [1.0,1.0,1.0], uv: [0.5,0.5], normal: [0.0,-1.0,0.0], tangent: [1.0,0.0,0.0,1.0] });
    let bot_start = verts.len() as u32;
    for j in 0..=segs {
        let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
        let (s, c) = angle.sin_cos();
        verts.push(Vertex { position: [r*c, -h, r*s], color:[1.0,1.0,1.0], uv:[0.5+0.5*c,0.5+0.5*s], normal:[0.0,-1.0,0.0], tangent:[1.0,0.0,0.0,1.0] });
    }
    for j in 0..segs { idx.extend_from_slice(&[bot_center, bot_start+j, bot_start+j+1]); }

    (verts, idx)
}
```

### Step 3: Add sphere + cylinder buffers to World in `engine-core/src/lib.rs`

In World struct, add:
```rust
    sphere_vbuf:   wgpu::Buffer,
    sphere_ibuf:   wgpu::Buffer,
    sphere_ilen:   u32,
    cylinder_vbuf: wgpu::Buffer,
    cylinder_ibuf: wgpu::Buffer,
    cylinder_ilen: u32,
    ambient_color: glam::Vec3,
    ambient_intensity: f32,
```

In `World::new()`, after cube/plane buffer creation:
```rust
        use mesh::{generate_sphere, generate_cylinder};
        let (sv, si) = generate_sphere(16);
        let sphere_vbuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sphere_vbuf"), contents: bytemuck::cast_slice(&sv), usage: wgpu::BufferUsages::VERTEX,
        });
        let sphere_ibuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sphere_ibuf"), contents: bytemuck::cast_slice(&si), usage: wgpu::BufferUsages::INDEX,
        });
        let sphere_ilen = si.len() as u32;
        let (cv, ci) = generate_cylinder(16);
        let cylinder_vbuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("cyl_vbuf"), contents: bytemuck::cast_slice(&cv), usage: wgpu::BufferUsages::VERTEX,
        });
        let cylinder_ibuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("cyl_ibuf"), contents: bytemuck::cast_slice(&ci), usage: wgpu::BufferUsages::INDEX,
        });
        let cylinder_ilen = ci.len() as u32;
```

Initialize in the World { ... } struct literal:
```rust
    sphere_vbuf, sphere_ibuf, sphere_ilen,
    cylinder_vbuf, cylinder_ibuf, cylinder_ilen,
    ambient_color: glam::Vec3::new(0.1, 0.1, 0.1),
    ambient_intensity: 0.5,
```

Add WASM bindings:
```rust
    pub fn set_ambient_light(&mut self, r: f32, g: f32, b: f32, intensity: f32) {
        self.ambient_color     = glam::Vec3::new(r, g, b);
        self.ambient_intensity = intensity;
    }

    pub fn get_velocity(&self, id: usize) -> js_sys::Float32Array {
        if let Some(rb) = self.rigid_bodies.get(id) {
            js_sys::Float32Array::from([rb.velocity.x, rb.velocity.y, rb.velocity.z].as_slice())
        } else {
            js_sys::Float32Array::from([0f32; 3].as_slice())
        }
    }

    pub fn set_velocity(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(rb) = self.rigid_bodies.get_mut(id) {
            rb.velocity = glam::Vec3::new(x, y, z);
        }
    }
```

Also update `set_mesh_type` and `get_mesh_type` to handle "sphere" and "cylinder".
Update the render loop's mesh type match to include `MeshType::Sphere` and `MeshType::Cylinder`.

### Step 4: Add ambient to shader `engine-core/src/shader.wgsl`

In the `LightUniforms` struct (around line 33), add:
```wgsl
struct LightUniforms {
    camera_pos:      vec4<f32>,
    directional:     GpuDirectionalLight,
    n_points:        u32,
    pad0: u32, pad1: u32, pad2: u32,
    points:          array<GpuPointLight, 8>,
    light_space_mat: mat4x4<f32>,
    ambient_color:   vec4<f32>,  // ADD: rgb + intensity in w
}
```

In the fragment shader `fs_main`, find where the final color is computed and add:
```wgsl
    let ambient = lights.ambient_color.rgb * lights.ambient_color.w;
    // Add ambient to the final color calculation before emissive:
    // final_color = (existing_diffuse_specular) + ambient * albedo_color.rgb + emissive
```

The exact insertion point depends on the shader structure — find the `return` or final color assignment and add `+ vec4(ambient * base_color.rgb, 0.0)`.

**IMPORTANT**: Also update the Rust `LightUniforms` struct in `lib.rs` to add `ambient_color: [f32; 4]` at the end, and update the `queue.write_buffer` call for the light uniform to include `ambient_color: [self.ambient_color.x * self.ambient_intensity, ...]`.

### Step 5: Update `editor/src/engine/engineBridge.ts`

Add:
```typescript
  setAmbientLight(r: number, g: number, b: number, intensity: number): void {
    this.world?.set_ambient_light(r, g, b, intensity);
  }

  getVelocity(id: EntityId): [number, number, number] {
    const a = this.world?.get_velocity(id);
    if (!a) return [0,0,0];
    return [a[0], a[1], a[2]];
  }

  setVelocity(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_velocity(id, x, y, z);
  }
```

### Step 6: Rebuild WASM

```bash
cd engine-core && wasm-pack build --target web
```

### Step 7: Commit

```bash
git add engine-core/src/ engine-core/pkg/ editor/src/engine/engineBridge.ts
git commit -m "feat(engine): sphere+cylinder meshes, ambient light, get/set_velocity WASM bindings"
```

---

## Task H: Camera Entity Component

**Files:**
- Modify: `engine-core/src/ecs/components.rs` — add CameraComponent
- Modify: `engine-core/src/lib.rs` — cameras SparseSet, active_camera, add_camera, set_active_camera, get_view_proj priority
- Modify: `engine-core/src/scene.rs` — SceneCameraComponent + add to SceneEntityData
- Modify: `editor/src/engine/engineBridge.ts` — addCamera, setActiveCamera
- Modify: `editor/src/engine/types.ts` — CameraData
- Create: `editor/src/components/Inspector/panels/CameraPanel.tsx`
- Modify: `editor/src/components/Inspector/ComponentPanels.tsx` — add Camera panel
- Modify: `editor/src/components/Inspector/Inspector.tsx` — add Camera to "Add Component" options
- Rebuild WASM

---

### Step 1: Add CameraComponent to `engine-core/src/ecs/components.rs`

```rust
pub struct CameraComponent {
    pub fov:  f32,  // degrees, default 60
    pub near: f32,  // default 0.1
    pub far:  f32,  // default 1000.0
}

impl Default for CameraComponent {
    fn default() -> Self { CameraComponent { fov: 60.0, near: 0.1, far: 1000.0 } }
}
```

### Step 2: Update `engine-core/src/lib.rs`

Add to World struct:
```rust
    cameras:       SparseSet<CameraComponent>,
    active_camera: Option<usize>,
```

Import `CameraComponent` in the `use ecs::...` line.

Initialize in `World::new()`:
```rust
    cameras:       SparseSet::new(),
    active_camera: None,
```

Add WASM bindings:
```rust
    pub fn add_camera(&mut self, id: usize, fov: f32, near: f32, far: f32) {
        self.cameras.insert(id, CameraComponent { fov, near, far });
    }

    pub fn set_active_camera(&mut self, id: usize) {
        self.active_camera = Some(id);
    }

    pub fn remove_active_camera(&mut self) {
        self.active_camera = None;
    }
```

Update `get_view_proj()` to use the active camera entity (when not in FPS mode):
```rust
    pub fn get_view_proj(&self) -> js_sys::Float32Array {
        let aspect = self.config.width as f32 / self.config.height as f32;
        let vp = self.camera_matrix(aspect);
        js_sys::Float32Array::from(vp.to_cols_array().as_slice())
    }
```

Add a helper method `camera_matrix`:
```rust
    fn camera_matrix(&self, aspect: f32) -> Mat4 {
        // Priority: FPS player > Active camera entity > Orbital camera
        if let Some(pid) = self.player {
            if let Some(t) = self.transforms.get(pid) {
                let cam = self.cameras.get(pid);
                let fov  = cam.map(|c| c.fov).unwrap_or(60.0);
                let near = cam.map(|c| c.near).unwrap_or(0.1);
                let far  = cam.map(|c| c.far).unwrap_or(1000.0);
                let proj = Mat4::perspective_rh(fov.to_radians(), aspect, near, far);
                let yaw   = t.rotation.y.to_radians();
                let pitch = t.rotation.x.to_radians();
                let forward = glam::Vec3::new(yaw.sin()*pitch.cos(), pitch.sin(), -yaw.cos()*pitch.cos());
                let view = Mat4::look_at_rh(t.position, t.position + forward, glam::Vec3::Y);
                return proj * view;
            }
        }
        if let Some(cam_id) = self.active_camera {
            if let Some(t) = self.transforms.get(cam_id) {
                let cam = self.cameras.get(cam_id);
                let fov  = cam.map(|c| c.fov).unwrap_or(60.0);
                let near = cam.map(|c| c.near).unwrap_or(0.1);
                let far  = cam.map(|c| c.far).unwrap_or(1000.0);
                let proj = Mat4::perspective_rh(fov.to_radians(), aspect, near, far);
                let yaw   = t.rotation.y.to_radians();
                let pitch = t.rotation.x.to_radians();
                let forward = glam::Vec3::new(yaw.sin()*pitch.cos(), pitch.sin(), -yaw.cos()*pitch.cos());
                let view = Mat4::look_at_rh(t.position, t.position + forward, glam::Vec3::Y);
                return proj * view;
            }
        }
        // Orbital camera
        self.camera.proj_matrix(aspect) * self.camera.view_matrix()
    }
```

Update `render_frame` to use `self.camera_matrix(aspect)` instead of the inline calculation.

Also update `remove_entity` to clear camera:
```rust
        self.cameras.remove(id);
        if self.active_camera == Some(id) { self.active_camera = None; }
```

### Step 3: Add SceneCameraComponent to `engine-core/src/scene.rs`

```rust
#[derive(Serialize, Deserialize)]
pub struct SceneCameraComponent {
    #[serde(default = "default_fov")]
    pub fov:  f32,
    #[serde(default = "default_near")]
    pub near: f32,
    #[serde(default = "default_far")]
    pub far:  f32,
}
fn default_fov()  -> f32 { 60.0 }
fn default_near() -> f32 { 0.1 }
fn default_far()  -> f32 { 1000.0 }
```

Add to `SceneEntityData`:
```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<SceneCameraComponent>,
```

### Step 4: Update save_scene and load_scene for camera

In `save_scene`, add to the entity push:
```rust
    camera: self.cameras.get(id).map(|c| SceneCameraComponent {
        fov: c.fov, near: c.near, far: c.far,
    }),
```

In `load_scene`, after the existing component restoration:
```rust
    if let Some(cam) = entity_data.camera {
        self.add_camera(id, cam.fov, cam.near, cam.far);
    }
```

### Step 5: Update `editor/src/engine/types.ts`

Add:
```typescript
export interface CameraData {
  fov:      number;
  near:     number;
  far:      number;
  isActive: boolean;
}
```

In `EntityComponents`:
```typescript
export interface EntityComponents {
  material?: MaterialData;
  script?:   ScriptData;
  camera?:   CameraData;
  // ... existing fields
}
```

### Step 6: Create `editor/src/components/Inspector/panels/CameraPanel.tsx`

```tsx
import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, CameraData } from '../../../engine/types';

export default function CameraPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const cam: CameraData = getComponents(entityId).camera ?? {
    fov: 60, near: 0.1, far: 1000, isActive: false,
  };

  const apply = (next: CameraData) => {
    setComponent(entityId, 'camera', next);
    bridge.addCamera(entityId, next.fov, next.near, next.far);
    if (next.isActive) bridge.setActiveCamera(entityId);
    else bridge.removeActiveCamera();
  };

  return (
    <PanelSection title="Camera" onRemove={() => {
      removeComponent(entityId, 'camera');
      bridge.removeActiveCamera();
    }}>
      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>FOV</span>
        <input type="range" min={10} max={120} step={1} value={cam.fov}
          onChange={e => apply({ ...cam, fov: +e.target.value })} style={{ width:80 }} />
        <span style={{ color:'var(--text-dim)', width:32, textAlign:'right' }}>{cam.fov}°</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Near</span>
        <input type="number" value={cam.near} step={0.01} min={0.001}
          onChange={e => apply({ ...cam, near: +e.target.value })}
          style={{ width:70, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'1px 4px', fontSize:11 }} />
      </div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:6, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Far</span>
        <input type="number" value={cam.far} step={1} min={1}
          onChange={e => apply({ ...cam, far: +e.target.value })}
          style={{ width:70, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'1px 4px', fontSize:11 }} />
      </div>
      <button
        onClick={() => apply({ ...cam, isActive: !cam.isActive })}
        style={{ fontSize:11, padding:'2px 10px', borderRadius:3, border:'1px solid var(--border)', cursor:'pointer',
          background: cam.isActive ? 'var(--accent)' : 'var(--bg-hover)',
          color: cam.isActive ? '#000' : 'var(--text)' }}
      >
        {cam.isActive ? '★ Active Camera' : '☆ Set as Active'}
      </button>
    </PanelSection>
  );
}
```

### Step 7: Update `editor/src/engine/engineBridge.ts`

```typescript
  addCamera(id: EntityId, fov: number, near: number, far: number): void {
    this.world?.add_camera(id, fov, near, far);
  }

  setActiveCamera(id: EntityId): void {
    this.world?.set_active_camera(id);
  }

  removeActiveCamera(): void {
    this.world?.remove_active_camera();
  }
```

### Step 8: Add CameraPanel to Inspector

In `editor/src/components/Inspector/ComponentPanels.tsx`, add:
```typescript
import CameraPanel from './panels/CameraPanel';
// In the panels render:
{components.camera && <CameraPanel entityId={entityId} />}
```

In `editor/src/components/Inspector/Inspector.tsx` (AddComponentButton or similar):
Add `'camera'` to the list of addable components with label "Camera".

### Step 9: Rebuild WASM

```bash
cd engine-core && wasm-pack build --target web
```

### Step 10: Commit

```bash
git add engine-core/src/ engine-core/pkg/ editor/src/engine/ editor/src/components/Inspector/
git commit -m "feat: camera entity component — CameraPanel, add_camera/set_active_camera, priority view matrix"
```

---

## Task I: JS-Driven Particle Emitter

**Approach:** Pure TypeScript. A particle emitter spawns entities from a pool, updates their positions each frame, returns them to the pool when lifetime expires. No Rust changes needed.

**Files:**
- Create: `editor/src/engine/particleSystem.ts`
- Create: `editor/src/components/Inspector/panels/ParticlePanel.tsx`
- Modify: `editor/src/engine/types.ts` — add ParticleData
- Modify: `editor/src/components/Inspector/ComponentPanels.tsx`
- Modify: `editor/src/components/Viewport/Viewport.tsx` — tick particles in game loop

---

### Step 1: Add ParticleData to `editor/src/engine/types.ts`

```typescript
export interface ParticleData {
  rate:      number;  // particles/second
  lifetime:  number;  // seconds
  speed:     number;  // units/second
  spread:    number;  // 0-1 cone spread
  gravity:   number;  // downward force
  color:     [number, number, number];
}
```

### Step 2: Create `editor/src/engine/particleSystem.ts`

```typescript
import { bridge } from './engineBridge';
import type { EntityId } from './types';
import type { ParticleData } from './types';

interface Particle {
  id:       EntityId;
  lifetime: number;
  maxLife:  number;
  velocity: [number, number, number];
}

const activeParticles: Particle[] = [];
const emitterConfigs  = new Map<EntityId, ParticleData>();
const emitterTimers   = new Map<EntityId, number>(); // accumulated time since last spawn
const spawnQueue:     EntityId[] = [];

export function registerEmitter(emitterId: EntityId, config: ParticleData) {
  emitterConfigs.set(emitterId, config);
  emitterTimers.set(emitterId, 0);
}

export function unregisterEmitter(emitterId: EntityId) {
  emitterConfigs.delete(emitterId);
  emitterTimers.delete(emitterId);
}

export function clearParticles() {
  for (const p of activeParticles) bridge.removeEntity(p.id);
  activeParticles.length = 0;
  emitterConfigs.clear();
  emitterTimers.clear();
}

export function tickParticles(deltaMs: number) {
  const dt = deltaMs / 1000;

  // Spawn new particles
  for (const [emitterId, cfg] of emitterConfigs) {
    const t = (emitterTimers.get(emitterId) ?? 0) + dt;
    emitterTimers.set(emitterId, t);
    const interval = 1.0 / cfg.rate;
    if (t >= interval) {
      emitterTimers.set(emitterId, t % interval);
      // Spawn particle at emitter position
      const pos = bridge.getTransform(emitterId).position;
      const id  = bridge.createEntity('__particle__');
      bridge.addMeshRenderer(id);
      bridge.setPosition(id, pos[0], pos[1], pos[2]);
      bridge.setScale(id, 0.1, 0.1, 0.1);
      bridge.addPbrMaterial(id, -1, 0.0, 1.0);
      bridge.setEmissive(id, cfg.color[0], cfg.color[1], cfg.color[2]);
      // Random velocity in spread cone
      const spread = cfg.spread;
      const rx = (Math.random() - 0.5) * 2 * spread;
      const rz = (Math.random() - 0.5) * 2 * spread;
      const vy = 1.0;
      const len = Math.hypot(rx, vy, rz) || 1;
      activeParticles.push({
        id,
        lifetime: 0,
        maxLife:  cfg.lifetime,
        velocity: [rx/len * cfg.speed, vy/len * cfg.speed, rz/len * cfg.speed],
      });
    }
  }

  // Update + age particles
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.lifetime += dt;
    if (p.lifetime >= p.maxLife) {
      bridge.removeEntity(p.id);
      activeParticles.splice(i, 1);
      continue;
    }
    // Find emitter gravity from config (use first emitter's gravity if multiple)
    let gravity = 0;
    for (const cfg of emitterConfigs.values()) { gravity = cfg.gravity; break; }

    const t = bridge.getTransform(p.id);
    const [x, y, z] = t.position;
    p.velocity[1] -= gravity * dt;
    bridge.setPosition(p.id,
      x + p.velocity[0] * dt,
      y + p.velocity[1] * dt,
      z + p.velocity[2] * dt,
    );
    // Fade scale with lifetime
    const frac = 1 - p.lifetime / p.maxLife;
    bridge.setScale(p.id, 0.1 * frac, 0.1 * frac, 0.1 * frac);
  }
}
```

### Step 3: Create `editor/src/components/Inspector/panels/ParticlePanel.tsx`

```tsx
import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { registerEmitter, unregisterEmitter } from '../../../engine/particleSystem';
import type { EntityId, ParticleData } from '../../../engine/types';

const defaultParticle: ParticleData = {
  rate: 10, lifetime: 2, speed: 3, spread: 0.3, gravity: 2, color: [1, 0.5, 0],
};

export default function ParticlePanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const cfg: ParticleData = getComponents(entityId).particle ?? defaultParticle;

  const apply = (next: ParticleData) => {
    setComponent(entityId, 'particle', next);
    registerEmitter(entityId, next);
  };

  React.useEffect(() => {
    registerEmitter(entityId, cfg);
    return () => unregisterEmitter(entityId);
  }, [entityId]);

  const row = (label: string, key: keyof ParticleData, min: number, max: number, step: number) => (
    <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
      <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={cfg[key] as number}
        onChange={e => apply({ ...cfg, [key]: +e.target.value })} style={{ width:80 }} />
      <span style={{ color:'var(--text-dim)', width:32, textAlign:'right' }}>{(cfg[key] as number).toFixed(step < 1 ? 2 : 0)}</span>
    </div>
  );

  return (
    <PanelSection title="Particle Emitter" onRemove={() => {
      unregisterEmitter(entityId);
      removeComponent(entityId, 'particle');
    }}>
      {row('Rate/s',   'rate',     1,  100, 1)}
      {row('Lifetime', 'lifetime', 0.1, 10, 0.1)}
      {row('Speed',    'speed',    0.1, 20, 0.1)}
      {row('Spread',   'spread',   0,   1,  0.05)}
      {row('Gravity',  'gravity',  0,   20, 0.1)}
    </PanelSection>
  );
}
```

### Step 4: Add particle tick to Viewport game loop

In `editor/src/components/Viewport/Viewport.tsx`, import `tickParticles` from `particleSystem` and call it in `startGameLoop` callback:

```typescript
import { tickParticles } from '../../engine/particleSystem';
// In startGameLoop callback:
bridge.startGameLoop((deltaMs) => {
  tickScripts(deltaMs);
  tickParticles(deltaMs);  // ADD
  refresh();
});
```

Also in `clearParticles()` call on stop — in Viewport's cleanup when `isPlaying` transitions to false, call `clearParticles()`.

### Step 5: Commit

```bash
git add editor/src/engine/particleSystem.ts editor/src/components/Inspector/panels/ParticlePanel.tsx editor/src/engine/types.ts editor/src/components/Viewport/Viewport.tsx
git commit -m "feat(editor): JS-driven particle emitter — ParticlePanel, entity-pool approach, game loop integration"
```

---

## Task J: Script API Extensions

**Files:**
- Modify: `editor/src/engine/scriptRunner.ts` — extend engineProxy with new methods

---

### Step 1: Update `editor/src/engine/scriptRunner.ts`

In the `engineProxy` object, add the new methods:

```typescript
const engineProxy = {
  // Existing
  getPosition: (id: number): [number, number, number] => {
    const t = bridge.getTransform(id); return t.position;
  },
  setPosition: (id: number, x: number, y: number, z: number) => {
    bridge.setPosition(id, x, y, z);
  },
  getEntityByTag: (tag: string): number | null => bridge.getEntityByTag(tag),
  log: (...args: unknown[]) => console.log('[Script]', ...args),

  // NEW
  getRotation: (id: number): [number, number, number] => {
    const t = bridge.getTransform(id); return t.rotation;
  },
  setRotation: (id: number, x: number, y: number, z: number) => {
    bridge.setRotation(id, x, y, z);
  },
  getVelocity: (id: number): [number, number, number] => {
    return bridge.getVelocity(id);
  },
  setVelocity: (id: number, x: number, y: number, z: number) => {
    bridge.setVelocity(id, x, y, z);
  },
  getKey: (key: string): boolean => {
    // Returns true if key is currently pressed
    return _pressedKeys.has(key.toLowerCase());
  },
  spawnEntity: (name: string): number => {
    const id = bridge.createEntity(name);
    bridge.addMeshRenderer(id);
    useSceneStore.getState().refresh();
    return id;
  },
  destroyEntity: (id: number) => {
    bridge.removeEntity(id);
    useSceneStore.getState().refresh();
  },
  getEntityIds: (): number[] => bridge.getEntityIds(),
  getEntityName: (id: number): string => bridge.getEntityName(id),
  setScale: (id: number, x: number, y: number, z: number) => {
    bridge.setScale(id, x, y, z);
  },
};
```

Also add a pressed keys tracker at the top of the file:

```typescript
import { useSceneStore } from '../store/sceneStore';

const _pressedKeys = new Set<string>();

export function initInputTracking() {
  const onDown = (e: KeyboardEvent) => _pressedKeys.add(e.key.toLowerCase());
  const onUp   = (e: KeyboardEvent) => _pressedKeys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup',   onUp);
}

export function clearInputTracking() {
  _pressedKeys.clear();
}
```

Call `initInputTracking()` from `initScripts()` and `clearInputTracking()` from the stop cleanup in Viewport.

### Step 2: Commit

```bash
git add editor/src/engine/scriptRunner.ts
git commit -m "feat(editor): extend script API — getRotation, setRotation, getVelocity, setVelocity, getKey, spawnEntity, destroyEntity"
```

---

## Task K: Inspector & Toolbar Polish

**Files:**
- Create: `editor/src/components/Inspector/panels/TagField.tsx`
- Modify: `editor/src/store/editorStore.ts` — add pause, undo/redo
- Modify: `editor/src/components/Toolbar/Toolbar.tsx` — add Pause button
- Modify: `editor/src/components/Inspector/ComponentPanels.tsx` — add TagField, component toggle
- Modify: `editor/src/components/Inspector/panels/PanelSection.tsx` — add enable/disable toggle

---

### Step 1: Create `editor/src/components/Inspector/panels/TagField.tsx`

```tsx
import React, { useState } from 'react';
import { bridge } from '../../../engine/engineBridge';
import { useSceneStore } from '../../../store/sceneStore';
import type { EntityId } from '../../../engine/types';

export default function TagField({ entityId }: { entityId: EntityId }) {
  const refresh = useSceneStore(s => s.refresh);
  const [tag, setTag] = useState(() => bridge.getTag(entityId));

  const commit = (value: string) => {
    bridge.setTag(entityId, value);
    setTag(value);
  };

  return (
    <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
      <span style={{ color:'var(--text-dim)', width:35 }}>Tag</span>
      <input
        value={tag}
        onChange={e => setTag(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        placeholder="Untagged"
        style={{ flex:1, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'2px 6px', fontSize:11 }}
      />
    </div>
  );
}
```

### Step 2: Add Pause to `editor/src/store/editorStore.ts`

Add `isPaused: boolean` and `setPaused: (v: boolean) => void` to the interface and store:

```typescript
  isPaused:   boolean;
  setPaused:  (v: boolean) => void;
```

In the create body:
```typescript
  isPaused:  false,
  setPaused: (v) => set({ isPaused: v }),
```

### Step 3: Add Pause button to `editor/src/components/Toolbar/Toolbar.tsx`

Import `useEffect` and update:

```tsx
  const { ..., isPaused, setPaused } = useEditorStore();

  // In JSX, after the Stop button:
  {isPlaying && (
    <button
      style={{ ...btn(isPaused), marginLeft: 4 }}
      onClick={() => {
        setPaused(!isPaused);
        // When pausing, stop the game loop; when unpausing, restart it
        if (!isPaused) bridge.stopLoop();
        // Viewport will detect isPaused change and restart if needed
      }}
    >
      {isPaused ? '▶ Resume' : '⏸ Pause'}
    </button>
  )}
```

In `editor/src/components/Viewport/Viewport.tsx`, handle `isPaused` in the game loop effect:
- Subscribe to `isPaused` from editorStore
- When `isPaused` becomes true and we're playing: stop the loop
- When `isPaused` becomes false and we're playing: restart the game loop

### Step 4: Add Undo/Redo to `editor/src/store/editorStore.ts`

```typescript
interface Snapshot { engineJson: string; editorMeta: Record<number, any>; }

  undoStack: Snapshot[];
  redoStack: Snapshot[];
  pushUndo:  (snap: Snapshot) => void;
  undo:      () => Snapshot | null;
  redo:      () => Snapshot | null;
```

In store:
```typescript
  undoStack: [],
  redoStack: [],
  pushUndo: (snap) => set(s => ({
    undoStack: [...s.undoStack.slice(-19), snap], // max 20 items
    redoStack: [],
  })),
  undo: () => {
    const s = useEditorStore.getState();
    const snap = s.undoStack[s.undoStack.length - 1];
    if (!snap) return null;
    set(prev => ({ undoStack: prev.undoStack.slice(0, -1) }));
    return snap;
  },
  redo: () => {
    const s = useEditorStore.getState();
    const snap = s.redoStack[s.redoStack.length - 1];
    if (!snap) return null;
    set(prev => ({ redoStack: prev.redoStack.slice(0, -1) }));
    return snap;
  },
```

In `sceneStore`, before each mutating action (updatePosition, updateRotation, updateScale), push an undo snapshot. In SceneGraph keyboard handler, handle `Ctrl+Z` and `Ctrl+Y`.

### Step 5: Update `editor/src/components/Inspector/panels/PanelSection.tsx` — add toggle

Check if PanelSection accepts `enabled` + `onToggle` props. If not, add them:
```tsx
export default function PanelSection({
  title, children, onRemove,
  enabled = true, onToggle,
}: {
  title: string;
  children: React.ReactNode;
  onRemove?: () => void;
  enabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ /* header styles */ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 8px', background:'var(--bg-header)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {onToggle && (
            <input type="checkbox" checked={enabled} onChange={onToggle}
              style={{ cursor:'pointer' }} />
          )}
          <span style={{ fontSize:11, fontWeight:600, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{title}</span>
        </div>
        {onRemove && (
          <button style={{ background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:13, lineHeight:1 }} onClick={onRemove} title="Remove component">×</button>
        )}
      </div>
      {enabled && <div style={{ padding: '6px 8px' }}>{children}</div>}
    </div>
  );
}
```

### Step 6: Add TagField to ComponentPanels

In `editor/src/components/Inspector/ComponentPanels.tsx`:
```tsx
import TagField from './panels/TagField';
// At the top of the panels render, before all PanelSections:
<TagField entityId={entityId} />
```

### Step 7: Commit

```bash
git add editor/src/components/Inspector/ editor/src/store/editorStore.ts editor/src/components/Toolbar/Toolbar.tsx
git commit -m "feat(editor): TagField, Pause button, Undo/Redo stack, component toggle in PanelSection"
```

---

## Final Verification

After all 11 tasks:

1. **Bug fixes**: Create entity, set metallic=0.8, Play → Stop → verify metallic still 0.8 and name unchanged
2. **Gizmos**: Select entity, press E → verify rotate rings appear and dragging rotates entity
3. **3D Import**: Import a .obj file → verify entity appears with correct mesh
4. **Camera**: Add Camera component, Set Active → verify viewport uses camera entity view
5. **Save/Load**: Save scene, reload page, Load scene → verify all data restored

```bash
cd editor && npm run build  # should compile with no TypeScript errors
```

Final commit if clean:
```bash
git add .
git commit -m "feat: WebUnity Editor v2 — all 11 tasks complete"
```
