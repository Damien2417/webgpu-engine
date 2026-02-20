# Design : Pipeline 3D de base — Cube tournant avec Handle Pattern

**Date** : 2026-02-20
**Statut** : Approuvé
**Objectif** : Moteur généraliste réutilisable — première étape 3D

---

## Résultat visible

Un cube 3D aux faces colorées qui tourne en temps réel, caméra perspective, piloté par TypeScript via le Handle Pattern. Fondation pour ajouter meshes, lighting, ECS plus tard.

---

## Architecture des fichiers

```
engine-core/src/
├── lib.rs          — Engine struct (wasm_bindgen) + API publique
├── renderer.rs     — Pipeline wgpu, buffers, draw logic
├── scene.rs        — Vec<Entity>, create/update
├── camera.rs       — Camera struct, matrices view/projection
├── mesh.rs         — Géométrie (cube vertices/indices hardcodés)
└── shader.wgsl     — Vertex + fragment shader WGSL
```

---

## Engine struct

```rust
pub struct Engine {
    // GPU core
    device:           wgpu::Device,
    queue:            wgpu::Queue,
    surface:          wgpu::Surface<'static>,
    config:           wgpu::SurfaceConfiguration,

    // Render resources
    depth_texture:    wgpu::Texture,
    depth_view:       wgpu::TextureView,
    render_pipeline:  wgpu::RenderPipeline,
    vertex_buffer:    wgpu::Buffer,
    index_buffer:     wgpu::Buffer,
    uniform_buffer:   wgpu::Buffer,    // MVP mat4x4 par draw call
    bind_group:       wgpu::BindGroup,

    // Scène
    entities:         Vec<Entity>,     // Rust possède les données

    // Caméra
    camera:           Camera,
}
```

## Entity

```rust
struct Entity {
    position: glam::Vec3,
    rotation: glam::Vec3,   // angles Euler en degrés
    scale:    glam::Vec3,
    mesh:     MeshType,
}

enum MeshType { Cube }
```

---

## API TypeScript (wasm_bindgen)

| Méthode | Signature | Description |
|---|---|---|
| `init` | `async (canvas) → Engine` | Init GPU, crée pipeline |
| `create_cube` | `() → usize` | Ajoute une entité cube, retourne son handle |
| `set_position` | `(id, x, y, z)` | Modifie la position |
| `set_rotation` | `(id, x, y, z)` | Rotation en degrés Euler |
| `set_scale` | `(id, x, y, z)` | Échelle |
| `set_camera` | `(ex, ey, ez, tx, ty, tz)` | Positionne la caméra |
| `render_frame` | `(delta_ms: f32)` | Rendu d'un frame |

---

## Shader WGSL (`shader.wgsl`)

```wgsl
@group(0) @binding(0)
var<uniform> mvp: mat4x4<f32>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color:    vec3<f32>,
}
struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0)       color:    vec3<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    return VertexOutput(mvp * vec4(in.position, 1.0), in.color);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4(in.color, 1.0);
}
```

---

## Calcul MVP (glam)

```rust
let model = Mat4::from_translation(pos)
    * Mat4::from_euler(EulerRot::XYZ, rx.to_radians(), ry.to_radians(), rz.to_radians())
    * Mat4::from_scale(scale);
let view = Mat4::look_at_rh(camera.eye, camera.target, Vec3::Y);
let proj = Mat4::perspective_rh(camera.fov.to_radians(), aspect, 0.1, 1000.0);
let mvp  = proj * view * model;
```

---

## Dépendances Rust ajoutées

```toml
glam    = { version = "0.29", features = ["bytemuck"] }
bytemuck = { version = "1", features = ["derive"] }
```

- `glam` : Vec3/Mat4/quaternions SIMD (même crate que Bevy)
- `bytemuck` : cast Mat4 → `&[u8]` pour upload GPU (zero-copy)

---

## Depth buffer

Texture `Depth32Float` créée à l'init. Indispensable pour l'occlusion correcte des faces. Recréer si redimensionnement du canvas.

---

## Render loop par frame

1. `surface.get_current_texture()`
2. `begin_render_pass` (clear color + clear depth à 1.0)
3. `set_pipeline` + `set_vertex_buffer` + `set_index_buffer`
4. Pour chaque entité : calculer MVP → `queue.write_buffer` → `draw_indexed(36, 1, 0, 0, 0)`
5. `queue.submit` → `output.present()`

---

## TypeScript démo (main.ts)

```typescript
const engine = await Engine.init(canvas);
const cubeId = engine.create_cube();
engine.set_camera(3, 2, 5,   0, 0, 0);

let angle = 0;
let lastTime = performance.now();

function loop(): void {
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;
  angle += delta * 0.05;
  engine.set_rotation(cubeId, 15, angle, 0);
  engine.render_frame(delta);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```
