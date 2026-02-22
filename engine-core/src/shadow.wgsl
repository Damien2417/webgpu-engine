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
