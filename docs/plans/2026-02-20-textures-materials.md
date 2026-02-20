# Phase 2 — Textures + Matériaux

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permettre de charger des images RGBA en GPU et de les appliquer sur des entités via un composant `Material` — le cube peut afficher une texture (ou un motif généré en TS).

**Architecture:** Deux bind groups séparés : Group 0 = MVP (par entité, inchangé), Group 1 = texture+sampler (partagé par texture, sélectionné en render_frame). `upload_texture(width, height, &[u8])` crée une `TextureGpu` et retourne un `u32` TextureId. `add_material(entity_id, texture_id)` ajoute un composant `Material` ECS. Par défaut, les entités sans Material utilisent une texture blanche 1×1 → vertex colors passent en transparence. TS génère un motif damier programmatiquement (pas de fichier image externe requis).

**Tech Stack:** Rust 2024 edition, wgpu 28 (`TexelCopyTextureInfo`, `TexelCopyBufferLayout`), glam 0.29, bytemuck 1, wasm-bindgen 0.2, wasm-pack --target web, TypeScript, Vite 7.

**Design doc :** `docs/plans/2026-02-20-webunity-roadmap-design.md`

---

## Fichiers touchés

```
engine-core/src/
├── mesh.rs             ← MODIFY : ajouter uv: [f32; 2] à Vertex + UVs dans CUBE_VERTICES
├── shader.wgsl         ← REWRITE : group 1 texture+sampler, UV in/out, textureSample
├── ecs/components.rs   ← MODIFY : ajouter struct Material { texture_id: u32 }
├── ecs/mod.rs          ← MODIFY : re-exporter Material
└── lib.rs              ← MODIFY : TextureGpu struct, nouveaux champs World, nouveaux helpers,
                                   nouvelles méthodes wasm API, render_frame bind group 1
game-app/src/
└── main.ts             ← MODIFY : createCheckerTexture() helper + demo texturée
```

---

## Task 1 : Mettre à jour `mesh.rs` — UV coordinates

**Files:**
- Modify: `engine-core/src/mesh.rs`

### Step 1 : Ajouter `uv` au struct `Vertex` et à `Vertex::desc()`

Remplacer le contenu complet de `engine-core/src/mesh.rs` :

```rust
use bytemuck::{Pod, Zeroable};
use std::mem;

/// Vertex avec position xyz, couleur rgb, et coordonnées UV.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub color:    [f32; 3],
    pub uv:       [f32; 2],
}

impl Vertex {
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                // @location(0) position
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x3,
                },
                // @location(1) color
                wgpu::VertexAttribute {
                    offset: mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x3,
                },
                // @location(2) uv
                wgpu::VertexAttribute {
                    offset: (mem::size_of::<[f32; 3]>() * 2) as wgpu::BufferAddress,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x2,
                },
            ],
        }
    }
}

// UVs : même motif pour chaque face — (0,1) BL, (1,1) BR, (1,0) TR, (0,0) TL
pub const CUBE_VERTICES: &[Vertex] = &[
    // Front (z = +0.5) — rouge
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 0.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 0.0] },
    // Back (z = -0.5) — vert
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 1.0] },
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 1.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 0.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 0.0] },
    // Left (x = -0.5) — bleu
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 1.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 1.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 0.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 0.0] },
    // Right (x = +0.5) — jaune
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 0.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 0.0] },
    // Bottom (y = -0.5) — orange
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 1.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 0.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 0.0] },
    // Top (y = +0.5) — violet
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 0.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 0.0] },
];

pub const CUBE_INDICES: &[u16] = &[
     0,  1,  2,   0,  2,  3,  // Front
     4,  5,  6,   4,  6,  7,  // Back
     8,  9, 10,   8, 10, 11,  // Left
    12, 13, 14,  12, 14, 15,  // Right
    16, 17, 18,  16, 18, 19,  // Bottom
    20, 21, 22,  20, 22, 23,  // Top
];
```

### Step 2 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`. Des erreurs dans lib.rs sur le vertex buffer sont normales si le stride change — elles seront résolues à la Task 4.

---

## Task 2 : Réécrire `shader.wgsl`

**Files:**
- Modify: `engine-core/src/shader.wgsl`

### Step 1 : Remplacer le contenu complet de `engine-core/src/shader.wgsl`

```wgsl
// Group 0 : MVP par entité
@group(0) @binding(0)
var<uniform> mvp: mat4x4<f32>;

// Group 1 : texture + sampler (partagé par texture)
@group(1) @binding(0) var t_albedo: texture_2d<f32>;
@group(1) @binding(1) var s_albedo: sampler;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color:    vec3<f32>,
    @location(2) uv:       vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0)       color:    vec3<f32>,
    @location(1)       uv:       vec2<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_pos = mvp * vec4<f32>(in.position, 1.0);
    out.color    = in.color;
    out.uv       = in.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Texture × vertex color : texture blanche → vertex colors passent en transparence
    let tex = textureSample(t_albedo, s_albedo, in.uv);
    return tex * vec4<f32>(in.color, 1.0);
}
```

---

## Task 3 : Ajouter `Material` au module ECS

**Files:**
- Modify: `engine-core/src/ecs/components.rs`
- Modify: `engine-core/src/ecs/mod.rs`

### Step 1 : Ajouter `Material` à `engine-core/src/ecs/components.rs`

Ajouter à la fin du fichier :

```rust
// ── Material ───────────────────────────────────────────────────────────────

/// Associe une texture (par TextureId) à une entité.
/// Si absent, l'entité utilise la texture blanche par défaut.
pub struct Material {
    pub texture_id: u32,
}
```

### Step 2 : Re-exporter `Material` dans `engine-core/src/ecs/mod.rs`

Modifier la ligne de re-export :

```rust
pub use components::{Material, MeshRenderer, MeshType, Transform};
```

### Step 3 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

---

## Task 4 : Mettre à jour `lib.rs` — nouveaux champs World + World::new()

**Files:**
- Modify: `engine-core/src/lib.rs`

**Objectif :** Ajouter `TextureGpu`, les nouveaux champs à `World`, et mettre à jour `World::new()` pour créer le texture bind group layout, le sampler, la texture blanche par défaut, et mettre à jour la pipeline layout.

### Step 1 : Mettre à jour les imports en haut de `lib.rs`

Remplacer la ligne `use ecs::{...}` par :

```rust
use ecs::{Material, MeshRenderer, MeshType, SparseSet, Transform};
```

### Step 2 : Ajouter `TextureGpu` après `EntityGpu`

Ajouter après le struct `EntityGpu` :

```rust
/// Ressources GPU pour une texture chargée (partageable entre entités).
struct TextureGpu {
    #[allow(dead_code)]
    texture:    wgpu::Texture,
    view:       wgpu::TextureView,
    bind_group: wgpu::BindGroup, // Group 1 — texture + sampler
}
```

### Step 3 : Ajouter les nouveaux champs à `World`

Dans le struct `World`, après `entity_gpus: SparseSet<EntityGpu>`, ajouter :

```rust
    // Textures
    texture_bind_group_layout: wgpu::BindGroupLayout,
    #[allow(dead_code)]
    sampler:                   wgpu::Sampler,
    default_tex:               TextureGpu,
    textures:                  Vec<TextureGpu>,

    // ECS — composants supplémentaires
    materials: SparseSet<Material>,
```

### Step 4 : Ajouter le helper `create_texture_from_data`

Ajouter après `create_depth_texture` :

```rust
/// Crée une TextureGpu depuis des données RGBA brutes.
fn create_texture_from_data(
    device:  &wgpu::Device,
    queue:   &wgpu::Queue,
    width:   u32,
    height:  u32,
    data:    &[u8],
    layout:  &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
) -> TextureGpu {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("tex"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count:    1,
        dimension:       wgpu::TextureDimension::D2,
        format:          wgpu::TextureFormat::Rgba8UnormSrgb,
        usage:           wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats:    &[],
    });

    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture:   &texture,
            mip_level: 0,
            origin:    wgpu::Origin3d::ZERO,
            aspect:    wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset:         0,
            bytes_per_row:  Some(4 * width),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );

    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label:   Some("tex_bind_group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding:  0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding:  1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    });

    TextureGpu { texture, view, bind_group }
}
```

### Step 5 : Mettre à jour `World::new()` — ajouter texture infrastructure

Dans `World::new()`, après la création de `bind_group_layout` (Group 0), ajouter :

```rust
        // Texture bind group layout (Group 1) : texture + sampler
        let texture_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture_bind_group_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding:    0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        // Sampler partagé (linear, clamp-to-edge)
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter:     wgpu::FilterMode::Linear,
            min_filter:     wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Texture blanche 1×1 par défaut → vertex colors passent en transparence
        let default_tex = create_texture_from_data(
            &device, &queue, 1, 1,
            &[255u8, 255, 255, 255],
            &texture_bind_group_layout, &sampler,
        );
```

### Step 6 : Mettre à jour `pipeline_layout` pour inclure les deux layouts

Remplacer la création de `pipeline_layout` :

```rust
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout, &texture_bind_group_layout],
            ..Default::default()
        });
```

### Step 7 : Mettre à jour le constructeur `Ok(World { ... })`

Ajouter les nouveaux champs dans le `Ok(World { ... })` à la fin de `World::new()` :

```rust
            texture_bind_group_layout,
            sampler,
            default_tex,
            textures:  Vec::new(),
            materials: SparseSet::new(),
```

### Step 8 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`. Warnings dead_code normaux. Si erreur sur `TexelCopyTextureInfo` ou `TexelCopyBufferLayout` → utiliser `ImageCopyTexture` / `ImageDataLayout` (anciens noms).

---

## Task 5 : Ajouter `upload_texture`, `add_material` + mettre à jour `render_frame`

**Files:**
- Modify: `engine-core/src/lib.rs`

**Objectif :** Ajouter les méthodes wasm + mettre à jour `render_frame` pour sélectionner le bind group 1 correct.

### Step 1 : Ajouter dans le second bloc `#[wasm_bindgen] impl World`

Ajouter après `set_camera` et avant `render_frame` :

```rust
    // ── Textures ──────────────────────────────────────────────────────────────

    /// Charge des pixels RGBA bruts en GPU. Retourne un TextureId (u32).
    /// Côté TS : passer un Uint8Array de taille width * height * 4.
    pub fn upload_texture(&mut self, width: u32, height: u32, data: &[u8]) -> u32 {
        let tex = create_texture_from_data(
            &self.device, &self.queue,
            width, height, data,
            &self.texture_bind_group_layout, &self.sampler,
        );
        let id = self.textures.len() as u32;
        self.textures.push(tex);
        id
    }

    /// Associe une texture à une entité (doit avoir un MeshRenderer).
    pub fn add_material(&mut self, entity_id: usize, texture_id: u32) {
        self.materials.insert(entity_id, Material { texture_id });
    }
```

### Step 2 : Mettre à jour `render_frame` — set_bind_group(1, ...)

Dans la boucle de draw calls (après `pass.set_index_buffer`), remplacer la boucle existante :

```rust
            // Draw call par entité : bind group 0 (MVP) + bind group 1 (texture)
            for (id, _renderer) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };

                // Sélectionner la texture : Material si présent, sinon blanc par défaut
                let tex_bg = if let Some(mat) = self.materials.get(id) {
                    let tex_idx = mat.texture_id as usize;
                    if tex_idx < self.textures.len() {
                        &self.textures[tex_idx].bind_group
                    } else {
                        &self.default_tex.bind_group
                    }
                } else {
                    &self.default_tex.bind_group
                };

                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.set_bind_group(1, tex_bg, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
            }
```

### Step 3 : Vérifier la compilation

```bash
cd E:/Programmation/webgpu-engine/engine-core
cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : **0 erreurs**.

---

## Task 6 : Mettre à jour `main.ts` — demo texturée

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

// ── Générer une texture damier 8×8 programmatiquement ────────────────────────
function createCheckerTexture(world: World, size: number): number {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLight = (x + y) % 2 === 0;
      const i = (y * size + x) * 4;
      data[i]     = isLight ? 255 : 40;  // R
      data[i + 1] = isLight ? 255 : 40;  // G
      data[i + 2] = isLight ? 255 : 40;  // B
      data[i + 3] = 255;                 // A
    }
  }
  return world.upload_texture(size, size, data);
}

// ── Scène ─────────────────────────────────────────────────────────────────────
const checkerId = createCheckerTexture(world, 8);

const cube = world.create_entity();
world.add_transform(cube, 0, 0, 0);
world.add_mesh_renderer(cube);
world.add_material(cube, checkerId);   // ← texture damier appliquée
world.set_camera(3, 2, 5,  0, 0, 0);

let angle    = 0;
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  angle += delta * 0.05;
  world.set_rotation(cube, 15, angle, 0);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
```

---

## Task 7 : Build WASM + commits

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
git add src/mesh.rs src/shader.wgsl src/ecs/components.rs src/ecs/mod.rs src/lib.rs
git commit -m "feat(engine-core): Phase 2 — Textures + Matériaux (UV, TextureGpu, Material ECS, two bind groups)"
```

### Step 3 : Commit root repo + game-app

```bash
cd E:/Programmation/webgpu-engine
git add engine-core game-app/src/main.ts
git commit -m "feat: Phase 2 — Textures + Matériaux (submodule + checkerboard demo)"
```

### Step 4 : Test visuel

1. `npm run dev` dans `game-app/` si pas lancé
2. Ctrl+Shift+R sur http://localhost:5173
3. **Attendu :** Cube tournant avec un motif damier noir/blanc sur chaque face (vertex colors modifiés par la texture damier — faces légèrement teintées). Fond sombre quasi-noir.
4. Console DevTools : `[World] Pipeline 3D initialisée` sans erreur.

### Step 5 : Si les faces semblent toutes blanches

Tester avec une texture unie colorée pour vérifier que les vertex colors fonctionnent :
```typescript
// Remplacer createCheckerTexture par une texture unie rouge :
const data = new Uint8Array([255, 128, 128, 255]); // RGBA
const texId = world.upload_texture(1, 1, data);
```

---

## Rappel workflow

```bash
# Terminal 1
cd game-app && npm run dev

# Terminal 2 (après modifs Rust)
cd engine-core && wasm-pack build --target web
# Puis Ctrl+Shift+R dans Chrome/Edge
```
