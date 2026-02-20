# WebUnity Roadmap — Design Document

**Date :** 2026-02-20
**Objectif :** Construire un moteur 3D web complet style Unity/Godot — rendu WebGPU (Rust/WASM), gameplay, physique, éditeur browser.
**Stratégie :** Architecture-first (Approche B) — ECS comme squelette, puis couches rendu/gameplay/éditeur en parallèle.

---

## Architecture ECS

### Modèle : Sparse Set ECS (fait maison)

```
World
├── entities: Vec<EntityId>               ← IDs (u32)
├── components:
│   ├── transforms:     SparseSet<Transform>
│   ├── mesh_renderers: SparseSet<MeshRenderer>
│   ├── cameras:        SparseSet<CameraComp>
│   ├── rigid_bodies:   SparseSet<RigidBody>
│   └── point_lights:   SparseSet<PointLight>
└── systems: appelés par world.update(delta)
```

**SparseSet<T>** = `Vec<T>` dense + lookup sparse → O(1) get, itération cache-friendly.

### Boundary Rust ↔ TypeScript

TypeScript utilise des commandes haut niveau, ne voit jamais les composants :

```typescript
const world = await World.new(canvas);
const cube  = world.create_entity();
world.add_transform(cube, 0, 0, 0);
world.add_mesh_renderer(cube, MeshType.Cube);
world.update(delta);
world.render();
```

### Structure des fichiers cible

```
engine-core/src/
├── ecs/
│   ├── mod.rs           ← World + EntityId
│   ├── sparse_set.rs    ← SparseSet<T> générique
│   └── components.rs    ← Transform, MeshRenderer, CameraComp, RigidBody, PointLight
├── systems/
│   ├── mod.rs
│   ├── render.rs        ← RenderSystem
│   └── physics.rs       ← PhysicsSystem (Phase 3)
└── lib.rs               ← wasm_bindgen API sur World
```

---

## Roadmap : 7 Phases

### Phase 1 — ECS Foundation
**But :** Remplacer Engine + Vec<Entity> par World + ECS proper.
**Livrable :** Cube tournant sur ECS — même résultat visuel, architecture propre.
**Clés :** `EntityId(u32)`, `SparseSet<T>`, composants Transform + MeshRenderer + CameraComp, RenderSystem extrait de lib.rs, API wasm_bindgen sur World.

### Phase 2 — Textures + Matériaux
**But :** Images PNG chargées depuis URL et appliquées sur les meshs.
**Livrable :** Cube texturé.
**Mécanisme :** fetch() TS → ImageBitmap → wgpu::Texture. Composant Material { albedo: TextureId, color_tint }. Shader WGSL avec textureSample.
**TS API :** `load_texture(url) → TextureId`, `add_material(entity, texture_id)`

### Phase 3 — Input + Physique AABB
**But :** Personnage contrôlable, collisions.
**Livrable :** Mini-démo FPS jouable.
**Mécanisme :** Keyboard/mouse en TS → `set_input(keys_bitmask, mouse_dx, mouse_dy)`. Composants RigidBody + Collider(AABB). PhysicsSystem : intégration Euler + résolution collisions paires.
**TS API :** `add_rigid_body()`, `add_collider_aabb()`, `set_input()`

### Phase 4 — Éclairage Phong
**But :** Lumières directionnelles et point lights.
**Livrable :** Scène éclairée avec volume.
**Mécanisme :** Normales dans Vertex. Uniform LightUniforms (max 8 point lights + 1 directional). Shader Phong : ambient + diffuse + specular.
**TS API :** `add_point_light(entity, r, g, b, intensity)`, `add_directional_light(dx, dy, dz, r, g, b)`

### Phase 5 — Scènes + Sérialisation
**But :** Sauvegarder/charger des scènes en JSON.
**Livrable :** `save_scene()` / `load_scene(json)` / `switch_scene(name)`.
**Mécanisme :** serde + serde_json (feature-flaggé). SceneManager avec scènes nommées.

### Phase 6 — PBR + Shadow Maps
**But :** Rendu physiquement correct, ombres projetées.
**Livrable :** Metallic/roughness + ombres nettes.
**Mécanisme :** Depth pass depuis la lumière → shadow map → sampling fragment shader. Matériaux PBR : albedo, metallic, roughness, normal map.

### Phase 7 — Mini-éditeur browser
**But :** Créer/modifier une scène dans le browser sans recompiler.
**Livrable :** UI HTML/TS — scene graph (gauche), inspector (droite), viewport (centre).
**Mécanisme :** S'appuie sur Phase 5 (sérialisation). TypeScript pur, pas de framework.

---

## Vue d'ensemble

```
Phase 1  ECS Foundation         → cube tournant sur ECS (base de tout)
Phase 2  Textures + Matériaux   → cube texturé
Phase 3  Input + Physique       → premier jeu jouable
Phase 4  Éclairage Phong        → scène visuellement convaincante
Phase 5  Scènes + Sérialisation → workflow multi-scènes
Phase 6  PBR + Shadows          → rendu avancé
Phase 7  Mini-éditeur           → interface "WebUnity"
```
