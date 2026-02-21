# Phase 4 — Éclairage Phong : Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter l'éclairage Blinn-Phong complet (ambient + diffuse + specular) avec point lights ECS et lumière directionnelle, via un 3e bind group GPU partagé (LightUniforms).

**Architecture:** Ajout de normales dans le Vertex struct, `EntityUniforms { mvp, model }` en Group 0 (128 bytes au lieu de 64), `LightUniforms` (320 bytes, max 8 point lights + 1 directional) en Group 2. Les point lights sont des entités ECS avec Transform. Le fragment shader implémente Blinn-Phong (ambient constant 0.15, diffuse N·L, specular shininess=32 fixe).

**Tech Stack:** Rust/WASM (wgpu 28, glam 0.29, bytemuck 1), WGSL, TypeScript

**Design doc:** `docs/plans/2026-02-21-phase4-lighting-design.md`

---

## Task 1 : Composant PointLight ECS

**Files:**
- Modify: `engine-core/src/ecs/components.rs`
- Modify: `engine-core/src/ecs/mod.rs`

### Step 1 : Ajouter PointLight dans components.rs

À la fin du fichier `engine-core/src/ecs/components.rs`, ajouter :

```rust
// ── PointLight ────────────────────────────────────────────────────────────

pub struct PointLight {
    pub color:     glam::Vec3,
    pub intensity: f32,
}
```

### Step 2 : Re-exporter PointLight dans mod.rs

Modifier la ligne `pub use` dans `engine-core/src/ecs/mod.rs` :

```rust
pub use components::{Collider, Material, MeshRenderer, MeshType, PointLight, RigidBody, Transform};
```

### Step 3 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/ecs/components.rs src/ecs/mod.rs
git -C engine-core commit -m "feat(ecs): add PointLight component"
```

---

## Task 2 : Types GPU + World struct + World::new

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter les structs GPU et DirectionalLightData

Après les imports existants (après `struct TextureGpu { ... }`), ajouter dans `lib.rs` :

```rust
// ── Types GPU pour l'éclairage ────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct EntityUniforms {
    mvp:   [[f32; 4]; 4],
    model: [[f32; 4]; 4],
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuDirectionalLight {
    direction: [f32; 3], _p0: f32,
    color:     [f32; 3], intensity: f32,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuPointLight {
    position:  [f32; 3], _p0: f32,
    color:     [f32; 3], intensity: f32,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct LightUniforms {
    camera_pos:  [f32; 4],             // offset   0 — xyz utilisé, w=0
    directional: GpuDirectionalLight,  // offset  16 — 32 bytes
    n_points:    u32,                  // offset  48
    _pad:        [u32; 3],             // offset  52 — alignement array<PointLight,8> sur 16
    points:      [GpuPointLight; 8],   // offset  64 — 8 × 32 = 256 bytes
}
// Total : 320 bytes

/// Données CPU pour la lumière directionnelle unique.
struct DirectionalLightData {
    direction: glam::Vec3,
    color:     glam::Vec3,
    intensity: f32,
}
```

**Note layout :** `array<PointLight, 8>` en WGSL doit commencer à un multiple de 16. Les 4 bytes `n_points` + 12 bytes `_pad` (= 16 bytes) entre `directional` (fin à offset 48) et `points` garantissent l'offset 64 ✓.

### Step 2 : Ajouter les nouveaux champs au World struct

Dans le struct `World`, ajouter après le champ `camera_pitch`:

```rust
    // Éclairage
    point_lights:       ecs::SparseSet<ecs::PointLight>,
    directional_light:  Option<DirectionalLightData>,
    light_bind_group_layout: wgpu::BindGroupLayout,
    light_buffer:            wgpu::Buffer,
    light_bind_group:        wgpu::BindGroup,
```

### Step 3 : Créer les ressources lumière dans World::new

Dans la fonction `World::new`, **avant** la création du `pipeline_layout`, ajouter :

```rust
        // ── Light bind group layout (Group 2) ────────────────────────────────
        let light_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("light_bind_group_layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let light_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("light_buffer"),
            size:               std::mem::size_of::<LightUniforms>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let light_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("light_bind_group"),
            layout:  &light_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: light_buffer.as_entire_binding(),
            }],
        });
```

### Step 4 : Ajouter le 3e bind group layout au pipeline_layout

Remplacer la création existante du `pipeline_layout` :

```rust
        // AVANT :
        // let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        //     label:              Some("pipeline_layout"),
        //     bind_group_layouts: &[&bind_group_layout, &texture_bind_group_layout],
        //     ..Default::default()
        // });

        // APRÈS :
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout, &texture_bind_group_layout, &light_bind_group_layout],
            ..Default::default()
        });
```

### Step 5 : Initialiser les nouveaux champs dans Ok(World { ... })

Dans le bloc `Ok(World { ... })`, ajouter après `camera_pitch: 0.0,` :

```rust
            point_lights:      SparseSet::new(),
            directional_light: None,
            light_bind_group_layout,
            light_buffer,
            light_bind_group,
```

### Step 6 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 7 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(gpu): LightUniforms + light bind group (Group 2)"
```

---

## Task 3 : API wasm_bindgen — add_point_light + add_directional_light

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter les méthodes dans un nouveau bloc impl World

Ajouter un nouveau bloc `#[wasm_bindgen] impl World { ... }` à la fin de `lib.rs` :

```rust
#[wasm_bindgen]
impl World {
    // ── Éclairage ────────────────────────────────────────────────────────────

    /// Ajoute une point light attachée à l'entité (doit avoir un Transform).
    /// Couleur (r, g, b) entre 0.0 et 1.0, intensity en lux (ex: 5.0–20.0).
    pub fn add_point_light(&mut self, id: usize, r: f32, g: f32, b: f32, intensity: f32) {
        self.point_lights.insert(id, ecs::PointLight {
            color:     glam::Vec3::new(r, g, b),
            intensity,
        });
    }

    /// Définit la lumière directionnelle (soleil). Un seul appel suffit.
    /// direction (dx, dy, dz) : vecteur vers lequel la lumière pointe (normalisé automatiquement).
    /// Couleur (r, g, b) entre 0.0 et 1.0.
    pub fn add_directional_light(
        &mut self,
        dx: f32, dy: f32, dz: f32,
        r: f32, g: f32, b: f32,
        intensity: f32,
    ) {
        self.directional_light = Some(DirectionalLightData {
            direction: glam::Vec3::new(dx, dy, dz),
            color:     glam::Vec3::new(r, g, b),
            intensity,
        });
    }
}
```

### Step 2 : Ajouter l'import `ecs` dans les imports en haut de lib.rs

Vérifier que `use ecs::SparseSet;` existe. Si non, ou si `ecs` n'est pas importé comme module, ajouter :

```rust
use ecs;  // pour ecs::PointLight dans add_point_light
```

**Note :** Le `mod ecs;` est déjà présent. Dans le code `add_point_light`, on utilise `ecs::PointLight` (chemin pleinement qualifié). S'il y a une ambiguïté, on peut importer directement : `use ecs::PointLight;` dans le bloc impl ou en haut de fichier, au même endroit que les autres imports ECS.

Si le `use ecs::{ ... }` en haut du fichier liste déjà les types importés, ajouter `PointLight` à la liste :

```rust
use ecs::{Collider, Material, MeshRenderer, MeshType, PointLight, RigidBody, SparseSet, Transform};
```

### Step 3 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(api): add_point_light + add_directional_light wasm_bindgen API"
```

---

## Task 4 : add_mesh_renderer — buffer EntityUniforms (128 bytes)

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Remplacer la taille du buffer dans add_mesh_renderer

Dans la méthode `add_mesh_renderer`, remplacer la création du `uniform_buffer` :

```rust
        // AVANT :
        // let uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
        //     label:              Some("entity_uniform"),
        //     size:               std::mem::size_of::<Mat4>() as u64,
        //     ...
        // });

        // APRÈS :
        let uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("entity_uniform"),
            size:               std::mem::size_of::<EntityUniforms>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
```

### Step 2 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(gpu): EntityUniforms buffer 128 bytes (MVP + Model)"
```

---

## Task 5 : render_frame — upload EntityUniforms + LightUniforms + Group 2

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Remplacer l'upload MVP dans render_frame

Dans `render_frame`, remplacer la boucle d'upload MVP :

```rust
        // AVANT :
        // for (id, transform) in self.transforms.iter() {
        //     ...
        //     let mvp = proj_mat * view_mat * model;
        //     self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&mvp));
        // }

        // APRÈS :
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

            let uniforms = EntityUniforms {
                mvp:   mvp.to_cols_array_2d(),
                model: model.to_cols_array_2d(),
            };
            self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        }
```

### Step 2 : Construire et uploader LightUniforms avant le render pass

Juste après la boucle d'upload MVP (avant `let mut encoder = ...`), ajouter :

```rust
        // ── Upload LightUniforms (Group 2) ───────────────────────────────────
        {
            let mut lu = LightUniforms::zeroed();
            lu.camera_pos = [
                self.camera.eye.x, self.camera.eye.y, self.camera.eye.z, 0.0,
            ];

            if let Some(dl) = &self.directional_light {
                let dir = dl.direction.normalize();
                lu.directional = GpuDirectionalLight {
                    direction: dir.to_array(),
                    _p0: 0.0,
                    color: dl.color.to_array(),
                    intensity: dl.intensity,
                };
            }

            let mut n = 0usize;
            // Collecter les IDs pour éviter le double-borrow
            let light_ids: Vec<usize> = self.point_lights
                .iter()
                .map(|(id, _)| id)
                .collect();
            for id in light_ids {
                if n >= 8 { break; }
                let (Some(pl), Some(tr)) = (self.point_lights.get(id), self.transforms.get(id)) else { continue };
                lu.points[n] = GpuPointLight {
                    position:  tr.position.to_array(),
                    _p0: 0.0,
                    color:     pl.color.to_array(),
                    intensity: pl.intensity,
                };
                n += 1;
            }
            lu.n_points = n as u32;

            self.queue.write_buffer(&self.light_buffer, 0, bytemuck::bytes_of(&lu));
        }
```

### Step 3 : Binder le Group 2 dans le render pass

Dans le render pass (boucle de draw calls), après `pass.set_bind_group(1, tex_bg, &[]);`, ajouter :

```rust
                pass.set_bind_group(2, &self.light_bind_group, &[]);
```

La séquence complète du draw call devient :

```rust
                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.set_bind_group(1, tex_bg, &[]);
                pass.set_bind_group(2, &self.light_bind_group, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
```

### Step 4 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 5 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(render): upload EntityUniforms + LightUniforms, bind Group 2"
```

---

## Task 6 : Vertex — ajouter les normales + CUBE_VERTICES

**Files:**
- Modify: `engine-core/src/mesh.rs`

### Step 1 : Ajouter le champ normal au Vertex struct

```rust
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub color:    [f32; 3],
    pub uv:       [f32; 2],
    pub normal:   [f32; 3],  // ← nouveau (stride passe de 32 à 44 bytes)
}
```

### Step 2 : Mettre à jour Vertex::desc()

Remplacer l'implémentation complète de `Vertex::desc()` :

```rust
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        use std::mem;
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                // @location(0) position
                wgpu::VertexAttribute {
                    offset:           0,
                    shader_location:  0,
                    format:           wgpu::VertexFormat::Float32x3,
                },
                // @location(1) color
                wgpu::VertexAttribute {
                    offset:           mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                    shader_location:  1,
                    format:           wgpu::VertexFormat::Float32x3,
                },
                // @location(2) uv
                wgpu::VertexAttribute {
                    offset:           (mem::size_of::<[f32; 3]>() * 2) as wgpu::BufferAddress,
                    shader_location:  2,
                    format:           wgpu::VertexFormat::Float32x2,
                },
                // @location(3) normal
                wgpu::VertexAttribute {
                    offset:           (mem::size_of::<[f32; 3]>() * 2 + mem::size_of::<[f32; 2]>()) as wgpu::BufferAddress,
                    shader_location:  3,
                    format:           wgpu::VertexFormat::Float32x3,
                },
            ],
        }
    }
```

### Step 3 : Remplacer CUBE_VERTICES avec les normales per-face

Remplacer l'intégralité de la constante `CUBE_VERTICES` :

```rust
pub const CUBE_VERTICES: &[Vertex] = &[
    // Front (z = +0.5) — normale +Z — rouge
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 1.0], normal: [0.0, 0.0,  1.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 1.0], normal: [0.0, 0.0,  1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 0.0], normal: [0.0, 0.0,  1.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 0.0], normal: [0.0, 0.0,  1.0] },
    // Back (z = -0.5) — normale -Z — vert
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 1.0], normal: [0.0, 0.0, -1.0] },
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 1.0], normal: [0.0, 0.0, -1.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 0.0], normal: [0.0, 0.0, -1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 0.0], normal: [0.0, 0.0, -1.0] },
    // Left (x = -0.5) — normale -X — bleu
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 1.0], normal: [-1.0, 0.0, 0.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 1.0], normal: [-1.0, 0.0, 0.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 0.0], normal: [-1.0, 0.0, 0.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 0.0], normal: [-1.0, 0.0, 0.0] },
    // Right (x = +0.5) — normale +X — jaune
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 1.0], normal: [ 1.0, 0.0, 0.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 1.0], normal: [ 1.0, 0.0, 0.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 0.0], normal: [ 1.0, 0.0, 0.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 0.0], normal: [ 1.0, 0.0, 0.0] },
    // Bottom (y = -0.5) — normale -Y — orange
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 1.0], normal: [0.0, -1.0, 0.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 1.0], normal: [0.0, -1.0, 0.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 0.0], normal: [0.0, -1.0, 0.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 0.0], normal: [0.0, -1.0, 0.0] },
    // Top (y = +0.5) — normale +Y — violet
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 1.0], normal: [0.0,  1.0, 0.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 1.0], normal: [0.0,  1.0, 0.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 0.0], normal: [0.0,  1.0, 0.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 0.0], normal: [0.0,  1.0, 0.0] },
];
```

### Step 4 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 5 : Commit

```bash
git -C engine-core add src/mesh.rs
git -C engine-core commit -m "feat(mesh): add normals to Vertex + CUBE_VERTICES per-face normals"
```

---

## Task 7 : Shader WGSL — Blinn-Phong complet

**Files:**
- Modify: `engine-core/src/shader.wgsl`

### Step 1 : Remplacer intégralement shader.wgsl

```wgsl
// ── Group 0 — uniforms par entité (MVP + Model) ──────────────────────────
struct EntityUniforms {
    mvp:   mat4x4<f32>,
    model: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> entity: EntityUniforms;

// ── Group 1 — texture ────────────────────────────────────────────────────
@group(1) @binding(0) var t_albedo: texture_2d<f32>;
@group(1) @binding(1) var s_albedo: sampler;

// ── Group 2 — lumières ───────────────────────────────────────────────────
struct DirectionalLight {
    direction: vec3<f32>,
    color:     vec3<f32>,
    intensity: f32,
}

struct PointLight {
    position:  vec3<f32>,
    color:     vec3<f32>,
    intensity: f32,
}

struct LightUniforms {
    camera_pos:  vec4<f32>,
    directional: DirectionalLight,
    n_points:    u32,
    pad0: u32, pad1: u32, pad2: u32,
    points:      array<PointLight, 8>,
}
@group(2) @binding(0) var<uniform> lights: LightUniforms;

// ── Vertex I/O ───────────────────────────────────────────────────────────
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color:    vec3<f32>,
    @location(2) uv:       vec2<f32>,
    @location(3) normal:   vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos:  vec4<f32>,
    @location(0)       world_pos: vec3<f32>,
    @location(1)       world_nor: vec3<f32>,
    @location(2)       color:     vec3<f32>,
    @location(3)       uv:        vec2<f32>,
}

// ── Vertex Shader ────────────────────────────────────────────────────────
@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world4    = entity.model * vec4<f32>(in.position, 1.0);
    out.clip_pos  = entity.mvp * vec4<f32>(in.position, 1.0);
    out.world_pos = world4.xyz;
    // Matrice normale = mat3x3 du modèle (valide pour scale uniforme)
    let m         = entity.model;
    let norm_mat  = mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
    out.world_nor = normalize(norm_mat * in.normal);
    out.color     = in.color;
    out.uv        = in.uv;
    return out;
}

// ── Fragment Shader — Blinn-Phong ─────────────────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let albedo = textureSample(t_albedo, s_albedo, in.uv).rgb * in.color;
    let N      = normalize(in.world_nor);
    let V      = normalize(lights.camera_pos.xyz - in.world_pos);

    // Ambient constant
    var lighting = vec3<f32>(0.15) * albedo;

    // Lumière directionnelle
    let L_dir    = normalize(-lights.directional.direction);
    let H_dir    = normalize(L_dir + V);
    let diff_dir = max(dot(N, L_dir), 0.0);
    let spec_dir = pow(max(dot(N, H_dir), 0.0), 32.0);
    lighting    += lights.directional.color * lights.directional.intensity
                   * (albedo * diff_dir + vec3<f32>(0.3) * spec_dir);

    // Point lights
    for (var i = 0u; i < lights.n_points; i++) {
        let lp    = lights.points[i];
        let L_vec = lp.position - in.world_pos;
        let dist  = length(L_vec);
        // Atténuation quadratique (constante=1, linéaire=0.09, quadratique=0.032)
        let atten = 1.0 / (1.0 + 0.09 * dist + 0.032 * dist * dist);
        let L     = L_vec / dist;
        let H     = normalize(L + V);
        let diff  = max(dot(N, L), 0.0);
        let spec  = pow(max(dot(N, H), 0.0), 32.0);
        lighting += lp.color * lp.intensity * atten
                    * (albedo * diff + vec3<f32>(0.3) * spec);
    }

    return vec4<f32>(lighting, 1.0);
}
```

**Note WGSL :** Les structs `DirectionalLight` et `PointLight` en WGSL ont `vec3<f32>` qui a un AlignOf = 16, créant un padding implicite de 4 bytes entre les champs. Cela correspond exactement aux `_p0: f32` dans les structs Rust `GpuDirectionalLight` et `GpuPointLight`.

### Step 2 : Pas de cargo check pour les shaders

Les erreurs WGSL apparaissent uniquement à `wasm-pack build` ou au runtime. Le shader sera validé à la Task 8.

### Step 3 : Commit

```bash
git -C engine-core add src/shader.wgsl
git -C engine-core commit -m "feat(shader): Blinn-Phong — ambient + diffuse + specular, 3 bind groups"
```

---

## Task 8 : Build WASM complet

**Files:** aucun

### Step 1 : Build wasm-pack

```bash
cd engine-core && wasm-pack build --target web 2>&1 | tail -20
```

Attendu : ligne `[INFO]: :-) Your wasm pkg is ready to publish at ...` sans erreur.

**Si erreur WGSL** : le message d'erreur indique la ligne et la colonne. Corriger dans `shader.wgsl`. Les erreurs les plus probables :
- Mauvais nom de champ (ex: `lights.directional.direction` vs struct)
- Struct layout mismatch (vérifier les `pad` fields)
- `mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz)` → syntaxe correcte en WGSL

**Si erreur Rust** : lire le message complet sans le filtre grep.

### Step 2 : Commit

```bash
git -C engine-core add pkg/
git -C engine-core commit -m "build: wasm-pack Phase 4 lighting"
```

---

## Task 9 : TypeScript demo — scène FPS éclairée

**Files:**
- Modify: `game-app/src/main.ts`

### Step 1 : Ajouter les lumières après la création des entités

Dans `main.ts`, après la création du joueur (après `world.set_player(player);`), ajouter :

```typescript
// ── Éclairage ──────────────────────────────────────────────────────────────

// Lumière directionnelle (soleil oblique, légèrement chaud)
world.add_directional_light(-0.5, -1.0, -0.3,  1.0, 0.95, 0.8,  1.2);

// Point light cyan (coin positif)
const lamp1 = world.create_entity();
world.add_transform(lamp1, 4, 2.5, 4);
world.add_point_light(lamp1, 0.3, 0.8, 1.0, 10.0);

// Point light orange (coin négatif)
const lamp2 = world.create_entity();
world.add_transform(lamp2, -4, 2.5, -4);
world.add_point_light(lamp2, 1.0, 0.4, 0.2, 10.0);
```

### Step 2 : Lancer le dev server et tester visuellement

```bash
cd game-app && npm run dev
```

Ouvrir Chrome/Edge 113+ et charger `http://localhost:5173` (ou le port affiché).

**Faire Ctrl+Shift+R** (hard refresh) pour recharger le WASM depuis `pkg/`.

**Critères de validation visuels :**
- [ ] Sol damier éclairé : faces vers la lumière plus claires, zones éloignées plus sombres
- [ ] Cubes avec volume 3D visible (faces avant/arrière distinctes selon la lumière directionnelle)
- [ ] Halo de couleur cyan visible près de `lamp1` (coin +4, +4)
- [ ] Halo orange visible près de `lamp2` (coin -4, -4)
- [ ] Specular highlight visible sur les arêtes et faces orientées vers la caméra
- [ ] Pas de face entièrement noire (ambient = 0.15 garantit un minimum de luminosité)

### Step 3 : Commit TypeScript

```bash
# Depuis le root repo
git add game-app/src/main.ts
git commit -m "feat(demo): Phase 4 — scène FPS éclairée Blinn-Phong"
```

---

## Récapitulatif des commits attendus

| Commit | Contenu |
|---|---|
| `feat(ecs): add PointLight component` | components.rs + mod.rs |
| `feat(gpu): LightUniforms + light bind group (Group 2)` | lib.rs — structs GPU + World::new |
| `feat(api): add_point_light + add_directional_light wasm_bindgen API` | lib.rs — méthodes API |
| `feat(gpu): EntityUniforms buffer 128 bytes (MVP + Model)` | lib.rs — add_mesh_renderer |
| `feat(render): upload EntityUniforms + LightUniforms, bind Group 2` | lib.rs — render_frame |
| `feat(mesh): add normals to Vertex + CUBE_VERTICES per-face normals` | mesh.rs |
| `feat(shader): Blinn-Phong — ambient + diffuse + specular, 3 bind groups` | shader.wgsl |
| `build: wasm-pack Phase 4 lighting` | engine-core/pkg/ |
| `feat(demo): Phase 4 — scène FPS éclairée Blinn-Phong` | game-app/src/main.ts |

## Pièges à éviter

- **Double-borrow SparseSet** : dans render_frame, collecter les IDs dans un `Vec<usize>` avant de muter (pattern déjà utilisé en Phase 3).
- **bytemuck::bytes_of** : `LightUniforms::zeroed()` (pas `default()`) — bytemuck fournit `zeroed()` via `Zeroable`.
- **`glam::Vec3::to_array()`** : retourne `[f32; 3]` ✓ — disponible depuis glam 0.20.
- **WGSL vec3 padding** : `vec3<f32>` a AlignOf=16 en WGSL, ce qui crée un gap implicite de 4 bytes après chaque `vec3`. Le padding `_p0: f32` dans les Rust structs le compense exactement.
- **`wasm-pack build`** dans `engine-core/` : pas depuis le root repo.
- **Vite HMR** ne détecte pas les changements dans `engine-core/pkg/` — toujours faire Ctrl+Shift+R après un rebuild.
- **`cargo test`** sans `--target wasm32-unknown-unknown` échoue (crate wasm-only, `#![cfg(target_arch = "wasm32")]`).
