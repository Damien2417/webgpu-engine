const PI: f32 = 3.14159265358979;

// ── Group 0 — uniforms par entité ────────────────────────────────────────
struct EntityUniforms {
    mvp:       mat4x4<f32>,
    model:     mat4x4<f32>,
    metallic:  f32,
    roughness: f32,
    // Le padding Rust _pad1 est implicite ici pour l'alignement,
    // mais WGSL gère scale comme vec4 correctement aligné après les floats.
    // Cependant, il faut être strict :
    scale:     vec4<f32>, 
    emissive:  vec3<f32>, // NOUVEAU
    pad2:      f32,       // NOUVEAU
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
    ambient_color:   vec4<f32>,  // rgb + intensity in w
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

    // --- LOGIQUE DE TILING INTELLIGENTE ---
    // On utilise la normale brute (object space) pour savoir sur quelle face on est.
    // Pour un cube, la normale est toujours (1,0,0), (0,1,0) ou (0,0,1).
    let n = abs(in.normal);
    var s = vec2<f32>(1.0, 1.0);

    // Si normale X (Gauche/Droite) -> utilise Z et Y
    if (n.x > 0.5) {
        s = vec2<f32>(entity.scale.z, entity.scale.y);
    } 
    // Si normale Y (Haut/Bas) -> utilise X et Z
    else if (n.y > 0.5) {
        s = vec2<f32>(entity.scale.x, entity.scale.z);
    } 
    // Sinon normale Z (Devant/Derrière) -> utilise X et Y
    else {
        s = vec2<f32>(entity.scale.x, entity.scale.y);
    }
    
    out.uv = in.uv * s;
    
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

    // PCF 3×3 — tous les fragments exécutent textureSampleCompare (uniform control flow)
    let tx = 1.0 / 2048.0;
    var s  = 0.0;
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            let offset = vec2<f32>(f32(x), f32(y)) * tx;
            s += textureSampleCompare(shadow_map, shadow_sampler, uv + offset, depth);
        }
    }
    // Hors de la frustum lumière → pas d'ombre (select après le PCF)
    let in_frustum = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 && proj.z <= 1.0;
    return select(1.0, s / 9.0, in_frustum);
}

// ── Fragment Shader — GGX Cook-Torrance PBR ──────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let albedo_srgb = textureSample(t_albedo, s_albedo, in.uv).rgb * in.color;

    // Décodage normal map en world space via TBN
    let T     = normalize(in.world_tan.xyz);
    let N_geo = normalize(in.world_nor);
    let B     = normalize(cross(N_geo, T) * in.world_tan.w);
    let TBN   = mat3x3<f32>(T, B, N_geo);
    let n_ts  = textureSample(t_normal, s_normal, in.uv).xyz * 2.0 - 1.0;
    let N     = normalize(TBN * n_ts);

    let V         = normalize(lights.camera_pos.xyz - in.world_pos);
    let metallic  = entity.metallic;
    let roughness = max(entity.roughness, 0.04); // éviter roughness=0 (singularité)
    let F0        = mix(vec3<f32>(0.04), albedo_srgb, metallic);

    var Lo = vec3<f32>(0.0);

    // Lumière directionnelle + shadow
    {
        let L        = normalize(-lights.directional.direction);
        let H        = normalize(V + L);
        let NdL      = max(dot(N, L), 0.0);
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
        let lp       = lights.points[i];
        let L_vec    = lp.position - in.world_pos;
        let dist     = length(L_vec);
        let L        = L_vec / dist;
        let H        = normalize(V + L);
        let NdL      = max(dot(N, L), 0.0);
        let atten    = 1.0 / (dist * dist + 0.0001);
        let radiance = lp.color * lp.intensity * atten;

        let NDF = distribution_ggx(N, H, roughness);
        let G   = geometry_smith(N, V, L, roughness);
        let F   = fresnel_schlick(max(dot(H, V), 0.0), F0);

        let kS   = F;
        let kD   = (1.0 - kS) * (1.0 - metallic);
        let spec = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * NdL + 0.0001);

        Lo += (kD * albedo_srgb / PI + spec) * radiance * NdL;
    }

    // Ambient light (driven by set_ambient_light)
    let ambient = lights.ambient_color.rgb * lights.ambient_color.w * albedo_srgb;

    // Ajout de l'émissif (ne dépend pas de la lumière, s'ajoute à la fin)
    let color = ambient + Lo + (albedo_srgb * entity.emissive);

    // Tone mapping Reinhard
    let mapped = color / (color + vec3<f32>(1.0));
    let gamma  = pow(mapped, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(gamma, 1.0);
}
