# Phase 6 — PBR + Shadow Maps : Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remplacer Blinn-Phong par GGX Cook-Torrance PBR + ajouter shadow maps pour la lumière directionnelle (PCF 3×3).

**Architecture:** 4 bind groups (EntityUniforms+metallic/roughness, albedo+normal tex, LightUniforms+light_space_mat, shadow depth tex). Shadow pass depth-only avant le main pass. Normal maps avec flat-normal default. Vertex struct étendu avec tangent vec4.

**Tech Stack:** Rust/WASM (wgpu 28, glam 0.29, bytemuck 1, serde 1), WGSL, wasm-pack --target web, TypeScript/Vite

**Design doc:** `docs/plans/2026-02-21-phase6-pbr-shadows-design.md`

---

## Task 1 : Vertex struct + tangent + CUBE_VERTICES

**Files:**
- Modify: `engine-core/src/mesh.rs`

### Step 1 : Ajouter le champ tangent dans Vertex

Remplacer la struct Vertex et impl Vertex::desc() en entier :

```rust
use bytemuck::{Pod, Zeroable};
use std::mem;

/// Vertex avec position xyz, couleur rgb, UV, normale xyz, tangente xyzw.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],  // 12
    pub color:    [f32; 3],  // 12
    pub uv:       [f32; 2],  //  8
    pub normal:   [f32; 3],  // 12
    pub tangent:  [f32; 4],  // 16 — xyz=tangent, w=bitangent sign (±1)
}
// Total : 60 bytes

impl Vertex {
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute { offset: 0,  shader_location: 0, format: wgpu::VertexFormat::Float32x3 },
                wgpu::VertexAttribute { offset: 12, shader_location: 1, format: wgpu::VertexFormat::Float32x3 },
                wgpu::VertexAttribute { offset: 24, shader_location: 2, format: wgpu::VertexFormat::Float32x2 },
                wgpu::VertexAttribute { offset: 32, shader_location: 3, format: wgpu::VertexFormat::Float32x3 },
                wgpu::VertexAttribute { offset: 44, shader_location: 4, format: wgpu::VertexFormat::Float32x4 },
            ],
        }
    }
}
```

### Step 2 : Remplacer CUBE_VERTICES avec tangentes

Tangentes par face : Front/Back/Left/Right/Bottom/Top — axe U de chaque face.

```rust
pub const CUBE_VERTICES: &[Vertex] = &[
    // Front (z = +0.5) — normale +Z — tangent +X
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 1.0], normal: [0.0, 0.0,  1.0], tangent: [ 1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 1.0], normal: [0.0, 0.0,  1.0], tangent: [ 1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [1.0, 0.0], normal: [0.0, 0.0,  1.0], tangent: [ 1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2], uv: [0.0, 0.0], normal: [0.0, 0.0,  1.0], tangent: [ 1.0, 0.0,  0.0, 1.0] },
    // Back (z = -0.5) — normale -Z — tangent -X
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 1.0], normal: [0.0, 0.0, -1.0], tangent: [-1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 1.0], normal: [0.0, 0.0, -1.0], tangent: [-1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [1.0, 0.0], normal: [0.0, 0.0, -1.0], tangent: [-1.0, 0.0,  0.0, 1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2], uv: [0.0, 0.0], normal: [0.0, 0.0, -1.0], tangent: [-1.0, 0.0,  0.0, 1.0] },
    // Left (x = -0.5) — normale -X — tangent +Z
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 1.0], normal: [-1.0, 0.0, 0.0], tangent: [0.0, 0.0,  1.0, 1.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 1.0], normal: [-1.0, 0.0, 0.0], tangent: [0.0, 0.0,  1.0, 1.0] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.2, 0.4, 0.9], uv: [1.0, 0.0], normal: [-1.0, 0.0, 0.0], tangent: [0.0, 0.0,  1.0, 1.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.4, 0.9], uv: [0.0, 0.0], normal: [-1.0, 0.0, 0.0], tangent: [0.0, 0.0,  1.0, 1.0] },
    // Right (x = +0.5) — normale +X — tangent -Z
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 1.0], normal: [ 1.0, 0.0, 0.0], tangent: [0.0, 0.0, -1.0, 1.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 1.0], normal: [ 1.0, 0.0, 0.0], tangent: [0.0, 0.0, -1.0, 1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.9, 0.9, 0.2], uv: [1.0, 0.0], normal: [ 1.0, 0.0, 0.0], tangent: [0.0, 0.0, -1.0, 1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.9, 0.2], uv: [0.0, 0.0], normal: [ 1.0, 0.0, 0.0], tangent: [0.0, 0.0, -1.0, 1.0] },
    // Bottom (y = -0.5) — normale -Y — tangent +X
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 1.0], normal: [0.0, -1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 1.0], normal: [0.0, -1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [1.0, 0.0], normal: [0.0, -1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1], uv: [0.0, 0.0], normal: [0.0, -1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    // Top (y = +0.5) — normale +Y — tangent +X
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 1.0], normal: [0.0,  1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 1.0], normal: [0.0,  1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [1.0, 0.0], normal: [0.0,  1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9], uv: [0.0, 0.0], normal: [0.0,  1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
];
```

### Step 3 : Vérifier la compilation

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/mesh.rs
git -C engine-core commit -m "feat(mesh): Vertex + tangent vec4, CUBE_VERTICES mis à jour (60 bytes)"
```

---

## Task 2 : EntityUniforms — metallic + roughness

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Remplacer EntityUniforms

Trouver le struct `EntityUniforms` dans lib.rs et le remplacer :

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct EntityUniforms {
    mvp:       [[f32; 4]; 4],  // 64 bytes
    model:     [[f32; 4]; 4],  // 64 bytes
    metallic:  f32,             //  4 bytes
    roughness: f32,             //  4 bytes
    _pad:      [f32; 2],        //  8 bytes — alignement 16
}
// Total : 144 bytes
```

### Step 2 : Mettre à jour la taille du buffer dans add_mesh_renderer

Dans `add_mesh_renderer`, le `create_buffer` utilise `mem::size_of::<EntityUniforms>()` — c'est déjà dynamique, aucune modification nécessaire.

### Step 3 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 4 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(gpu): EntityUniforms + metallic/roughness (144 bytes)"
```

---

## Task 3 : Material component — PBR fields

**Files:**
- Modify: `engine-core/src/ecs/components.rs`

### Step 1 : Étendre Material

Remplacer la struct `Material` :

```rust
pub struct Material {
    pub albedo_tex:  u32,   // TextureId GPU (index dans World::textures)
    pub normal_tex:  u32,   // TextureId GPU — u32::MAX = flat normal default
    pub metallic:    f32,   // 0.0 diélectrique, 1.0 métal
    pub roughness:   f32,   // 0.0 miroir, 1.0 mat
}
```

### Step 2 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Il y aura probablement des erreurs de compilation car les anciens sites qui créent `Material { texture_id }` doivent être mis à jour. Les corriger dans lib.rs : chercher toutes les occurrences de `Material {` et les remplacer par :

```rust
Material { albedo_tex: tex_id, normal_tex: u32::MAX, metallic: 0.0, roughness: 0.5 }
```

(dans `add_material` et `load_scene`)

Puis relancer `cargo check`. Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/ecs/components.rs src/lib.rs
git -C engine-core commit -m "feat(ecs): Material PBR — albedo_tex, normal_tex, metallic, roughness"
```

---

## Task 4 : LightUniforms — light_space_mat

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Étendre LightUniforms

Remplacer le struct `LightUniforms` :

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct LightUniforms {
    camera_pos:      [f32; 4],            //  16 bytes — offset   0
    directional:     GpuDirectionalLight, //  32 bytes — offset  16
    n_points:        u32,                 //   4 bytes — offset  48
    _pad:            [u32; 3],            //  12 bytes — offset  52
    points:          [GpuPointLight; 8],  // 256 bytes — offset  64
    light_space_mat: [[f32; 4]; 4],       //  64 bytes — offset 320
}
// Total : 384 bytes
```

### Step 2 : Ajouter la fonction compute_light_space_mat

Dans lib.rs, avant le bloc `#[wasm_bindgen] impl World`, ajouter la fonction libre :

```rust
/// Calcule la matrice light-space pour la shadow map (directional light).
/// Vue ortho depuis -direction×30, projection couvrant ±20 unités.
fn compute_light_space_mat(direction: glam::Vec3) -> glam::Mat4 {
    let dir      = direction.normalize();
    let light_pos = -dir * 30.0;
    let view     = glam::Mat4::look_at_rh(light_pos, glam::Vec3::ZERO, glam::Vec3::Y);
    let proj     = glam::Mat4::orthographic_rh(-20.0, 20.0, -20.0, 20.0, 0.1, 100.0);
    proj * view
}
```

### Step 3 : Mettre à jour la taille du light_buffer

Dans `World::new`, le `light_buffer` utilise déjà `mem::size_of::<LightUniforms>()` — taille automatique, OK.

### Step 4 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 5 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(gpu): LightUniforms + light_space_mat (384 bytes), compute_light_space_mat"
```

---

## Task 5 : Shadow infrastructure GPU

**Files:**
- Modify: `engine-core/src/lib.rs`
- Create: `engine-core/src/shadow.wgsl`

### Step 1 : Créer engine-core/src/shadow.wgsl

```wgsl
// shadow.wgsl — depth-only pass depuis la lumière directionnelle

struct ShadowUniforms {
    light_mvp: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> shadow_uniforms: ShadowUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color:    vec3<f32>,  // ignoré
    @location(2) uv:       vec2<f32>,  // ignoré
    @location(3) normal:   vec3<f32>,  // ignoré
    @location(4) tangent:  vec4<f32>,  // ignoré
}

@vertex
fn vs_shadow(in: VertexInput) -> @builtin(position) vec4<f32> {
    return shadow_uniforms.light_mvp * vec4<f32>(in.position, 1.0);
}
```

### Step 2 : Ajouter les champs shadow dans World struct

Dans le struct `World`, après `light_bind_group:`, ajouter :

```rust
    // Shadow map
    shadow_depth_texture:    wgpu::Texture,
    shadow_depth_view:       wgpu::TextureView,
    shadow_bind_group_layout: wgpu::BindGroupLayout,
    shadow_bind_group:       wgpu::BindGroup,
    shadow_pipeline:         wgpu::RenderPipeline,
    shadow_entity_layout:    wgpu::BindGroupLayout,
```

### Step 3 : Créer la shadow infrastructure dans World::new

Après la création de `light_bind_group`, ajouter dans `World::new` :

```rust
        // ── Shadow map infrastructure ─────────────────────────────────────────
        let shadow_size = wgpu::Extent3d { width: 2048, height: 2048, depth_or_array_layers: 1 };
        let shadow_depth_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow_depth"),
            size: shadow_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let shadow_depth_view = shadow_depth_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Bind group layout Group 3 : shadow_map (depth) + comparison sampler
        let shadow_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });

        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label:              Some("shadow_sampler"),
            address_mode_u:     wgpu::AddressMode::ClampToEdge,
            address_mode_v:     wgpu::AddressMode::ClampToEdge,
            compare:            Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });

        let shadow_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("shadow_bg"),
            layout:  &shadow_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding:  0,
                    resource: wgpu::BindingResource::TextureView(&shadow_depth_view),
                },
                wgpu::BindGroupEntry {
                    binding:  1,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
            ],
        });

        // Shadow pipeline — bind group 0 : light_mvp uniform per entity
        let shadow_entity_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow_entity_bgl"),
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

        let shadow_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("shadow_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shadow.wgsl").into()),
        });

        let shadow_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("shadow_pipeline_layout"),
            bind_group_layouts: &[&shadow_entity_layout],
            ..Default::default()
        });

        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("shadow_pipeline"),
            layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState {
                module:      &shadow_shader,
                entry_point: Some("vs_shadow"),
                buffers:     &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: None,
            primitive: wgpu::PrimitiveState {
                topology:  wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::LessEqual,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState {
                    constant: 2,
                    slope_scale: 2.0,
                    clamp: 0.0,
                },
            }),
            multisample:    wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache:          None,
        });
```

### Step 4 : Ajouter les champs dans Ok(World { ... })

Après `light_bind_group,`, ajouter :

```rust
            shadow_depth_texture,
            shadow_depth_view,
            shadow_bind_group_layout,
            shadow_bind_group,
            shadow_pipeline,
            shadow_entity_layout,
```

**Note :** `shadow_sampler` est créé localement dans cette étape — pas besoin de stocker dans World (le bind group le retient).

### Step 5 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 6 : Commit

```bash
git -C engine-core add src/lib.rs src/shadow.wgsl
git -C engine-core commit -m "feat(shadow): shadow map infrastructure — depth texture 2048², comparison sampler, pipeline depth-only"
```

---

## Task 6 : Group 1 étendu — normal texture + default flat normal

**Files:**
- Modify: `engine-core/src/lib.rs`

L'objectif est que Group 1 passe de 2 bindings (albedo + sampler) à 4 (albedo, albedo_sampler, normal, normal_sampler). Cela nécessite de :
1. Mettre à jour `texture_bind_group_layout`
2. Créer `default_normal_tex` (1×1 flat normal)
3. Ajouter `default_normal_tex` et `normal_textures` dans World
4. Mettre à jour `create_texture_from_data` pour recréer les bind groups entity

### Step 1 : Étendre texture_bind_group_layout

Remplacer la création de `texture_bind_group_layout` dans `World::new` :

```rust
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
                // Normal map texture
                wgpu::BindGroupLayoutEntry {
                    binding:    2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
```

### Step 2 : Modifier TextureGpu pour inclure les 4 bindings

`create_texture_from_data` crée actuellement un bind group avec 2 entries. Remplacer la fonction pour accepter une normal view optionnelle. Il est plus simple de changer l'approche : créer des bind groups séparément au niveau du render frame.

**Approche retenue** : stocker seulement `view` dans `TextureGpu` (pas de bind_group), et créer le bind group à la volée dans `render_frame` via un helper. Trop de refactoring → **approche simplifiée** :

Stocker albedo et normal séparément, créer le bind group Group 1 per-entity dans `render_frame` en combinant albedo + normal views.

Modifier `TextureGpu` — supprimer le `bind_group` interne, le World gérera les bind groups Group 1 par entité :

```rust
struct TextureGpu {
    #[allow(dead_code)]
    texture: wgpu::Texture,
    view:    wgpu::TextureView,
}
```

### Step 3 : Ajouter default_normal_tex dans World struct + new

Ajouter dans World struct :

```rust
    default_normal_tex: TextureGpu,
```

Dans `World::new`, après `default_tex`, créer la flat normal texture :

```rust
        // Flat normal : (128, 128, 255, 255) = vecteur (0,0,1) en tangent space
        let default_normal_tex = create_texture_from_data(
            &device, &queue, 1, 1,
            &[128u8, 128, 255, 255],
        );
```

Et dans `Ok(World { ... })` ajouter `default_normal_tex,`.

### Step 4 : Simplifier create_texture_from_data

`create_texture_from_data` ne crée plus de bind_group — seulement texture + view :

```rust
fn create_texture_from_data(
    device: &wgpu::Device,
    queue:  &wgpu::Queue,
    width:  u32,
    height: u32,
    data:   &[u8],
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
            texture: &texture, mip_level: 0,
            origin:  wgpu::Origin3d::ZERO,
            aspect:  wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset: 0, bytes_per_row: Some(4 * width), rows_per_image: None,
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    TextureGpu { texture, view }
}
```

### Step 5 : Supprimer le sampler de World + le passer inline

Le `sampler` peut rester dans World mais n'est plus passé à `create_texture_from_data`. Les bind groups Group 1 seront créés dans `render_frame` via un helper.

Ajouter un helper dans `impl World` (bloc non-wasm_bindgen) :

```rust
impl World {
    fn make_tex_bind_group(
        &self,
        albedo_view: &wgpu::TextureView,
        normal_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("tex_bg"),
            layout:  &self.texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(albedo_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(normal_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        })
    }
}
```

### Step 6 : Mettre à jour upload_texture

`upload_texture` appelle `create_texture_from_data` — retirer les params `layout` et `sampler` :

```rust
pub fn upload_texture(&mut self, width: u32, height: u32, data: &[u8]) -> u32 {
    assert_eq!(data.len() as u64, 4 * width as u64 * height as u64, ...);
    let tex = create_texture_from_data(&self.device, &self.queue, width, height, data);
    let id = self.textures.len() as u32;
    self.textures.push(tex);
    id
}
```

### Step 7 : Mettre à jour World::new — appels create_texture_from_data

Tous les appels passaient `&texture_bind_group_layout, &sampler` — les retirer. Ex :

```rust
let default_tex = create_texture_from_data(&device, &queue, 1, 1, &[255u8, 255, 255, 255]);
```

### Step 8 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`. Si erreurs liées à `bind_group` de `TextureGpu`, les corriger (supprimer les accès à `.bind_group`).

### Step 9 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(gpu): Group 1 étendu albedo+normal, default_normal_tex flat, make_tex_bind_group helper"
```

---

## Task 7 : shader.wgsl — PBR GGX + TBN + shadow sampling

**Files:**
- Modify: `engine-core/src/shader.wgsl`

Remplacer intégralement `shader.wgsl` :

### Step 1 : Écrire le nouveau shader.wgsl

```wgsl
const PI: f32 = 3.14159265358979;

// ── Group 0 — uniforms par entité ────────────────────────────────────────
struct EntityUniforms {
    mvp:       mat4x4<f32>,
    model:     mat4x4<f32>,
    metallic:  f32,
    roughness: f32,
    _pad:      vec2<f32>,
}
@group(0) @binding(0) var<uniform> entity: EntityUniforms;

// ── Group 1 — textures albedo + normal ───────────────────────────────────
@group(1) @binding(0) var t_albedo: texture_2d<f32>;
@group(1) @binding(1) var s_albedo: sampler;
@group(1) @binding(2) var t_normal: texture_2d<f32>;
@group(1) @binding(3) var s_normal: sampler;

// ── Group 2 — lumières + light_space_mat ─────────────────────────────────
struct GpuDirectionalLight {
    direction: vec3<f32>, _p0: f32,
    color:     vec3<f32>, intensity: f32,
}
struct GpuPointLight {
    position:  vec3<f32>, _p0: f32,
    color:     vec3<f32>, intensity: f32,
}
struct LightUniforms {
    camera_pos:      vec4<f32>,
    directional:     GpuDirectionalLight,
    n_points:        u32,
    pad0: u32, pad1: u32, pad2: u32,
    points:          array<GpuPointLight, 8>,
    light_space_mat: mat4x4<f32>,
}
@group(2) @binding(0) var<uniform> lights: LightUniforms;

// ── Group 3 — shadow map ──────────────────────────────────────────────────
@group(3) @binding(0) var shadow_map:     texture_depth_2d;
@group(3) @binding(1) var shadow_sampler: sampler_comparison;

// ── Vertex I/O ───────────────────────────────────────────────────────────
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color:    vec3<f32>,
    @location(2) uv:       vec2<f32>,
    @location(3) normal:   vec3<f32>,
    @location(4) tangent:  vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos:  vec4<f32>,
    @location(0)       world_pos: vec3<f32>,
    @location(1)       world_nor: vec3<f32>,
    @location(2)       color:     vec3<f32>,
    @location(3)       uv:        vec2<f32>,
    @location(4)       world_tan: vec4<f32>,
}

// ── Vertex Shader ────────────────────────────────────────────────────────
@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world4    = entity.model * vec4<f32>(in.position, 1.0);
    out.clip_pos  = entity.mvp * vec4<f32>(in.position, 1.0);
    out.world_pos = world4.xyz;
    let m         = entity.model;
    let norm_mat  = mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
    out.world_nor = normalize(norm_mat * in.normal);
    out.world_tan = vec4<f32>(normalize(norm_mat * in.tangent.xyz), in.tangent.w);
    out.color     = in.color;
    out.uv        = in.uv;
    return out;
}

// ── PBR helpers ──────────────────────────────────────────────────────────
fn distribution_ggx(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a     = roughness * roughness;
    let a2    = a * a;
    let NdH   = max(dot(N, H), 0.0);
    let denom = NdH * NdH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
}

fn geometry_schlick_ggx(NdV: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    return NdV / (NdV * (1.0 - k) + k);
}

fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdV = max(dot(N, V), 0.0);
    let NdL = max(dot(N, L), 0.0);
    return geometry_schlick_ggx(NdV, roughness) * geometry_schlick_ggx(NdL, roughness);
}

fn fresnel_schlick(cos_theta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

// ── Shadow sampling (PCF 3×3) ────────────────────────────────────────────
fn shadow_factor(world_pos: vec3<f32>) -> f32 {
    let lsp   = lights.light_space_mat * vec4<f32>(world_pos, 1.0);
    let proj  = lsp.xyz / lsp.w;
    // WebGPU NDC Y est inversé par rapport à la convention OpenGL
    let uv    = vec2<f32>(proj.x * 0.5 + 0.5, -proj.y * 0.5 + 0.5);
    let depth = proj.z - 0.005; // biais pour éviter shadow acne
    // Hors de la frustum lumière → pas d'ombre
    if uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z > 1.0 {
        return 1.0;
    }
    let tx = 1.0 / 2048.0;
    var s  = 0.0;
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            let offset = vec2<f32>(f32(x), f32(y)) * tx;
            s += textureSampleCompare(shadow_map, shadow_sampler, uv + offset, depth);
        }
    }
    return s / 9.0;
}

// ── Fragment Shader — GGX Cook-Torrance PBR ──────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let albedo_srgb = textureSample(t_albedo, s_albedo, in.uv).rgb * in.color;

    // Décodage normal map en world space via TBN
    let T   = normalize(in.world_tan.xyz);
    let N_geo = normalize(in.world_nor);
    let B   = normalize(cross(N_geo, T) * in.world_tan.w);
    let TBN = mat3x3<f32>(T, B, N_geo);
    let n_ts = textureSample(t_normal, s_normal, in.uv).xyz * 2.0 - 1.0;
    let N   = normalize(TBN * n_ts);

    let V       = normalize(lights.camera_pos.xyz - in.world_pos);
    let metallic  = entity.metallic;
    let roughness = max(entity.roughness, 0.04); // éviter roughness=0 (singularité)
    let F0      = mix(vec3<f32>(0.04), albedo_srgb, metallic);

    var Lo = vec3<f32>(0.0);

    // Lumière directionnelle + shadow
    {
        let L       = normalize(-lights.directional.direction);
        let H       = normalize(V + L);
        let NdL     = max(dot(N, L), 0.0);
        let radiance = lights.directional.color * lights.directional.intensity;

        let NDF = distribution_ggx(N, H, roughness);
        let G   = geometry_smith(N, V, L, roughness);
        let F   = fresnel_schlick(max(dot(H, V), 0.0), F0);

        let kS   = F;
        let kD   = (1.0 - kS) * (1.0 - metallic);
        let spec = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * NdL + 0.0001);

        let shadow = shadow_factor(in.world_pos);
        Lo += shadow * (kD * albedo_srgb / PI + spec) * radiance * NdL;
    }

    // Point lights (pas de shadow)
    for (var i = 0u; i < lights.n_points; i++) {
        let lp      = lights.points[i];
        let L_vec   = lp.position - in.world_pos;
        let dist    = length(L_vec);
        let L       = L_vec / dist;
        let H       = normalize(V + L);
        let NdL     = max(dot(N, L), 0.0);
        let atten   = 1.0 / (dist * dist + 0.0001);
        let radiance = lp.color * lp.intensity * atten;

        let NDF = distribution_ggx(N, H, roughness);
        let G   = geometry_smith(N, V, L, roughness);
        let F   = fresnel_schlick(max(dot(H, V), 0.0), F0);

        let kS   = F;
        let kD   = (1.0 - kS) * (1.0 - metallic);
        let spec = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * NdL + 0.0001);

        Lo += (kD * albedo_srgb / PI + spec) * radiance * NdL;
    }

    // Ambient IBL simplifié
    let ambient = vec3<f32>(0.03) * albedo_srgb;
    let color   = ambient + Lo;

    // Tone mapping Reinhard simple + gamma
    let mapped  = color / (color + vec3<f32>(1.0));
    let gamma   = pow(mapped, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(gamma, 1.0);
}
```

### Step 2 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/shader.wgsl
git -C engine-core commit -m "feat(shader): PBR GGX Cook-Torrance + TBN normal maps + shadow PCF 3x3"
```

---

## Task 8 : render_frame — shadow pass + main pass mis à jour

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Ajouter shadow entity buffers dans World struct

Pour le shadow pass, chaque entité a besoin d'un uniform `light_mvp`. On réutilise les `entity_gpus` buffers existants avec un nouveau bind group layout. Ajouter dans World struct :

```rust
    shadow_entity_bgs: SparseSet<wgpu::BindGroup>,
```

Et dans `Ok(World { ... })` : `shadow_entity_bgs: SparseSet::new(),`

### Step 2 : Mettre à jour add_mesh_renderer — créer shadow bind group

Dans `add_mesh_renderer`, après `self.entity_gpus.insert(...)`, ajouter :

```rust
        // Shadow bind group pour ce mesh (partage le même uniform_buffer)
        let shadow_bg = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("shadow_entity_bg"),
            layout:  &self.shadow_entity_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: self.entity_gpus.get(id).unwrap().uniform_buffer.as_entire_binding(),
            }],
        });
        self.shadow_entity_bgs.insert(id, shadow_bg);
```

**Note :** le `uniform_buffer` de `EntityGpu` contient `EntityUniforms { mvp, model, metallic, roughness }` — 144 bytes. Le shadow shader lit seulement les 64 premiers bytes (`light_mvp` dans `ShadowUniforms`). Pour éviter ce mismatch, ajouter un buffer dédié shadow dans `EntityGpu` :

Modifier `EntityGpu` :

```rust
struct EntityGpu {
    uniform_buffer:       wgpu::Buffer,  // EntityUniforms (144 bytes) — Group 0
    bind_group:           wgpu::BindGroup,
    shadow_uniform_buffer: wgpu::Buffer,  // ShadowUniforms (64 bytes) — shadow pass
    shadow_bind_group:    wgpu::BindGroup,
}
```

Dans `add_mesh_renderer`, créer le shadow_uniform_buffer (64 bytes = mat4x4) et shadow_bind_group :

```rust
        let shadow_uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("shadow_entity_uniform"),
            size:               64, // mat4x4<f32>
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let shadow_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("shadow_entity_bg"),
            layout:  &self.shadow_entity_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: shadow_uniform_buffer.as_entire_binding(),
            }],
        });
        self.entity_gpus.insert(id, EntityGpu {
            uniform_buffer, bind_group,
            shadow_uniform_buffer, shadow_bind_group,
        });
```

**Retirer** `shadow_entity_bgs: SparseSet<wgpu::BindGroup>` du struct World (plus nécessaire — c'est dans EntityGpu).

### Step 3 : Mettre à jour render_frame

Remplacer la méthode `render_frame` entière :

```rust
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

        // ── Light space matrix ─────────────────────────────────────────────
        let light_dir = self.directional_light.as_ref()
            .map(|dl| dl.direction)
            .unwrap_or(glam::Vec3::new(0.0, -1.0, 0.0));
        let lsm = compute_light_space_mat(light_dir);

        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // ── Upload EntityUniforms (MVP + model + metallic + roughness) ─────
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

            let (metallic, roughness) = self.materials.get(id)
                .map(|m| (m.metallic, m.roughness))
                .unwrap_or((0.0, 0.5));

            let uniforms = EntityUniforms {
                mvp:       mvp.to_cols_array_2d(),
                model:     model.to_cols_array_2d(),
                metallic,
                roughness,
                _pad:      [0.0; 2],
            };
            self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

            // Upload shadow uniform : light_mvp = lsm * model
            let light_mvp = lsm * model;
            self.queue.write_buffer(&gpu.shadow_uniform_buffer, 0,
                bytemuck::cast_slice(light_mvp.as_ref()));
        }

        // ── Upload LightUniforms ──────────────────────────────────────────
        {
            let mut lu = <LightUniforms as bytemuck::Zeroable>::zeroed();
            lu.camera_pos = [self.camera.eye.x, self.camera.eye.y, self.camera.eye.z, 0.0];
            lu.light_space_mat = lsm.to_cols_array_2d();

            if let Some(dl) = &self.directional_light {
                let dir = dl.direction.normalize();
                lu.directional = GpuDirectionalLight {
                    direction: dir.to_array(), _p0: 0.0,
                    color: dl.color.to_array(), intensity: dl.intensity,
                };
            }

            let light_ids: Vec<usize> = self.point_lights.iter().map(|(id, _)| id).collect();
            let mut n = 0usize;
            for id in light_ids {
                if n >= 8 { break; }
                let (Some(pl), Some(tr)) = (self.point_lights.get(id), self.transforms.get(id)) else { continue };
                lu.points[n] = GpuPointLight {
                    position: tr.position.to_array(), _p0: 0.0,
                    color: pl.color.to_array(), intensity: pl.intensity,
                };
                n += 1;
            }
            lu.n_points = n as u32;
            self.queue.write_buffer(&self.light_buffer, 0, bytemuck::bytes_of(&lu));
        }

        // ── 1. Shadow pass ────────────────────────────────────────────────
        {
            let mut shadow_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shadow_pass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow_depth_view,
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

            shadow_pass.set_pipeline(&self.shadow_pipeline);
            shadow_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            shadow_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);

            for (id, _) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };
                shadow_pass.set_bind_group(0, &gpu.shadow_bind_group, &[]);
                shadow_pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        // ── 2. Main pass (PBR) ────────────────────────────────────────────
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &view,
                    resolve_target: None,
                    depth_slice:    None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(wgpu::Color { r: 0.05, g: 0.05, b: 0.08, a: 1.0 }),
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

            for (id, _) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };

                // Group 1 : albedo + normal bind group (créé à la volée)
                let (albedo_view, normal_view) = if let Some(mat) = self.materials.get(id) {
                    let av = if (mat.albedo_tex as usize) < self.textures.len() {
                        &self.textures[mat.albedo_tex as usize].view
                    } else {
                        &self.default_tex.view
                    };
                    let nv = if (mat.normal_tex as usize) < self.textures.len() {
                        &self.textures[mat.normal_tex as usize].view
                    } else {
                        &self.default_normal_tex.view
                    };
                    (av, nv)
                } else {
                    (&self.default_tex.view, &self.default_normal_tex.view)
                };

                let tex_bg = self.make_tex_bind_group(albedo_view, normal_view);

                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.set_bind_group(1, &tex_bg, &[]);
                pass.set_bind_group(2, &self.light_bind_group, &[]);
                pass.set_bind_group(3, &self.shadow_bind_group, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
    }
```

**Note :** créer `tex_bg` à la volée dans render_frame est valide en wgpu (les bind groups sont légers à créer). Pour optimisation future, les cacher dans les entités.

### Step 4 : Mettre à jour le render_pipeline layout — 4 bind groups

Dans `World::new`, la création de `pipeline_layout` doit référencer 4 bind group layouts :

```rust
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[
                &bind_group_layout,
                &texture_bind_group_layout,
                &light_bind_group_layout,
                &shadow_bind_group_layout,
            ],
            ..Default::default()
        });
```

**Note :** `shadow_bind_group_layout` est créé dans Task 5 — s'assurer qu'il est déclaré avant `pipeline_layout` dans `World::new`.

### Step 5 : Mettre à jour clear_scene — supprimer shadow_entity_bgs si présent

Si `shadow_entity_bgs` avait été ajouté dans World struct au Step 1, retirer. Les shadow bind groups sont dans `EntityGpu` qui est dans `entity_gpus` — déjà supprimé par `clear_scene`.

### Step 6 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

S'il y a des erreurs, les corriger une par une. Erreurs probables :
- `entity_gpus.get(id).unwrap().uniform_buffer` : utiliser la version corrigée de `EntityGpu`
- `shadow_depth_view` still borrowed : passer à encoder après shadow pass → OK car Rust release le borrow à la fin du bloc `{ }`

### Step 7 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(render): shadow pass + main pass PBR, 4 bind groups, EntityGpu + shadow buffer"
```

---

## Task 9 : API wasm_bindgen — add_pbr_material + set_normal_map

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Mettre à jour add_material (rétrocompatibilité)

Remplacer `add_material` dans le bloc wasm_bindgen Textures :

```rust
    /// Rétrocompatibilité Phase 1-5. Utilise add_pbr_material pour le PBR.
    pub fn add_material(&mut self, entity_id: usize, texture_id: u32) {
        self.materials.insert(entity_id, Material {
            albedo_tex:  texture_id,
            normal_tex:  u32::MAX,
            metallic:    0.0,
            roughness:   0.5,
        });
    }

    /// Associe un matériau PBR complet à l'entité.
    pub fn add_pbr_material(
        &mut self,
        entity_id: usize,
        albedo_tex: u32,
        metallic:   f32,
        roughness:  f32,
    ) {
        self.materials.insert(entity_id, Material {
            albedo_tex,
            normal_tex: u32::MAX,
            metallic,
            roughness,
        });
    }

    /// Applique une normal map à l'entité (doit avoir un Material).
    pub fn set_normal_map(&mut self, entity_id: usize, normal_tex_id: u32) {
        if let Some(mat) = self.materials.get_mut(entity_id) {
            mat.normal_tex = normal_tex_id;
        }
    }
```

### Step 2 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 3 : Commit

```bash
git -C engine-core add src/lib.rs
git -C engine-core commit -m "feat(api): add_pbr_material + set_normal_map wasm_bindgen API"
```

---

## Task 10 : scene.rs — SceneMaterial PBR étendu

**Files:**
- Modify: `engine-core/src/scene.rs`
- Modify: `engine-core/src/lib.rs` (load_scene + save_scene)

### Step 1 : Étendre SceneMaterial dans scene.rs

```rust
fn default_metallic()  -> f32 { 0.0 }
fn default_roughness() -> f32 { 0.5 }

#[derive(Serialize, Deserialize)]
pub struct SceneMaterial {
    pub texture: String,
    #[serde(default)]
    pub normal_texture: String,          // "" = pas de normal map
    #[serde(default = "default_metallic")]
    pub metallic: f32,
    #[serde(default = "default_roughness")]
    pub roughness: f32,
}
```

### Step 2 : Mettre à jour load_scene dans lib.rs

Dans le bloc `if let Some(mat) = entity_data.material` de `load_scene`, remplacer :

```rust
            if let Some(mat) = entity_data.material {
                let tex_id = self.texture_registry
                    .get(&mat.texture)
                    .copied()
                    .unwrap_or_else(|| {
                        web_sys::console::warn_1(
                            &format!("[load_scene] texture '{}' non enregistrée", mat.texture).into()
                        );
                        u32::MAX
                    });
                let normal_id = if mat.normal_texture.is_empty() {
                    u32::MAX
                } else {
                    self.texture_registry.get(&mat.normal_texture).copied().unwrap_or(u32::MAX)
                };
                self.materials.insert(id, Material {
                    albedo_tex:  tex_id,
                    normal_tex:  normal_id,
                    metallic:    mat.metallic,
                    roughness:   mat.roughness,
                });
            }
```

### Step 3 : Mettre à jour save_scene

Dans `save_scene`, remplacer la création de `SceneMaterial` :

```rust
            let material = self.materials.get(id).map(|m| SceneMaterial {
                texture:        id_to_name.get(&m.albedo_tex).cloned().unwrap_or_default(),
                normal_texture: id_to_name.get(&m.normal_tex).cloned().unwrap_or_default(),
                metallic:       m.metallic,
                roughness:      m.roughness,
            });
```

### Step 4 : Vérifier

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Attendu : `Finished`

### Step 5 : Commit

```bash
git -C engine-core add src/scene.rs src/lib.rs
git -C engine-core commit -m "feat(scene): SceneMaterial PBR — metallic, roughness, normal_texture"
```

---

## Task 11 : Build WASM + demo main.ts PBR

**Files:**
- Modify: `game-app/src/main.ts`
- Modify: `game-app/public/scenes/level1.json`
- Modify: `game-app/public/scenes/level2.json`

### Step 1 : Build WASM

```bash
cd engine-core && wasm-pack build --target web 2>&1 | tail -5
```

Attendu : `Done in Xs` sans erreur.

**Si erreur :** lire le message complet sans filtre grep.

### Step 2 : Mettre à jour game-app/public/scenes/level1.json

Ajouter metallic/roughness dans les entités :

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
      "material": { "texture": "floor_checker", "metallic": 0.0, "roughness": 0.8 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [10, 0.5, 10]
    },
    {
      "transform": { "position": [3, 0.5, 3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.9, "roughness": 0.2 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-3, 0.5, 3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.0, "roughness": 0.3 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [3, 0.5, -3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.9, "roughness": 0.6 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-3, 0.5, -3], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.0, "roughness": 0.9 },
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

### Step 3 : Mettre à jour game-app/public/scenes/level2.json

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
      "material": { "texture": "floor_checker", "metallic": 0.0, "roughness": 0.7 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [10, 0.5, 10]
    },
    {
      "transform": { "position": [0, 0.5, 5], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 1.0, "roughness": 0.1 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [0, 0.5, -5], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.0, "roughness": 0.5 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [5, 0.5, 0], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 1.0, "roughness": 0.4 },
      "rigid_body": { "is_static": true },
      "collider_aabb": [0.5, 0.5, 0.5]
    },
    {
      "transform": { "position": [-5, 0.5, 0], "rotation": [0, 45, 0], "scale": [1, 1, 1] },
      "mesh_renderer": true,
      "material": { "texture": "box_checker", "metallic": 0.0, "roughness": 0.2 },
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

### Step 4 : main.ts — supprimer add_material, utiliser load_scene (déjà le cas)

`main.ts` utilise déjà `load_scene` — aucune modification nécessaire. Les matériaux PBR viennent des JSON. Vérifier que l'import du module WASM est correct (Ctrl+Shift+R dans le browser).

### Step 5 : Commit root repo

```bash
git add game-app/public/scenes/level1.json game-app/public/scenes/level2.json
git commit -m "feat(demo): Phase 6 — scènes JSON PBR (metallic/roughness variés, ombres directionnelles)"
```

---

## Récapitulatif des commits attendus

| Commit | Fichier(s) |
|--------|-----------|
| `feat(mesh): Vertex + tangent vec4, CUBE_VERTICES 60 bytes` | mesh.rs |
| `feat(gpu): EntityUniforms + metallic/roughness 144 bytes` | lib.rs |
| `feat(ecs): Material PBR — albedo_tex, normal_tex, metallic, roughness` | components.rs, lib.rs |
| `feat(gpu): LightUniforms + light_space_mat 384 bytes` | lib.rs |
| `feat(shadow): shadow map infrastructure 2048², comparison sampler, pipeline` | lib.rs, shadow.wgsl |
| `feat(gpu): Group 1 étendu albedo+normal, default_normal_tex flat` | lib.rs |
| `feat(shader): PBR GGX Cook-Torrance + TBN + shadow PCF 3x3` | shader.wgsl |
| `feat(render): shadow pass + main pass PBR, 4 bind groups` | lib.rs |
| `feat(api): add_pbr_material + set_normal_map` | lib.rs |
| `feat(scene): SceneMaterial PBR metallic/roughness/normal_texture` | scene.rs, lib.rs |
| `build: wasm-pack Phase 6 PBR + shadows` | (pkg gitignored) |
| `feat(demo): Phase 6 — scènes JSON PBR` | level1.json, level2.json |

## Pièges critiques

- **`texture_depth_2d`** dans WGSL : binding type `TextureSampleType::Depth` + `sampler_comparison` — pas `Float { filterable }`
- **Shadow Y inversé** : `uv.y = -proj.y * 0.5 + 0.5` (convention WebGPU NDC)
- **`orthographic_rh`** : glam utilise la convention right-handed, Z 0..1 pour WebGPU — OK
- **`depth_or_array_layers: 1`** pour shadow texture — même que les autres textures 2D
- **bind group créé à la volée** dans render_frame : valide en wgpu (pas de pooling nécessaire pour cette phase)
- **`shadow_depth_view` utilisé dans shadow pass ET dans shadow_bind_group** : le bind group est créé après la vue, mais la vue est utilisée dans le bind group ET dans le render pass — OK car wgpu prend des références
- **Task 6 est la plus délicate** : retirer `bind_group` de `TextureGpu` casse tous les anciens accès à `.bind_group` dans render_frame — les corriger tous avant de tester
- **`entity.roughness` dans WGSL** : si `_pad` dans EntityUniforms est `[f32;2]`, l'offset de `metallic` est 128 bytes et `roughness` est 132 bytes — vérifier que le layout WGSL correspond (`metallic: f32, roughness: f32, _pad: vec2<f32>`)
