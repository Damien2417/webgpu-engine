# Phase 1 — ECS Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remplacer `Engine` + `Vec<Entity>` par `World` + Sparse Set ECS — le cube tournant produit exactement le même résultat visuel, mais l'architecture est extensible.

**Architecture:** `World` (#[wasm_bindgen]) contient les ressources GPU + les composants ECS dans des `SparseSet<T>`. TypeScript reçoit des `usize` handles et appelle `world.add_transform()`, `world.add_mesh_renderer()`, `world.render_frame()`. `scene.rs` est supprimé — `MeshType` migre dans `ecs/components.rs`.

**Tech Stack:** Rust 2024 edition, wgpu 28, glam 0.29 (bytemuck), bytemuck 1, wasm-bindgen 0.2, wasm-pack --target web, TypeScript, Vite 7.

**Design doc :** `docs/plans/2026-02-20-webunity-roadmap-design.md`

---

## Fichiers touchés

```
engine-core/src/
├── ecs/
│   ├── mod.rs          ← NEW : re-exports
│   ├── sparse_set.rs   ← NEW : SparseSet<T> générique
│   └── components.rs   ← NEW : Transform, MeshType, MeshRenderer
├── lib.rs              ← REWRITE : World remplace Engine
├── scene.rs            ← SUPPRIMÉ (Entity + MeshType migrent dans ecs/)
├── camera.rs           ← inchangé
├── mesh.rs             ← inchangé
└── shader.wgsl         ← inchangé
game-app/src/
└── main.ts             ← UPDATE : Engine → World, create_cube → create_entity + add_mesh_renderer
```

---

## Task 1 : Créer le module `ecs/` — SparseSet + composants

**Files:**
- Create: `engine-core/src/ecs/sparse_set.rs`
- Create: `engine-core/src/ecs/components.rs`
- Create: `engine-core/src/ecs/mod.rs`

### Step 1 : Créer `engine-core/src/ecs/sparse_set.rs`

La structure centrale du moteur. Accès O(1), itération cache-friendly.

```rust
/// Sentinel : indique l'absence d'un composant dans le vecteur sparse.
const EMPTY: usize = usize::MAX;

/// Conteneur de composants basé sur un Sparse Set.
///
/// - `sparse[entity_id]` → index dans `dense` (ou EMPTY si absent)
/// - `dense`             → composants compactés (itération rapide)
/// - `ids`               → entity_id correspondant à chaque slot dense
pub struct SparseSet<T> {
    sparse: Vec<usize>,
    dense:  Vec<T>,
    ids:    Vec<usize>,
}

impl<T> SparseSet<T> {
    pub fn new() -> Self {
        SparseSet {
            sparse: Vec::new(),
            dense:  Vec::new(),
            ids:    Vec::new(),
        }
    }

    /// Insère ou remplace le composant pour `id`.
    pub fn insert(&mut self, id: usize, value: T) {
        // Étendre sparse si nécessaire
        if id >= self.sparse.len() {
            self.sparse.resize(id + 1, EMPTY);
        }

        if self.sparse[id] != EMPTY {
            // Remplacement : mettre à jour sur place
            let idx = self.sparse[id];
            self.dense[idx] = value;
        } else {
            // Nouvelle insertion
            let idx = self.dense.len();
            self.sparse[id] = idx;
            self.dense.push(value);
            self.ids.push(id);
        }
    }

    /// Retourne une référence immutable, ou None si absent.
    pub fn get(&self, id: usize) -> Option<&T> {
        if id >= self.sparse.len() || self.sparse[id] == EMPTY {
            return None;
        }
        Some(&self.dense[self.sparse[id]])
    }

    /// Retourne une référence mutable, ou None si absent.
    pub fn get_mut(&mut self, id: usize) -> Option<&mut T> {
        if id >= self.sparse.len() || self.sparse[id] == EMPTY {
            return None;
        }
        let idx = self.sparse[id];
        Some(&mut self.dense[idx])
    }

    /// Itère sur tous les composants : (entity_id, &T).
    pub fn iter(&self) -> impl Iterator<Item = (usize, &T)> {
        self.ids.iter().copied().zip(self.dense.iter())
    }
}
```

### Step 2 : Créer `engine-core/src/ecs/components.rs`

```rust
use glam::Vec3;

// ── Transform ──────────────────────────────────────────────────────────────

/// Position, rotation (Euler degrés XYZ) et échelle d'une entité dans le monde.
pub struct Transform {
    pub position: Vec3,
    pub rotation: Vec3, // angles Euler en degrés (X, Y, Z)
    pub scale:    Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Transform {
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            scale:    Vec3::ONE,
        }
    }
}

// ── MeshRenderer ───────────────────────────────────────────────────────────

/// Types de maillage supportés. Extensible (Sphere, CustomMesh, etc.)
pub enum MeshType {
    Cube,
}

/// Indique que cette entité doit être rendue avec un mesh donné.
pub struct MeshRenderer {
    pub mesh_type: MeshType,
}
```

### Step 3 : Créer `engine-core/src/ecs/mod.rs`

```rust
pub mod components;
pub mod sparse_set;

pub use components::{MeshRenderer, MeshType, Transform};
pub use sparse_set::SparseSet;
```

### Step 4 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished` (le module ecs n'est pas encore importé dans lib.rs → aucune erreur possible).

---

## Task 2 : Réécrire `lib.rs` — World struct + init GPU

**Files:**
- Modify: `engine-core/src/lib.rs`

**Objectif :** Remplacer `Engine` par `World`. La partie init est identique à l'ancien `Engine::init`, seule la struct change.

### Step 1 : Réécrire `engine-core/src/lib.rs` (partie struct + init)

```rust
#![cfg(target_arch = "wasm32")]

mod camera;
mod ecs;
mod mesh;

use camera::Camera;
use ecs::{MeshRenderer, MeshType, SparseSet, Transform};
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES};

use bytemuck;
use glam::{EulerRot, Mat4};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

// ─── Ressources GPU par entité ───────────────────────────────────────────────

struct EntityGpu {
    uniform_buffer: wgpu::Buffer,
    bind_group:     wgpu::BindGroup,
}

// ─── World ───────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct World {
    // GPU core
    device:  wgpu::Device,
    queue:   wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config:  wgpu::SurfaceConfiguration,

    // Depth buffer
    depth_texture: wgpu::Texture,
    depth_view:    wgpu::TextureView,

    // Pipeline
    render_pipeline:   wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,

    // Géométrie partagée
    vertex_buffer: wgpu::Buffer,
    index_buffer:  wgpu::Buffer,

    // ECS
    next_id:       usize,
    transforms:    SparseSet<Transform>,
    mesh_renderers: SparseSet<MeshRenderer>,
    entity_gpus:   SparseSet<EntityGpu>,

    // Caméra globale (sera un composant ECS en Phase 4)
    camera: Camera,
}

// ─── Helper : depth texture ───────────────────────────────────────────────────

fn create_depth_texture(
    device: &wgpu::Device,
    config: &wgpu::SurfaceConfiguration,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth_texture"),
        size: wgpu::Extent3d {
            width:                 config.width,
            height:                config.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count:    1,
        dimension:       wgpu::TextureDimension::D2,
        format:          wgpu::TextureFormat::Depth32Float,
        usage:           wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats:    &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

// ─── World::new ──────────────────────────────────────────────────────────────

#[wasm_bindgen]
impl World {
    pub async fn new(canvas: HtmlCanvasElement) -> Result<World, JsValue> {
        console_error_panic_hook::set_once();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        let width  = canvas.width();
        let height = canvas.height();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::default(),
                compatible_surface:     Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let surface_caps = surface.get_capabilities(&adapter);
        let format = surface_caps
            .formats
            .first()
            .copied()
            .ok_or_else(|| JsValue::from_str("Aucun format de surface supporté"))?;

        let config = wgpu::SurfaceConfiguration {
            usage:                         wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode:                  wgpu::PresentMode::Fifo,
            alpha_mode:                    wgpu::CompositeAlphaMode::Opaque,
            view_formats:                  vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let (depth_texture, depth_view) = create_depth_texture(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bind_group_layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            ..Default::default()
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("render_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module:      &shader,
                entry_point: Some("vs_main"),
                buffers:     &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module:      &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology:           wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face:         wgpu::FrontFace::Ccw,
                cull_mode:          Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::Less,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample:    wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache:          None,
        });

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("vertex_buffer"),
            contents: bytemuck::cast_slice(CUBE_VERTICES),
            usage:    wgpu::BufferUsages::VERTEX,
        });

        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("index_buffer"),
            contents: bytemuck::cast_slice(CUBE_INDICES),
            usage:    wgpu::BufferUsages::INDEX,
        });

        web_sys::console::log_1(&"[World] Pipeline 3D initialisée".into());

        Ok(World {
            device,
            queue,
            surface,
            config,
            depth_texture,
            depth_view,
            render_pipeline,
            bind_group_layout,
            vertex_buffer,
            index_buffer,
            next_id:        0,
            transforms:     SparseSet::new(),
            mesh_renderers: SparseSet::new(),
            entity_gpus:    SparseSet::new(),
            camera:         Camera::default(),
        })
    }
}
```

### Step 2 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`. Des warnings `dead_code` sur les champs ECS sont normaux (pas encore utilisés).

---

## Task 3 : Ajouter les méthodes de scène + `render_frame` à `lib.rs`

**Files:**
- Modify: `engine-core/src/lib.rs`

**Objectif :** Ajouter le second bloc `#[wasm_bindgen] impl World` à la fin du fichier.

### Step 1 : Ajouter à la fin de `engine-core/src/lib.rs`

```rust
#[wasm_bindgen]
impl World {
    // ── Entités ──────────────────────────────────────────────────────────────

    /// Crée une entité vide. Retourne son handle (usize).
    pub fn create_entity(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    // ── Transform ────────────────────────────────────────────────────────────

    /// Ajoute un composant Transform à l'entité (position initiale xyz).
    pub fn add_transform(&mut self, id: usize, x: f32, y: f32, z: f32) {
        let mut t = Transform::default();
        t.position = glam::Vec3::new(x, y, z);
        self.transforms.insert(id, t);
    }

    pub fn set_position(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.position = glam::Vec3::new(x, y, z);
        }
    }

    pub fn set_rotation(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.rotation = glam::Vec3::new(x, y, z);
        }
    }

    pub fn set_scale(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.scale = glam::Vec3::new(x, y, z);
        }
    }

    // ── MeshRenderer ─────────────────────────────────────────────────────────

    /// Ajoute un MeshRenderer Cube + crée les ressources GPU associées.
    pub fn add_mesh_renderer(&mut self, id: usize) {
        self.mesh_renderers.insert(id, MeshRenderer { mesh_type: MeshType::Cube });

        let uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("entity_uniform"),
            size:               std::mem::size_of::<Mat4>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("entity_bind_group"),
            layout:  &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        self.entity_gpus.insert(id, EntityGpu { uniform_buffer, bind_group });
    }

    // ── Caméra ───────────────────────────────────────────────────────────────

    pub fn set_camera(&mut self, ex: f32, ey: f32, ez: f32, tx: f32, ty: f32, tz: f32) {
        self.camera.eye    = glam::Vec3::new(ex, ey, ez);
        self.camera.target = glam::Vec3::new(tx, ty, tz);
    }

    // ── Rendu ─────────────────────────────────────────────────────────────────

    pub fn render_frame(&self, _delta_ms: f32) {
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::OutOfMemory) => {
                web_sys::console::error_1(&"[World] GPU hors mémoire".into());
                return;
            }
            Err(_) => return,
        };

        let view   = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let aspect = self.config.width as f32 / self.config.height as f32;

        let view_mat = self.camera.view_matrix();
        let proj_mat = self.camera.proj_matrix(aspect);

        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // Upload MVP pour chaque entité avec Transform + MeshRenderer
        for (id, transform) in self.transforms.iter() {
            if self.mesh_renderers.get(id).is_none() { continue; }
            let Some(gpu) = self.entity_gpus.get(id) else { continue };

            let model = Mat4::from_translation(transform.position)
                * Mat4::from_euler(
                    EulerRot::XYZ,
                    transform.rotation.x.to_radians(),
                    transform.rotation.y.to_radians(),
                    transform.rotation.z.to_radians(),
                )
                * Mat4::from_scale(transform.scale);

            let mvp = proj_mat * view_mat * model;
            self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&mvp));
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &view,
                    resolve_target: None,
                    depth_slice:    None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.05, g: 0.05, b: 0.08, a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes:    None,
                occlusion_query_set: None,
                multiview_mask:      None,
            });

            pass.set_pipeline(&self.render_pipeline);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);

            // Draw call par entité qui a un MeshRenderer + EntityGpu
            for (id, _renderer) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };
                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
    }
}
```

### Step 2 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : **0 erreurs**.

---

## Task 4 : Supprimer `scene.rs` + nettoyer `lib.rs`

**Files:**
- Delete: `engine-core/src/scene.rs`
- Modify: `engine-core/src/lib.rs` — retirer `mod scene;`

### Step 1 : Supprimer la ligne `mod scene;` dans `lib.rs`

Retirer la ligne `mod scene;` en haut de `lib.rs` (et `use scene::Entity;` si présent).

### Step 2 : Supprimer le fichier `scene.rs`

```bash
rm E:/Programmation/webgpu-engine/engine-core/src/scene.rs
```

### Step 3 : Vérifier la compilation finale

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished` sans aucune erreur.

---

## Task 5 : Mettre à jour `main.ts`

**Files:**
- Modify: `game-app/src/main.ts`

### Step 1 : Réécrire `game-app/src/main.ts`

```typescript
import init, { World } from '../../engine-core/pkg/engine_core.js';

await init();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML =
    `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// Créer une entité cube via l'ECS
const cube = world.create_entity();
world.add_transform(cube, 0, 0, 0);
world.add_mesh_renderer(cube);
world.set_camera(3, 2, 5,  0, 0, 0);

let angle    = 0;
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  angle += delta * 0.05; // ~18°/sec

  world.set_rotation(cube, 15, angle, 0);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
```

---

## Task 6 : Build WASM + commit

**Files:**
- No code change — build + commit only.

### Step 1 : Build WASM

```bash
cd E:/Programmation/webgpu-engine/engine-core
wasm-pack build --target web 2>&1 | tail -5
```

Attendu : `Done in XX.XXs` + `Your wasm pkg is ready`.

### Step 2 : Commit engine-core

```bash
cd E:/Programmation/webgpu-engine/engine-core
git add Cargo.toml Cargo.lock src/lib.rs src/ecs/mod.rs src/ecs/sparse_set.rs src/ecs/components.rs
git rm src/scene.rs
git commit -m "feat(engine-core): Phase 1 — ECS Foundation (SparseSet, World, Transform, MeshRenderer)"
```

### Step 3 : Commit root repo + game-app

```bash
cd E:/Programmation/webgpu-engine
git add engine-core game-app/src/main.ts
git commit -m "feat: Phase 1 — ECS Foundation (submodule + main.ts)"
```

### Step 4 : Test visuel

1. S'assurer que `npm run dev` tourne dans `game-app/`
2. Rafraîchir http://localhost:5173 (Ctrl+Shift+R hard refresh)
3. **Attendu :** Exactement le même cube coloré tournant qu'avant — mais propulsé par l'ECS en interne.
4. Console DevTools : `[World] Pipeline 3D initialisée` sans erreur.

---

## Rappel workflow

```bash
# Terminal 1 (laisser tourner)
cd game-app && npm run dev

# Terminal 2 (après modifs Rust)
cd engine-core && wasm-pack build --target web
# Puis Ctrl+Shift+R dans Chrome/Edge
```
