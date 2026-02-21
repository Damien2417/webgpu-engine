use bytemuck::{Pod, Zeroable};
use std::mem;

/// Vertex avec position xyz, couleur rgb, coordonnées UV et normale.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub color:    [f32; 3],
    pub uv:       [f32; 2],
    pub normal:   [f32; 3],  // stride passe de 32 à 44 bytes
}

impl Vertex {
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                // @location(0) position
                wgpu::VertexAttribute {
                    offset:          0,
                    shader_location: 0,
                    format:          wgpu::VertexFormat::Float32x3,
                },
                // @location(1) color
                wgpu::VertexAttribute {
                    offset:          mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format:          wgpu::VertexFormat::Float32x3,
                },
                // @location(2) uv
                wgpu::VertexAttribute {
                    offset:          (mem::size_of::<[f32; 3]>() * 2) as wgpu::BufferAddress,
                    shader_location: 2,
                    format:          wgpu::VertexFormat::Float32x2,
                },
                // @location(3) normal
                wgpu::VertexAttribute {
                    offset:          (mem::size_of::<[f32; 3]>() * 2 + mem::size_of::<[f32; 2]>()) as wgpu::BufferAddress,
                    shader_location: 3,
                    format:          wgpu::VertexFormat::Float32x3,
                },
            ],
        }
    }
}

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

pub const CUBE_INDICES: &[u16] = &[
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
];
