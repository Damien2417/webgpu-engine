# Phase 5 — Scènes + Sérialisation : Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Système de scènes data-driven : `load_scene(json)` / `save_scene()` / entités persistantes, pour arrêter de hardcoder la scène en TypeScript.

**Architecture:** Ajout de `serde` + `serde_json` (WASM-compatible). Structs de données `SceneData` dans `scene.rs`. `SparseSet::remove` pour le reset partiel. `clear_scene()` interne qui supprime les entités non-persistantes. `World` étendu avec `persistent_entities: HashSet<usize>` et `texture_registry: HashMap<String, u32>`.

**Tech Stack:** Rust/WASM (serde 1, serde_json 1 no_std/alloc), wasm-bindgen, TypeScript, Vite

**Design doc:** `docs/plans/2026-02-21-phase5-scenes-design.md`

---

## Task 1 : Dépendances serde dans Cargo.toml

**Files:**
- Modify: `engine-core/Cargo.toml`

### Step 1 : Ajouter serde et serde_json

Dans `engine-core/Cargo.toml`, ajouter dans la section `[dependencies]` :

```toml
serde      = { version = "1", features = ["derive"] }
serde_json = { version = "1", default-features = false, features = ["alloc"] }
```

(`default-features = false` + `features = ["alloc"]` = pas de `std::io`, compatible WASM.)

### Step 2 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add Cargo.toml Cargo.lock
git -C engine-core commit -m "feat(deps): add serde + serde_json (WASM-compatible)"
```

---

## Task 2 : SparseSet::remove

**Files:**
- Modify: `engine-core/src/ecs/sparse_set.rs`

La suppression utilise le **swap-remove** : O(1), pas de décalage de tableau.

### Step 1 : Ajouter la méthode remove

À la fin du `impl<T> SparseSet<T>`, ajouter :

```rust
/// Supprime le composant pour `id`. Retourne true si existait.
/// Utilise swap-remove : O(1), réordonne les éléments dense.
pub fn remove(&mut self, id: usize) -> bool {
    if id >= self.sparse.len() || self.sparse[id] == EMPTY {
        return false;
    }
    let idx      = self.sparse[id];
    let last_idx = self.dense.len() - 1;

    // Swap-remove dans dense + ids
    self.dense.swap_remove(idx);
    self.ids.swap_remove(idx);

    // L'élément qui était au dernier slot est maintenant à idx
    // → mettre à jour son entrée sparse (sauf si on a supprimé le dernier)
    if idx <= last_idx && idx < self.ids.len() {
        let moved_id = self.ids[idx];
        self.sparse[moved_id] = idx;
    }

    self.sparse[id] = EMPTY;
    true
}
```

### Step 2 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/ecs/sparse_set.rs
git -C engine-core commit -m "feat(ecs): SparseSet::remove (swap-remove O(1))"
```

---

## Task 3 : Structs serde — scene.rs

**Files:**
- Create: `engine-core/src/scene.rs`
- Modify: `engine-core/src/lib.rs` (ajouter `mod scene;`)

Ces structs sont de la **pure data** — pas de GPU, pas de wasm_bindgen. Ils servent de couche de sérialisation intermédiaire entre JSON et les composants ECS.

### Step 1 : Créer engine-core/src/scene.rs

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

#[derive(Serialize, Deserialize)]
pub struct SceneMaterial {
    pub texture: String,
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
/// Tous les composants sont optionnels.
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

### Step 2 : Déclarer le module dans lib.rs

Au début de `engine-core/src/lib.rs`, après `mod mesh;`, ajouter :

```rust
mod scene;
```

### Step 3 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/scene.rs src/lib.rs
git -C engine-core commit -m "feat(scene): SceneData structs avec serde Serialize/Deserialize"
```

---

## Task 4 : World struct — persistent_entities + texture_registry

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter les imports nécessaires

En haut de `lib.rs`, dans les `use` existants, ajouter :

```rust
use std::collections::{HashMap, HashSet};
```

### Step 2 : Ajouter les champs au World struct

Dans le struct `World`, après le champ `light_bind_group:`, ajouter :

```rust
    // Scènes
    persistent_entities: HashSet<usize>,
    texture_registry:    HashMap<String, u32>,
```

### Step 3 : Initialiser dans World::new

Dans le bloc `Ok(World { ... })`, après `light_bind_group,`, ajouter :

```rust
            persistent_entities: HashSet::new(),
            texture_registry:    HashMap::new(),
```

### Step 4 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 5 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(world): persistent_entities + texture_registry fields"
```

---

## Task 5 : API register_texture + set_persistent

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter un nouveau bloc impl World

À la fin de `lib.rs`, ajouter un nouveau bloc `#[wasm_bindgen] impl World` :

```rust
#[wasm_bindgen]
impl World {
    // ── Scènes ───────────────────────────────────────────────────────────────

    /// Enregistre un TextureId GPU sous un nom string.
    /// Appeler avant load_scene() pour que les textures nommées soient résolvables.
    pub fn register_texture(&mut self, name: String, texture_id: u32) {
        self.texture_registry.insert(name, texture_id);
    }

    /// Marque (ou démarque) une entité comme persistante.
    /// Les entités persistantes survivent aux appels à load_scene().
    pub fn set_persistent(&mut self, id: usize, persistent: bool) {
        if persistent {
            self.persistent_entities.insert(id);
        } else {
            self.persistent_entities.remove(&id);
        }
    }
}
```

### Step 2 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(api): register_texture + set_persistent wasm_bindgen API"
```

---

## Task 6 : clear_scene (méthode interne)

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter clear_scene dans un bloc impl World non-wasm_bindgen

Après le dernier bloc `#[wasm_bindgen] impl World`, ajouter un bloc `impl World` **sans** `#[wasm_bindgen]` :

```rust
impl World {
    /// Supprime tous les composants des entités non-persistantes.
    /// Les entités persistantes et la texture_registry sont conservées.
    /// La directional_light est réinitialisée.
    fn clear_scene(&mut self) {
        // Collecter tous les IDs présents dans n'importe quel SparseSet
        let all_ids: HashSet<usize> = self.transforms.iter().map(|(id, _)| id)
            .chain(self.mesh_renderers.iter().map(|(id, _)| id))
            .chain(self.materials.iter().map(|(id, _)| id))
            .chain(self.rigid_bodies.iter().map(|(id, _)| id))
            .chain(self.colliders.iter().map(|(id, _)| id))
            .chain(self.point_lights.iter().map(|(id, _)| id))
            .filter(|id| !self.persistent_entities.contains(id))
            .collect();

        for id in all_ids {
            self.transforms.remove(id);
            self.mesh_renderers.remove(id);
            self.entity_gpus.remove(id);
            self.materials.remove(id);
            self.rigid_bodies.remove(id);
            self.colliders.remove(id);
            self.point_lights.remove(id);
        }

        self.directional_light = None;
    }
}
```

### Step 2 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(scene): clear_scene — reset partiel (entités non-persistantes)"
```

---

## Task 7 : load_scene + save_scene

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter les use pour scene

En haut de `lib.rs`, dans les imports existants, ajouter l'accès aux types scene :

```rust
use scene::{SceneData, SceneEntityData, SceneDirectionalLight, ScenePointLight,
            SceneMaterial, SceneRigidBody, SceneTransform};
```

### Step 2 : Ajouter load_scene et save_scene dans le bloc Scènes

Dans le bloc `#[wasm_bindgen] impl World` de la Task 5 (celui qui contient `register_texture` et `set_persistent`), ajouter :

```rust
    /// Charge une scène depuis un JSON string.
    /// Supprime les entités non-persistantes, puis crée les entités du JSON.
    /// Retourne un Uint32Array des IDs des nouvelles entités créées.
    pub fn load_scene(&mut self, json: &str) -> js_sys::Uint32Array {
        let scene: SceneData = match serde_json::from_str(json) {
            Ok(s)  => s,
            Err(e) => {
                web_sys::console::error_1(&format!("[load_scene] JSON invalide: {e}").into());
                return js_sys::Uint32Array::new_with_length(0);
            }
        };

        self.clear_scene();

        // Lumière directionnelle
        if let Some(dl) = scene.directional_light {
            self.directional_light = Some(DirectionalLightData {
                direction: glam::Vec3::from(dl.direction),
                color:     glam::Vec3::from(dl.color),
                intensity: dl.intensity,
            });
        }

        // Créer les entités
        let mut new_ids: Vec<u32> = Vec::new();

        for entity_data in scene.entities {
            let id = self.create_entity();
            new_ids.push(id as u32);

            if let Some(t) = entity_data.transform {
                let mut tr = Transform::default();
                tr.position = glam::Vec3::from(t.position);
                tr.rotation = glam::Vec3::from(t.rotation);
                tr.scale    = glam::Vec3::from(t.scale);
                self.transforms.insert(id, tr);
            }

            if entity_data.mesh_renderer == Some(true) {
                self.add_mesh_renderer(id);
            }

            if let Some(mat) = entity_data.material {
                let tex_id = self.texture_registry
                    .get(&mat.texture)
                    .copied()
                    .unwrap_or_else(|| {
                        web_sys::console::warn_1(
                            &format!("[load_scene] texture '{}' non enregistrée, blanc utilisé", mat.texture).into()
                        );
                        u32::MAX  // sentinel → default_tex dans render_frame
                    });
                self.materials.insert(id, Material { texture_id: tex_id });
            }

            if let Some(rb) = entity_data.rigid_body {
                self.rigid_bodies.insert(id, RigidBody { is_static: rb.is_static, ..RigidBody::default() });
            }

            if let Some(he) = entity_data.collider_aabb {
                self.colliders.insert(id, Collider {
                    half_extents: glam::Vec3::from(he),
                });
            }

            if let Some(pl) = entity_data.point_light {
                self.point_lights.insert(id, PointLight {
                    color:     glam::Vec3::from(pl.color),
                    intensity: pl.intensity,
                });
            }
        }

        js_sys::Uint32Array::from(new_ids.as_slice())
    }

    /// Sérialise la scène courante (toutes les entités) en JSON string.
    pub fn save_scene(&self) -> String {
        use scene::{SceneEntityData, SceneTransform, SceneMaterial,
                    SceneRigidBody, ScenePointLight, SceneDirectionalLight, SceneData};

        let directional_light = self.directional_light.as_ref().map(|dl| SceneDirectionalLight {
            direction: dl.direction.to_array(),
            color:     dl.color.to_array(),
            intensity: dl.intensity,
        });

        // Collecter tous les IDs d'entités uniques
        let all_ids: HashSet<usize> = self.transforms.iter().map(|(id, _)| id)
            .chain(self.mesh_renderers.iter().map(|(id, _)| id))
            .chain(self.materials.iter().map(|(id, _)| id))
            .chain(self.rigid_bodies.iter().map(|(id, _)| id))
            .chain(self.colliders.iter().map(|(id, _)| id))
            .chain(self.point_lights.iter().map(|(id, _)| id))
            .collect();

        // Trouver le nom de texture inverse (TextureId → nom)
        let id_to_name: HashMap<u32, String> = self.texture_registry
            .iter()
            .map(|(name, &id)| (id, name.clone()))
            .collect();

        let mut entities: Vec<SceneEntityData> = Vec::new();
        let mut sorted_ids: Vec<usize> = all_ids.into_iter().collect();
        sorted_ids.sort();

        for id in sorted_ids {
            let transform = self.transforms.get(id).map(|t| SceneTransform {
                position: t.position.to_array(),
                rotation: t.rotation.to_array(),
                scale:    t.scale.to_array(),
            });
            let mesh_renderer = if self.mesh_renderers.get(id).is_some() { Some(true) } else { None };
            let material = self.materials.get(id).map(|m| SceneMaterial {
                texture: id_to_name.get(&m.texture_id).cloned().unwrap_or_default(),
            });
            let rigid_body = self.rigid_bodies.get(id).map(|rb| SceneRigidBody {
                is_static: rb.is_static,
            });
            let collider_aabb = self.colliders.get(id).map(|c| c.half_extents.to_array());
            let point_light = self.point_lights.get(id).map(|pl| ScenePointLight {
                color:     pl.color.to_array(),
                intensity: pl.intensity,
            });

            entities.push(SceneEntityData {
                transform, mesh_renderer, material, rigid_body, collider_aabb, point_light,
            });
        }

        let scene = SceneData { directional_light, entities };
        serde_json::to_string_pretty(&scene).unwrap_or_default()
    }
```

**Note :** Le `u32::MAX` comme `texture_id` sentinel pour "texture non trouvée" est safe car dans `render_frame`, la condition `tex_idx < self.textures.len()` sera fausse → fallback sur `default_tex` (texture blanche). C'est le comportement voulu.

### Step 3 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(api): load_scene + save_scene wasm_bindgen API"
```

---

## Task 8 : Build WASM complet

**Files:** aucun

### Step 1 : Build wasm-pack

```bash
cd engine-core && wasm-pack build --target web 2>&1 | tail -20
```

Attendu : `[INFO]: :-) Your wasm pkg is ready to publish at ...` sans erreur.

**Si erreur serde/serde_json :** Lire le message complet sans le filtre grep.

### Step 2 : Commit

```bash
git -C engine-core add pkg/
git -C engine-core commit -m "build: wasm-pack Phase 5 scenes"
```

---

## Task 9 : Fichiers JSON de scène + migration main.ts

**Files:**
- Create: `game-app/public/scenes/level1.json`
- Create: `game-app/public/scenes/level2.json`
- Modify: `game-app/src/main.ts`

### Step 1 : Créer game-app/public/scenes/level1.json

```json
{
  "directional_light": {
    "direction": [-0.5, -1.0, -0.3],
    "color": [1.0, 0.95, 0.8],
    "intensity": 1.2
  },
  "entities": [
    {
      "transform": { "position": [0, -0.5, 0], "rotation": [0, 0, 0], "scale": [20, 1, 20] },
      "mesh_renderer": true,
      "material": { "texture": "floor_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [10, 0.5, 10]
    },
    {
      "transform": { "position": [3, 0.5, 3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-3, 0.5, 3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [3, 0.5, -3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-3, 0.5, -3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [4, 2.5, 4], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "point_light": { "color": [0.3, 0.8, 1.0], "intensity": 10.0 }
    },
    {
      "transform": { "position": [-4, 2.5, -4], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "point_light": { "color": [1.0, 0.4, 0.2], "intensity": 10.0 }
    }
  ]
}
```

### Step 2 : Créer game-app/public/scenes/level2.json

Une deuxième scène différente pour valider le switch :

```json
{
  "directional_light": {
    "direction": [0.3, -0.8, 0.5],
    "color": [0.6, 0.8, 1.0],
    "intensity": 0.8
  },
  "entities": [
    {
      "transform": { "position": [0, -0.5, 0], "rotation": [0, 0, 0], "scale": [20, 1, 20] },
      "mesh_renderer": true,
      "material": { "texture": "floor_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [10, 0.5, 10]
    },
    {
      "transform": { "position": [0, 0.5, 5], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [0, 0.5, -5], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [5, 0.5, 0], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-5, 0.5, 0], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [0, 3.0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "point_light": { "color": [1.0, 1.0, 0.5], "intensity": 15.0 }
    }
  ]
}
```

### Step 3 : Remplacer intégralement game-app/src/main.ts

```typescript
import init, { World } from '../../engine-core/pkg/engine_core.js';

await init();

// ── Canvas + WebGPU ───────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// ── Constantes input ──────────────────────────────────────────────────────
const KEY_W     = 1 << 0;
const KEY_S     = 1 << 1;
const KEY_A     = 1 << 2;
const KEY_D     = 1 << 3;
const KEY_SPACE = 1 << 4;

// ── Générateur de texture damier ──────────────────────────────────────────
function makeChecker(
  w: World,
  size: number,
  c1: [number, number, number],
  c2: [number, number, number]
): number {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = (x + y) % 2 === 0 ? c1 : c2;
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return w.upload_texture(size, size, data);
}

// ── Upload textures et enregistrement dans le registre ───────────────────
const floorTexId = makeChecker(world, 8, [180, 180, 180], [60, 60, 60]);
const boxTexId   = makeChecker(world, 4, [220, 120,  60], [140, 60, 20]);

world.register_texture('floor_checker', floorTexId);
world.register_texture('box_checker',   boxTexId);

// ── Joueur persistant (créé une seule fois, survit aux load_scene) ────────
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.3, 0.9, 0.3);
world.set_player(player);
world.set_persistent(player, true);

// ── Chargement de scène ───────────────────────────────────────────────────
let currentLevel = 1;

async function loadLevel(n: number): Promise<void> {
  const json = await fetch(`/scenes/level${n}.json`).then(r => r.text());
  world.load_scene(json);
  currentLevel = n;
  console.log(`[Scene] level${n} chargé`);
}

await loadLevel(1);

// ── Input ─────────────────────────────────────────────────────────────────
let keysMask   = 0;
let mouseDxAcc = 0;
let mouseDyAcc = 0;

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW':     keysMask |= KEY_W;     break;
    case 'KeyS':     keysMask |= KEY_S;     break;
    case 'KeyA':     keysMask |= KEY_A;     break;
    case 'KeyD':     keysMask |= KEY_D;     break;
    case 'Space':    keysMask |= KEY_SPACE; e.preventDefault(); break;
    // Touche N = niveau suivant (switch de scène in-game)
    case 'KeyN':     loadLevel(currentLevel === 1 ? 2 : 1); break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW':  keysMask &= ~KEY_W;     break;
    case 'KeyS':  keysMask &= ~KEY_S;     break;
    case 'KeyA':  keysMask &= ~KEY_A;     break;
    case 'KeyD':  keysMask &= ~KEY_D;     break;
    case 'Space': keysMask &= ~KEY_SPACE; break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    mouseDxAcc += e.movementX;
    mouseDyAcc += e.movementY;
  }
});

canvas.addEventListener('click', () => canvas.requestPointerLock());

// Overlay
const overlay = document.createElement('div');
overlay.textContent = 'Cliquer pour jouer — WASD + Souris + ESPACE (saut) + N (changer de scène)';
overlay.style.cssText = [
  'position:fixed', 'inset:0', 'display:flex',
  'align-items:center', 'justify-content:center',
  'color:white', 'font:bold 20px sans-serif',
  'background:rgba(0,0,0,.55)', 'pointer-events:none',
].join(';');
document.body.appendChild(overlay);

document.addEventListener('pointerlockchange', () => {
  overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
});

document.addEventListener('pointerlockerror', () => {
  overlay.textContent = 'Pointer Lock refusé — réessayez ou vérifiez les permissions du navigateur.';
  overlay.style.display = 'flex';
});

// ── Boucle de jeu ─────────────────────────────────────────────────────────
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  world.set_input(keysMask, mouseDxAcc, mouseDyAcc);
  mouseDxAcc = 0;
  mouseDyAcc = 0;

  world.update(delta);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
```

### Step 4 : Commit

```bash
# Depuis le root repo
git add game-app/src/main.ts game-app/public/scenes/
git commit -m "feat(demo): Phase 5 — scènes JSON data-driven + switch in-game (touche N)"
```

---

## Récapitulatif des commits attendus

| Commit | Contenu |
|--------|---------|
| `feat(deps): add serde + serde_json` | Cargo.toml |
| `feat(ecs): SparseSet::remove` | sparse_set.rs |
| `feat(scene): SceneData structs` | scene.rs |
| `feat(world): persistent_entities + texture_registry` | lib.rs |
| `feat(api): register_texture + set_persistent` | lib.rs |
| `feat(scene): clear_scene` | lib.rs |
| `feat(api): load_scene + save_scene` | lib.rs |
| `build: wasm-pack Phase 5 scenes` | engine-core/pkg/ |
| `feat(demo): Phase 5 — scènes JSON data-driven` | main.ts + public/scenes/ |

## Pièges à éviter

- **`serde_json` en WASM** : `default-features = false, features = ["alloc"]` obligatoire — pas de `std::io`.
- **SparseSet::remove swap-remove** : après swap, mettre à jour `sparse[moved_id]` seulement si `idx < ids.len()` (cas suppression du dernier élément).
- **texture_id sentinel `u32::MAX`** : dans `render_frame`, la condition `tex_idx < self.textures.len()` est déjà un fallback sur `default_tex` — aucune modification de render_frame nécessaire.
- **`add_mesh_renderer` dans load_scene** : appeler `self.add_mesh_renderer(id)` (méthode existante qui crée le buffer GPU) — ne pas insérer directement dans `mesh_renderers`.
- **`HashSet` et `HashMap`** : importer via `use std::collections::{HashMap, HashSet}` — pas de crate externe.
- **Vite HMR** : ne détecte pas les changements dans `engine-core/pkg/` — toujours faire Ctrl+Shift+R après un rebuild.
- **`cargo test`** sans `--target wasm32-unknown-unknown` échoue — ce crate est wasm-only.
