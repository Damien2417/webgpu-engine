# Phase 6 — PBR + Shadow Maps : Design Document

**Date :** 2026-02-21
**Objectif :** Rendu physiquement correct (GGX Cook-Torrance) + ombres projetées (shadow map directional light).
**Prérequis :** Phase 5 complète (scènes JSON, SparseSet::remove, entités persistantes).

---

## Scope

### Inclus
- Shadow map pour la **lumière directionnelle uniquement** (2048×2048, PCF 3×3)
- BRDF GGX Cook-Torrance : distribution D, géométrie G, fresnel F
- metallic / roughness en **uniforms par entité** (pas de texture maps)
- Normal maps avec flat-normal default (aucun binding supplémentaire si absent)
- Vertex struct étendu avec tangent (vec4)

### Exclu (YAGNI)
- Shadow cube maps pour point lights (trop complexe pour cette phase)
- Cascaded shadow maps
- Textures metallic-roughness maps (pas de système de textures multi-slots encore)
- Emissive / AO maps

---

## Architecture GPU — 4 bind groups

| Group | Visibility | Contenu | Taille |
|-------|-----------|---------|--------|
| 0 | VERTEX + FRAGMENT | `EntityUniforms { mvp, model, metallic, roughness, _pad[2] }` | 144 bytes |
| 1 | FRAGMENT | albedo_tex, albedo_sampler, normal_tex, normal_sampler | — |
| 2 | VERTEX + FRAGMENT | `LightUniforms` étendu + `light_space_mat: mat4x4` | 384 bytes |
| 3 | FRAGMENT | shadow_depth_tex (comparison), shadow_sampler | — |

### EntityUniforms (Group 0)

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct EntityUniforms {
    mvp:       [[f32; 4]; 4],  // 64 bytes
    model:     [[f32; 4]; 4],  // 64 bytes
    metallic:  f32,             //  4 bytes
    roughness: f32,             //  4 bytes
    _pad:      [f32; 2],        //  8 bytes (alignement 16)
}
// Total : 144 bytes
```

### LightUniforms étendu (Group 2)

```rust
#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct LightUniforms {
    camera_pos:      [f32; 4],            //  16 bytes
    directional:     GpuDirectionalLight, //  32 bytes
    n_points:        u32,                 //   4 bytes
    _pad:            [u32; 3],            //  12 bytes
    points:          [GpuPointLight; 8],  // 256 bytes
    light_space_mat: [[f32; 4]; 4],       //  64 bytes  ← nouveau
}
// Total : 384 bytes
```

### Group 1 — albedo + normal

```
binding 0 : texture_2d<f32>   albedo
binding 1 : sampler            albedo_sampler
binding 2 : texture_2d<f32>   normal
binding 3 : sampler            normal_sampler
```

Default normal texture : 1×1 RGBA `[128, 128, 255, 255]` (vecteur (0,0,1) en tangent space).

### Group 3 — shadow map

```
binding 0 : texture_depth_2d   shadow_map
binding 1 : sampler_comparison  shadow_sampler
```

---

## Shadow Map

### Paramètres
- Format : `Depth32Float`
- Résolution : 2048×2048
- PCF : noyau 3×3 (9 samples), biais depth 0.005

### Light Space Matrix

Calculé chaque frame à partir de la lumière directionnelle :

```
light_view = look_at(-direction.normalize() * 30.0, Vec3::ZERO, Vec3::Y)
light_proj = ortho(-20, 20, -20, 20, 0.1, 100.0)
light_space_mat = light_proj * light_view
```

Stocké dans `LightUniforms.light_space_mat`, uploadé via `light_buffer`.

### Shadow Pass

Pipeline depth-only (`shadow.wgsl`) :
- Pas de color attachment
- Depth attachment = shadow_depth_view
- Vertex only : `clip_pos = light_space_mat * model * position`
- Tous les `mesh_renderers` sont dessinés

### Sampling dans fs_main

```wgsl
fn shadow_factor(world_pos: vec3<f32>) -> f32 {
    let lsp   = lights.light_space_mat * vec4<f32>(world_pos, 1.0);
    let proj  = lsp.xyz / lsp.w;
    let uv    = vec2<f32>(proj.x * 0.5 + 0.5, -proj.y * 0.5 + 0.5);
    let depth = proj.z - 0.005; // biais
    var s = 0.0;
    let tx = 1.0 / 2048.0;
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            s += textureSampleCompare(shadow_map, shadow_sampler,
                                     uv + vec2<f32>(f32(x), f32(y)) * tx, depth);
        }
    }
    return s / 9.0;
}
```

---

## PBR — GGX Cook-Torrance

### Fonctions BRDF (shader.wgsl)

```wgsl
fn distribution_ggx(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32
fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32
fn fresnel_schlick(cos_theta: f32, F0: vec3<f32>) -> vec3<f32>
```

### Calcul par lumière

```
F0    = mix(vec3(0.04), albedo, metallic)
kS    = fresnel_schlick(max(dot(H, V), 0.0), F0)
kD    = (1.0 - kS) * (1.0 - metallic)

NDF   = distribution_ggx(N, H, roughness)
G     = geometry_smith(N, V, L, roughness)
F     = fresnel_schlick(max(dot(H,V), 0.0), F0)

spec  = (NDF * G * F) / (4.0 * NdotV * NdotL + 0.0001)
Lo   += (kD * albedo / PI + spec) * radiance * NdotL
```

### Shadow × directional light

```wgsl
let shadow = shadow_factor(in.world_pos);
Lo_directional *= shadow;  // annule diffuse+spec si dans l'ombre
```

### Ambient IBL simplifié

```wgsl
let ambient = vec3<f32>(0.03) * albedo * ao;  // ao = 1.0 (pas de texture AO)
```

---

## Normal Maps

### Vertex étendu

```rust
pub struct Vertex {
    pub position: [f32; 3],
    pub color:    [f32; 3],
    pub uv:       [f32; 2],
    pub normal:   [f32; 3],
    pub tangent:  [f32; 4],  // xyz = tangent, w = bitangent sign (±1)
}
// Total : 60 bytes (15 floats)
```

CUBE_VERTICES : tangentes hardcodées par face.

### TBN dans vertex shader

```wgsl
let T   = normalize(mat3(entity.model) * in.tangent.xyz);
let N   = normalize(mat3(entity.model) * in.normal);
let B   = cross(N, T) * in.tangent.w;
let TBN = mat3x3<f32>(T, B, N);
```

### Décodage normal map

```wgsl
let n_ts  = textureSample(t_normal, s_normal, in.uv).xyz * 2.0 - 1.0;
let N_world = normalize(TBN * n_ts);
```

---

## Composant Material (Rust)

```rust
pub struct Material {
    pub albedo_tex:  u32,   // TextureId GPU
    pub normal_tex:  u32,   // TextureId GPU — u32::MAX = flat normal default
    pub metallic:    f32,   // 0.0 (diélectrique) … 1.0 (métal)
    pub roughness:   f32,   // 0.0 (mirror) … 1.0 (mat)
}
```

---

## Struct SceneMaterial étendu (scene.rs)

```rust
#[derive(Serialize, Deserialize)]
pub struct SceneMaterial {
    pub texture:        String,
    #[serde(default)]
    pub normal_texture: String,        // "" = pas de normal map
    #[serde(default = "default_metallic")]
    pub metallic:       f32,           // default 0.0
    #[serde(default = "default_roughness")]
    pub roughness:      f32,           // default 0.5
}

fn default_metallic()  -> f32 { 0.0 }
fn default_roughness() -> f32 { 0.5 }
```

---

## Nouvelles API wasm_bindgen

```typescript
// Remplace add_material()
world.add_pbr_material(id: number, albedo_tex: number, metallic: number, roughness: number): void

// Optionnel — applique une normal map
world.set_normal_map(id: number, normal_tex_id: number): void
```

`add_material()` conservé pour rétrocompatibilité (metallic=0, roughness=0.5, normal=flat).

---

## Ordre de rendu (render_frame)

```
1. Upload EntityUniforms (MVP + model + metallic + roughness) pour chaque entité
2. Upload LightUniforms (camera_pos + lights + light_space_mat)
3. Shadow pass  → depth texture depuis la lumière
4. Main pass    → PBR + shadow sampling
```

---

## Demo (main.ts)

- Sol : diélectrique, roughness=0.8 (mat béton)
- 4 cubes aux coins : métal, roughness=0.2 (brillants)
- 4 cubes centraux : diélectrique, roughness=0.5
- Ombre du joueur et des cubes visible sur le sol
- Lumière directionnelle légèrement de côté pour ombres longues
- Touche N pour switcher level1 ↔ level2 (conservé)

---

## Pièges anticipés

- **`texture_depth_2d` vs `texture_2d`** : shadow map doit être `texture_depth_2d` + `sampler_comparison` dans WGSL
- **Biais shadow** : `depth - 0.005` évite le shadow acne ; trop élevé → peter panning
- **Coordonnées UV shadow** : Y inversé en WebGPU (`-proj.y * 0.5 + 0.5`)
- **ortho matrix** : `Mat4::orthographic_rh` pour correspondre à la convention WebGPU (NDC Z 0..1)
- **Bind group 1 étendu** : changer le layout casse les bind groups existants → recréer tous les bind groups d'entités
- **`texture_depth_2d` binding** : `wgpu::BindingType::Texture { sample_type: TextureSampleType::Depth, .. }` + `wgpu::BindingType::Sampler(SamplerBindingType::Comparison)`
- **Tangent w = ±1** : signe du bitangent (handedness), critical pour normal maps cohérentes
- **`wasm-pack pkg/.gitignore`** : toujours `*` → pkg/ non commité, normal
