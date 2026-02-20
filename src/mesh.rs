use bytemuck::{Pod, Zeroable};
use std::mem;

/// Vertex avec position xyz et couleur rgb.
/// #[repr(C)] garantit que bytemuck peut l'interpréter comme bytes bruts.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub color:    [f32; 3],
}

impl Vertex {
    /// Descriptor pour wgpu : comment lire ce type depuis le vertex buffer.
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                // @location(0) position
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x3,
                },
                // @location(1) color
                wgpu::VertexAttribute {
                    offset: mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x3,
                },
            ],
        }
    }
}

// 24 vertices (4 par face × 6 faces) → chaque face a sa propre couleur.
// L'ordre des faces : front, back, left, right, bottom, top.
pub const CUBE_VERTICES: &[Vertex] = &[
    // Front (z = +0.5) — rouge
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.2, 0.2] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.9, 0.2, 0.2] },
    // Back (z = -0.5) — vert
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2] },
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.8, 0.2] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.2, 0.8, 0.2] },
    // Left (x = -0.5) — bleu
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.2, 0.4, 0.9] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.2, 0.4, 0.9] },
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.2, 0.4, 0.9] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.2, 0.4, 0.9] },
    // Right (x = +0.5) — jaune
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.9, 0.2] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.9, 0.2] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.9, 0.9, 0.2] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.9, 0.9, 0.2] },
    // Bottom (y = -0.5) — orange
    Vertex { position: [-0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1] },
    Vertex { position: [ 0.5, -0.5, -0.5], color: [0.9, 0.5, 0.1] },
    Vertex { position: [ 0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1] },
    Vertex { position: [-0.5, -0.5,  0.5], color: [0.9, 0.5, 0.1] },
    // Top (y = +0.5) — violet
    Vertex { position: [-0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9] },
    Vertex { position: [ 0.5,  0.5,  0.5], color: [0.6, 0.2, 0.9] },
    Vertex { position: [ 0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9] },
    Vertex { position: [-0.5,  0.5, -0.5], color: [0.6, 0.2, 0.9] },
];

// 36 indices : 6 faces × 2 triangles × 3 sommets. Winding CCW.
pub const CUBE_INDICES: &[u16] = &[
     0,  1,  2,   0,  2,  3,  // Front
     4,  5,  6,   4,  6,  7,  // Back
     8,  9, 10,   8, 10, 11,  // Left
    12, 13, 14,  12, 14, 15,  // Right
    16, 17, 18,  16, 18, 19,  // Bottom
    20, 21, 22,  20, 22, 23,  // Top
];
