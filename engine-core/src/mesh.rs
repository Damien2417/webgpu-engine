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

// Keep a +Y-facing winding (CCW when viewed from above) to avoid back-face culling.
pub const PLANE_INDICES: &[u16] = &[0, 2, 1, 0, 3, 2];

/// Generates a UV sphere with `segs` segments (radius = 0.5).
pub fn generate_sphere(segs: u32) -> (Vec<Vertex>, Vec<u32>) {
    let lat = segs;
    let lon = segs * 2;
    let mut verts: Vec<Vertex> = Vec::new();
    let mut idx:   Vec<u32>   = Vec::new();

    for i in 0..=lat {
        let theta     = std::f32::consts::PI * i as f32 / lat as f32;
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        for j in 0..=lon {
            let phi     = 2.0 * std::f32::consts::PI * j as f32 / lon as f32;
            let sin_phi = phi.sin();
            let cos_phi = phi.cos();
            let x = sin_theta * cos_phi;
            let y = cos_theta;
            let z = sin_theta * sin_phi;
            verts.push(Vertex {
                position: [x * 0.5, y * 0.5, z * 0.5],
                color:    [1.0, 1.0, 1.0],
                uv:       [j as f32 / lon as f32, i as f32 / lat as f32],
                normal:   [x, y, z],
                tangent:  [-sin_phi, 0.0, cos_phi, 1.0],
            });
        }
    }

    for i in 0..lat {
        for j in 0..lon {
            let c = i * (lon + 1) + j;
            let n = c + lon + 1;
            idx.extend_from_slice(&[c, n, c + 1, n, n + 1, c + 1]);
        }
    }

    (verts, idx)
}

/// Generates a cylinder with `segs` segments, height=1, radius=0.5.
pub fn generate_cylinder(segs: u32) -> (Vec<Vertex>, Vec<u32>) {
    let mut verts: Vec<Vertex> = Vec::new();
    let mut idx:   Vec<u32>   = Vec::new();
    let r = 0.5_f32;
    let h = 0.5_f32;

    // Side vertices (2 rings: bottom + top)
    for ring in 0..=1 {
        let y = if ring == 0 { -h } else { h };
        for j in 0..=segs {
            let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
            let (s, c) = angle.sin_cos();
            verts.push(Vertex {
                position: [r * c, y, r * s],
                color:    [1.0, 1.0, 1.0],
                uv:       [j as f32 / segs as f32, ring as f32],
                normal:   [c, 0.0, s],
                tangent:  [-s, 0.0, c, 1.0],
            });
        }
    }

    // Side indices
    let ring_verts = segs + 1;
    for j in 0..segs {
        let b = j;
        let t = j + ring_verts;
        idx.extend_from_slice(&[b, t, b+1, t, t+1, b+1]);
    }

    // Top cap
    let top_center = verts.len() as u32;
    verts.push(Vertex { position: [0.0, h, 0.0], color: [1.0,1.0,1.0], uv: [0.5,0.5], normal: [0.0,1.0,0.0], tangent: [1.0,0.0,0.0,1.0] });
    let top_start = verts.len() as u32;
    for j in 0..=segs {
        let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
        let (s, c) = angle.sin_cos();
        verts.push(Vertex { position: [r*c, h, r*s], color:[1.0,1.0,1.0], uv:[0.5+0.5*c,0.5+0.5*s], normal:[0.0,1.0,0.0], tangent:[1.0,0.0,0.0,1.0] });
    }
    for j in 0..segs { idx.extend_from_slice(&[top_center, top_start+j+1, top_start+j]); }

    // Bottom cap
    let bot_center = verts.len() as u32;
    verts.push(Vertex { position: [0.0, -h, 0.0], color: [1.0,1.0,1.0], uv: [0.5,0.5], normal: [0.0,-1.0,0.0], tangent: [1.0,0.0,0.0,1.0] });
    let bot_start = verts.len() as u32;
    for j in 0..=segs {
        let angle = 2.0 * std::f32::consts::PI * j as f32 / segs as f32;
        let (s, c) = angle.sin_cos();
        verts.push(Vertex { position: [r*c, -h, r*s], color:[1.0,1.0,1.0], uv:[0.5+0.5*c,0.5+0.5*s], normal:[0.0,-1.0,0.0], tangent:[1.0,0.0,0.0,1.0] });
    }
    for j in 0..segs { idx.extend_from_slice(&[bot_center, bot_start+j+1, bot_start+j]); }

    (verts, idx)
}
