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

pub const CUBE_INDICES: &[u16] = &[
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
];

/// Plan horizontal XZ centré sur l'origine (face +Y).
pub const PLANE_VERTICES: &[Vertex] = &[
    Vertex { position: [-0.5, 0.0, -0.5], color: [0.5, 0.5, 0.5], uv: [0.0, 0.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, 0.0, -0.5], color: [0.5, 0.5, 0.5], uv: [1.0, 0.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [ 0.5, 0.0,  0.5], color: [0.5, 0.5, 0.5], uv: [1.0, 1.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
    Vertex { position: [-0.5, 0.0,  0.5], color: [0.5, 0.5, 0.5], uv: [0.0, 1.0], normal: [0.0, 1.0, 0.0], tangent: [1.0, 0.0, 0.0, 1.0] },
];

pub const PLANE_INDICES: &[u16] = &[0, 1, 2, 0, 2, 3];
