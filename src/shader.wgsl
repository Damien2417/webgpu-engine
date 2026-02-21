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
