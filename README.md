# WebUnity — Moteur 3D Web + Éditeur

Monorepo d'un moteur 3D WebGPU écrit en Rust/WASM et d'un éditeur web style Unity.

```
webgpu-engine/
├── engine-core/   Moteur Rust → WASM (wasm-pack)
├── game-app/      Démo/jeu TypeScript utilisant le moteur
└── editor/        Éditeur web React (WebUnity Editor)
```

---

## engine-core

Bibliothèque Rust compilée en WebAssembly. Gère le rendu WebGPU, l'ECS, la physique et la sérialisation de scènes.

### Fonctionnalités

- **Rendu WebGPU** — pipeline PBR GGX, shadow maps (PCF), normal maps, depth buffer
- **ECS** — `SparseSet<T>` maison, composants Transform / MeshRenderer / Material / RigidBody / PointLight
- **Physique** — RigidBody dynamique/statique, collisions AABB, résolution MTV, saut
- **Caméra FPS** — pilotée par input clavier/souris (`set_input`)
- **Sérialisation** — `save_scene()` / `load_scene(json)` via serde_json
- **API éditeur** — `get_entity_ids()`, `get_transform_array()`, `get_view_proj()`, `remove_entity()`, noms d'entités

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
```

**Transform**
```ts
add_transform(id, x, y, z)
set_position(id, x, y, z)
set_rotation(id, x, y, z)   // euler degrés
set_scale(id, x, y, z)
get_transform_array(id) → Float32Array[9]  // [px,py,pz, rx,ry,rz, sx,sy,sz]
```

**Rendu**
```ts
add_mesh_renderer(id)
render_frame(delta_ms)
get_view_proj() → Float32Array[16]   // matrice view*proj column-major
```

**Caméra**
```ts
set_camera(ex, ey, ez, tx, ty, tz)
```

**Textures / Matériaux PBR**
```ts
upload_texture(width, height, data: Uint8Array, mipmaps) → texId
add_material(entity_id, tex_id)
add_pbr_material(entity_id, albedo_id, metallic, roughness)
set_normal_map(entity_id, normal_tex_id)
set_emissive(entity_id, r, g, b)
```

**Éclairage**
```ts
add_point_light(id, r, g, b, intensity)
add_directional_light(dx, dy, dz, r, g, b, intensity)
```

**Physique / Input**
```ts
set_player(id)
add_rigid_body(id, is_static)
add_collider_aabb(id, hx, hy, hz)
set_input(keys_bitmask, mouse_dx, mouse_dy)  // bits: W=0, S=1, A=2, D=3, SPACE=4
update(delta_ms)
```

**Scènes**
```ts
save_scene() → string (JSON)
load_scene(json)
set_persistent(id, persistent)
register_texture(name, tex_id)
```

---

## editor — WebUnity Editor

Éditeur web complet style Unity. Application React 18 + Zustand + Vite.

### Lancer

```bash
cd editor
npm install
npm run dev   # http://localhost:5173
```

### Interface

```
┌──────────┬─────────────────────────────────┬──────────────┐
│ WebUnity │ ↔ Move  ↻ Rotate  ⤡ Scale  ▶ Play │              │
├──────────┼─────────────────────────────────┤  Inspector   │
│          │                                 │              │
│  Scene   │        Viewport                 │  Transform   │
│  Graph   │   [WebGPU canvas]               │  Position    │
│          │   [Gizmo overlay]               │  Rotation    │
│  + Add   │                                 │  Scale       │
├──────────┴─────────────────────────────────┴──────────────┤
│  Asset Browser  — import PNG/JPG, cliquer = appliquer      │
└────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

| Panneau | Fonctionnalité |
|---------|----------------|
| **Viewport** | Rendu WebGPU temps réel, caméra orbitale (drag = orbite, scroll = zoom) |
| **Scene Graph** | Liste entités, `+` ajouter, clic droit supprimer, sélection |
| **Inspector** | Position / Rotation / Scale avec inputs XYZ liés au WASM |
| **Gizmo** | Flèches XYZ colorées (rouge/vert/bleu), drag pour translate |
| **Toolbar** | Mode W (translate) / E (rotate) / R (scale) + raccourcis clavier |
| **Play/Stop** | Snapshot JSON → simulation → restauration à l'arrêt |
| **MenuBar** | New / Save `.json` / Load `.json` |
| **Asset Browser** | Import textures, thumbnails, cliquer = applique à l'entité sélectionnée |

### Stack

- React 18 + TypeScript + Vite
- Zustand (editorStore, sceneStore)
- engine-core WASM (partagé avec game-app)
- Gizmos : overlay `<canvas 2D>` avec projection 3D→2D (matrices glam column-major)

---

## game-app — Démo

Application de démo qui utilise le moteur. Scènes JSON data-driven, mode PBR, ombres.

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
| 7 — WebUnity Editor | ✅ | Éditeur web complet (viewport, gizmos, inspector, assets) |
