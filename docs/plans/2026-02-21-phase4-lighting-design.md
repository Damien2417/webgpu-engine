# Phase 4 — Éclairage Phong : Design Document

**Date :** 2026-02-21
**Objectif :** Ajouter un éclairage Blinn-Phong complet (ambient + diffuse + specular) avec point lights et lumière directionnelle.
**Prérequis :** Phases 1-3 complètes (ECS, Textures, Physique AABB).

---

## Résumé des décisions

| Décision | Choix |
|---|---|
| Vertex colors existants | Conservés comme albedo tint (modulés par lighting) |
| Point lights | Attachées à des entités ECS avec Transform |
| Specular | Blinn-Phong, shininess = 32 fixe |
| Layout GPU | 3 bind groups : MVP+Model (g0), Texture (g1), LightUniforms (g2) |

---

## 1. Changements Vertex (`mesh.rs`)

Ajout du champ `normal: [f32; 3]` au struct `Vertex` :

```rust
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],   // @location(0)
    pub color:    [f32; 3],   // @location(1)  — albedo tint
    pub uv:       [f32; 2],   // @location(2)
    pub normal:   [f32; 3],   // @location(3)  ← nouveau
}
// stride : 44 bytes (anciennement 32)
```

Normales du cube : per-face (outward), coordonnées object-space :
- Front  (+Z) : [0, 0, 1]
- Back   (-Z) : [0, 0, -1]
- Left   (-X) : [-1, 0, 0]
- Right  (+X) : [1, 0, 0]
- Bottom (-Y) : [0, -1, 0]
- Top    (+Y) : [0, 1, 0]

---

## 2. Composants ECS (`components.rs`)

Nouveau composant `PointLight` :

```rust
pub struct PointLight {
    pub color:     Vec3,
    pub intensity: f32,
}
```

`World` ajoute :
- `point_lights: SparseSet<PointLight>`
- `directional_light: Option<DirectionalLightData>` (struct interne, pas ECS)

```rust
struct DirectionalLightData {
    pub direction: Vec3,
    pub color:     Vec3,
    pub intensity: f32,
}
```

---

## 3. Layout GPU — 3 Bind Groups

### Group 0 (VERTEX) — MVP + Model par entité

Passe de 1 mat4x4 à **2 mat4x4** (MVP + Model) :

```rust
#[repr(C)]
#[derive(Pod, Zeroable)]
struct EntityUniforms {
    mvp:   [[f32; 4]; 4],   // 64 bytes
    model: [[f32; 4]; 4],   // 64 bytes
}
// Total : 128 bytes par entité
```

BindGroupLayout entry : `size = 128 bytes`, reste un buffer UNIFORM per-entity.

### Group 1 (FRAGMENT) — Texture + Sampler

Inchangé.

### Group 2 (FRAGMENT | VERTEX) — LightUniforms partagé

Un seul buffer, mis à jour chaque frame :

```rust
#[repr(C)]
#[derive(Pod, Zeroable)]
struct GpuDirectionalLight {
    direction: [f32; 3], _p0: f32,
    color:     [f32; 3], intensity: f32,
}   // 32 bytes

#[repr(C)]
#[derive(Pod, Zeroable)]
struct GpuPointLight {
    position: [f32; 3], _p0: f32,
    color:    [f32; 3], intensity: f32,
}   // 32 bytes

#[repr(C)]
#[derive(Pod, Zeroable)]
struct LightUniforms {
    directional: GpuDirectionalLight,   // 32 bytes
    points:      [GpuPointLight; 8],    // 256 bytes
    n_points:    u32,                   // 4 bytes
    _pad:        [u32; 3],              // 12 bytes (align 16)
    camera_pos:  [f32; 3],             // 12 bytes (pour specular)
    _pad2:       f32,                  // 4 bytes
}
// Total : 32 + 256 + 16 + 16 = 320 bytes
```

Pipeline layout : `bind_group_layouts: [&mvp_model_layout, &texture_layout, &lights_layout]`

---

## 4. Shader WGSL (`shader.wgsl`)

### Uniforms

```wgsl
// Group 0 — per entity
struct EntityUniforms {
    mvp:   mat4x4<f32>,
    model: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> entity: EntityUniforms;

// Group 1 — texture
@group(1) @binding(0) var t_albedo: texture_2d<f32>;
@group(1) @binding(1) var s_albedo: sampler;

// Group 2 — lights
struct DirectionalLight { direction: vec3<f32>, color: vec3<f32>, intensity: f32 }
struct PointLight { position: vec3<f32>, color: vec3<f32>, intensity: f32 }
struct LightUniforms {
    directional: DirectionalLight,
    points: array<PointLight, 8>,
    n_points: u32,
    camera_pos: vec3<f32>,
}
@group(2) @binding(0) var<uniform> lights: LightUniforms;
```

### Vertex Shader

```wgsl
struct VertexOutput {
    @builtin(position) clip_pos:  vec4<f32>,
    @location(0)       world_pos: vec3<f32>,
    @location(1)       world_nor: vec3<f32>,
    @location(2)       color:     vec3<f32>,
    @location(3)       uv:        vec2<f32>,
}

@vertex fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world4      = entity.model * vec4<f32>(in.position, 1.0);
    out.clip_pos    = entity.mvp * vec4<f32>(in.position, 1.0);
    out.world_pos   = world4.xyz;
    // Normale en world space — mat3x3(model) valide pour scale uniforme
    out.world_nor   = normalize(mat3x3<f32>(entity.model[0].xyz, entity.model[1].xyz, entity.model[2].xyz) * in.normal);
    out.color       = in.color;
    out.uv          = in.uv;
    return out;
}
```

### Fragment Shader — Blinn-Phong

```wgsl
@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let albedo    = textureSample(t_albedo, s_albedo, in.uv).rgb * in.color;
    let N         = normalize(in.world_nor);
    let V         = normalize(lights.camera_pos - in.world_pos);

    var lighting  = vec3<f32>(0.15) * albedo;  // ambient constant

    // Lumière directionnelle
    let L_dir     = normalize(-lights.directional.direction);
    let H_dir     = normalize(L_dir + V);
    let diff_dir  = max(dot(N, L_dir), 0.0);
    let spec_dir  = pow(max(dot(N, H_dir), 0.0), 32.0);
    lighting += lights.directional.color * lights.directional.intensity
                * (albedo * diff_dir + vec3(0.3) * spec_dir);

    // Point lights
    for (var i = 0u; i < lights.n_points; i++) {
        let lp      = lights.points[i];
        let L_vec   = lp.position - in.world_pos;
        let dist    = length(L_vec);
        let atten   = 1.0 / (1.0 + 0.09 * dist + 0.032 * dist * dist);
        let L       = L_vec / dist;
        let H       = normalize(L + V);
        let diff    = max(dot(N, L), 0.0);
        let spec    = pow(max(dot(N, H), 0.0), 32.0);
        lighting += lp.color * lp.intensity * atten
                    * (albedo * diff + vec3(0.3) * spec);
    }

    return vec4<f32>(lighting, 1.0);
}
```

**Atténuation :** formule quadratique standard (constante=1, linéaire=0.09, quadratique=0.032).

---

## 5. API TypeScript (wasm_bindgen)

```typescript
// Lumière directionnelle — une seule, appel optionnel
world.add_directional_light(dx, dy, dz, r, g, b, intensity);

// Point light — attachée à une entité avec Transform
world.add_point_light(entity_id, r, g, b, intensity);
// Bouger la lampe : world.set_position(entity_id, x, y, z)
```

### Démo FPS — Scène éclairée

```typescript
// Lumière directionnelle (soleil oblique, légèrement chaud)
world.add_directional_light(-0.5, -1.0, -0.3,  1.0, 0.95, 0.8,  1.2);

// 2 point lights colorées
const lamp1 = world.create_entity();
world.add_transform(lamp1, 4, 2, 4);
world.add_point_light(lamp1, 0.3, 0.8, 1.0, 8.0);   // bleu-cyan

const lamp2 = world.create_entity();
world.add_transform(lamp2, -4, 2, -4);
world.add_point_light(lamp2, 1.0, 0.4, 0.2, 8.0);   // orange-rouge
```

---

## 6. Pipeline de rendu — Changements dans `render_frame`

1. **Upload Group 0** : écrire `EntityUniforms { mvp, model }` (128 bytes) au lieu de juste MVP (64 bytes).
2. **Upload Group 2** : construire `LightUniforms` :
   - Remplir `directional` depuis `self.directional_light`
   - Itérer `point_lights` ECS → collecter `(Transform.position, PointLight.color/intensity)` → remplir `points[0..n]`
   - Mettre `camera_pos = self.camera.eye`
   - Écrire dans `self.light_buffer`
3. **Draw call** : bind les 3 groupes : `set_bind_group(0..=2)`.

---

## 7. Invariants et limites

- Max 8 point lights (hard-coded). Dépasser = silencieusement ignoré (n_points clampé à 8).
- Shininess = 32 fixe. Configurable par entité arrive en Phase 6 (PBR).
- Normale correcte seulement pour scale uniforme (cubes). Non-uniform scale = Phase 6.
- Directional light : une seule. Pas de multi-sun en Phase 4.
- Pas de shadow maps — vient en Phase 6.

---

## 8. Livrables

- [ ] `engine-core/src/mesh.rs` — `Vertex` avec `normal`, `CUBE_VERTICES` avec normales, `Vertex::desc()` à 4 attributs
- [ ] `engine-core/src/shader.wgsl` — shader Blinn-Phong complet
- [ ] `engine-core/src/ecs/components.rs` — `PointLight` struct
- [ ] `engine-core/src/lib.rs` — `LightUniforms` GPU structs, `light_bind_group_layout`, `light_buffer`, `light_bind_group`, `point_lights: SparseSet<PointLight>`, `directional_light: Option<...>`, API `add_point_light` + `add_directional_light`, mise à jour `render_frame` + `EntityUniforms`
- [ ] `game-app/src/main.ts` — ajout des lumières dans la démo
