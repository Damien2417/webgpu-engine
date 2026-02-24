# WebUnity — Moteur 3D Web + Éditeur

Monorepo d'un moteur 3D WebGPU écrit en Rust/WASM et d'un éditeur web style Unity.

```
webgpu-engine/
├── engine-core/   Moteur Rust → WASM (wasm-pack)
├── editor/        Éditeur web React (WebUnity Editor)  ← voir editor/README.md
└── game-app/      Application de démo TypeScript
```

---

## engine-core

Bibliothèque Rust compilée en WebAssembly. Gère le rendu WebGPU, l'ECS, la physique et la sérialisation de scènes.

### Fonctionnalités

- **Rendu WebGPU** — pipeline PBR GGX, shadow maps (PCF), normal maps, depth buffer
- **ECS** — `SparseSet<T>` maison, composants Transform / MeshRenderer / Material / RigidBody / PointLight / Camera
- **Physique** — RigidBody dynamique/statique, collisions AABB, résolution MTV, saut
- **Maillages** — Cube, Plane, Sphere, Cylinder, Custom (vertices/indices uploadés)
- **Éclairage** — Blinn-Phong + PBR GGX, lumières ponctuelles, directionnelle, ambiante
- **Caméra** — orbitale éditeur, entité caméra (jeu), FPS player ; priorité configurable par `set_game_mode`
- **Tags** — `set_tag` / `get_entity_by_tag` pour recherches runtime depuis les scripts
- **Sérialisation** — `save_scene()` / `load_scene(json)` via serde_json, caméras actives incluses

### Build

```bash
cd engine-core
wasm-pack build --target web --out-dir pkg
```

Prérequis : Rust stable, `wasm32-unknown-unknown`, `wasm-pack`.

### API `World` (résumé)

**Entités**
```ts
create_entity() → id
remove_entity(id)
get_entity_ids() → Uint32Array
get_entity_name(id) → string
set_entity_name(id, name)
set_tag(id, tag)
get_tag(id) → string
get_entity_by_tag(tag) → id | 0xFFFFFFFF
```

**Transform**
```ts
add_transform(id, x, y, z)
set_position(id, x, y, z)
set_rotation(id, x, y, z)         // euler degrés
set_scale(id, x, y, z)
get_transform_array(id) → Float32Array[9]  // [px,py,pz, rx,ry,rz, sx,sy,sz]
```

**Rendu**
```ts
add_mesh_renderer(id)
set_mesh_type(id, type)            // "cube" | "plane" | "sphere" | "cylinder"
get_mesh_type(id) → string
upload_custom_mesh(vertices, indices) → meshId
render_frame(delta_ms)
get_view_proj() → Float32Array[16] // matrice view*proj column-major
```

**Caméra**
```ts
set_camera(ex, ey, ez, tx, ty, tz) // caméra orbitale éditeur
add_camera(id, fov, near, far)      // composant caméra sur entité
set_active_camera(id)               // définit la caméra active en mode jeu
remove_active_camera()
set_game_mode(enabled)              // true = caméras d'entités actives, false = orbital
get_view_proj() → Float32Array[16]
```

**Textures / Matériaux PBR**
```ts
upload_texture(width, height, data: Uint8Array, mipmaps) → texId
register_texture(name, tex_id)
add_material(entity_id, tex_id)
add_pbr_material(entity_id, albedo_id, metallic, roughness)
set_normal_map(entity_id, normal_tex_id)
set_emissive(entity_id, r, g, b)
```

**Éclairage**
```ts
add_point_light(id, r, g, b, intensity)
add_directional_light(dx, dy, dz, r, g, b, intensity)
set_ambient_light(r, g, b, intensity)
```

**Physique / Input**
```ts
set_player(id)
set_camera_follow_entity(id, follow)
add_rigid_body(id, is_static)
add_collider_aabb(id, hx, hy, hz)
fit_collider_to_mesh(id, min_half_y)
get_collider_array(id) → Float32Array[3]
get_velocity(id) → Float32Array[3]
set_velocity(id, vx, vy, vz)
set_input(keys_bitmask, mouse_dx, mouse_dy)  // bits: W=0, S=1, A=2, D=3, SPACE=4
update(delta_ms)
```

**Scènes**
```ts
save_scene() → string (JSON)
load_scene(json)
set_persistent(id, persistent)
```

---

## editor — WebUnity Editor

Éditeur de scènes complet style Unity. Voir **[editor/README.md](editor/README.md)** pour la documentation complète.

```bash
cd editor
npm install
npm run dev   # http://localhost:5173
```

### Fonctionnalités clés

| Catégorie | Détail |
|-----------|--------|
| **Viewport** | Rendu WebGPU temps réel, caméra orbitale libre (RMB + WASD + molette) |
| **Gizmos** | Translate / Rotate / Scale avec handles XYZ colorés, drag précis |
| **Scene Graph** | Ajout, suppression, renommage inline, recherche, Ctrl+D duplicate |
| **Inspector** | Transform, MeshRenderer, Material PBR, RigidBody, Collider, Light, Camera, Particle, Script, Tag |
| **Import 3D** | OBJ et GLB/GLTF → upload mesh custom dans le moteur |
| **Scripts JS** | Exécutés chaque frame en Play, API moteur complète (input, physique, spawn…) |
| **Particules** | Émetteur pur TypeScript (pool d'entités), configurable par entité |
| **Play / Pause / Stop** | Snapshot JSON avant Play, restauration à Stop |
| **Undo / Redo** | Ctrl+Z / Ctrl+Y, 20 états dans chaque direction |
| **Persistence** | Assets + scène sauvegardés en localStorage entre sessions |

### Stack

- React 18 + TypeScript + Vite
- Zustand (editorStore, sceneStore, componentStore, assetStore)
- engine-core WASM
- Gizmos : overlay `<canvas 2D>` avec projection 3D→2D (matrices glam column-major)

---

## game-app — Démo

Application de démo utilisant le moteur directement (sans éditeur). Scènes JSON data-driven, mode PBR, ombres.

```bash
cd game-app
npm install
npm run dev   # http://localhost:5173
```

Touche `N` pour changer de scène.

---

## Roadmap

| Phase | Statut | Description |
|-------|--------|-------------|
| 1 — ECS Foundation | ✅ | World + SparseSet, composants, API wasm_bindgen |
| 2 — Textures + Matériaux | ✅ | PNG → wgpu::Texture, composant Material |
| 3 — Input + Physique | ✅ | FPS jouable, RigidBody + AABB |
| 4 — Éclairage Phong | ✅ | Blinn-Phong, point lights, directional |
| 5 — Scènes JSON | ✅ | save/load/switch scènes data-driven |
| 6 — PBR + Shadow Maps | ✅ | GGX, metallic/roughness, PCF shadows, normal maps |
| 7 — WebUnity Editor | ✅ | Éditeur web complet (viewport, gizmos, inspector, assets, play/stop) |
| 7b — Editor v2 | ✅ | Sphere/Cylinder, ambiante, caméra entité, particules, scripts étendus, undo/redo, import 3D |
