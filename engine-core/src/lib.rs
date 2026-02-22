#![cfg(target_arch = "wasm32")]

mod camera;
mod ecs;
mod mesh;
mod scene;

use camera::Camera;
use ecs::{Collider, Material, MeshRenderer, MeshType, PointLight, RigidBody, SparseSet, Transform};
use scene::{SceneData, SceneDirectionalLight, SceneMaterial, ScenePointLight,
            SceneRigidBody, SceneTransform};
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES};

use std::collections::{HashMap, HashSet};

use bytemuck;
use glam::{EulerRot, Mat4};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

struct EntityGpu {
    uniform_buffer:        wgpu::Buffer,   // EntityUniforms (144 bytes) — Group 0
    bind_group:            wgpu::BindGroup,
    shadow_uniform_buffer: wgpu::Buffer,   // ShadowUniforms (64 bytes) — shadow pass
    shadow_bind_group:     wgpu::BindGroup,
}

#[derive(Default)]
struct InputState {
    keys:     u32,
    mouse_dx: f32,
    mouse_dy: f32,
}

/// Ressources GPU pour une texture chargee.
struct TextureGpu {
    #[allow(dead_code)]
    texture: wgpu::Texture,
    view:    wgpu::TextureView,
}



// ── Types GPU pour l'éclairage ────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct EntityUniforms {
    mvp:       [[f32; 4]; 4], // 64
    model:     [[f32; 4]; 4], // 64
    metallic:  f32,           // 4
    roughness: f32,           // 4
    _pad1:     [f32; 2],      // 8
    scale:     [f32; 4],      // 16
    emissive:  [f32; 3],      // 12 (NOUVEAU)
    _pad2:     f32,           // 4  (Padding final pour alignement 16 bytes)
}
// Total : 176 bytes

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuDirectionalLight {
    direction: [f32; 3], _p0: f32,
    color:     [f32; 3], intensity: f32,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuPointLight {
    position:  [f32; 3], _p0: f32,
    color:     [f32; 3], intensity: f32,
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct LightUniforms {
    camera_pos:      [f32; 4],            //  16 bytes — offset   0
    directional:     GpuDirectionalLight, //  32 bytes — offset  16
    n_points:        u32,                 //   4 bytes — offset  48
    _pad:            [u32; 3],            //  12 bytes — offset  52
    points:          [GpuPointLight; 8],  // 256 bytes — offset  64
    light_space_mat: [[f32; 4]; 4],       //  64 bytes — offset 320
}
// Total : 384 bytes

/// Données CPU pour la lumière directionnelle unique.
struct DirectionalLightData {
    direction: glam::Vec3,
    color:     glam::Vec3,
    intensity: f32,
}

#[wasm_bindgen]
pub struct World {
    device:  wgpu::Device,
    queue:   wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config:  wgpu::SurfaceConfiguration,
    depth_texture: wgpu::Texture,
    depth_view:    wgpu::TextureView,
    render_pipeline:   wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    vertex_buffer: wgpu::Buffer,
    index_buffer:  wgpu::Buffer,
    next_id:        usize,
    transforms:     SparseSet<Transform>,
    mesh_renderers: SparseSet<MeshRenderer>,
    entity_gpus:    SparseSet<EntityGpu>,
    camera: Camera,

    // Textures
    texture_bind_group_layout: wgpu::BindGroupLayout,
    sampler:                   wgpu::Sampler,
    default_tex:               TextureGpu,
    default_normal_tex:        TextureGpu,
    textures:                  Vec<TextureGpu>,

    // ECS
    materials: SparseSet<Material>,

    // Physique
    rigid_bodies:  SparseSet<RigidBody>,
    colliders:     SparseSet<Collider>,

    // Input + caméra FPS
    input:          InputState,
    player_entity:  Option<usize>,
    camera_yaw:     f32,   // radians — rotation horizontale
    camera_pitch:   f32,   // radians — rotation verticale, clampé ±89°

    // Éclairage
    point_lights:            SparseSet<PointLight>,
    directional_light:       Option<DirectionalLightData>,
    light_bind_group_layout: wgpu::BindGroupLayout,
    light_buffer:            wgpu::Buffer,
    light_bind_group:        wgpu::BindGroup,

    // Shadow map
    shadow_depth_texture:     wgpu::Texture,
    shadow_depth_view:        wgpu::TextureView,
    shadow_bind_group_layout: wgpu::BindGroupLayout,
    shadow_bind_group:        wgpu::BindGroup,
    shadow_pipeline:          wgpu::RenderPipeline,
    shadow_entity_layout:     wgpu::BindGroupLayout,

    // Scènes
    persistent_entities: HashSet<usize>,
    texture_registry:    HashMap<String, u32>,
}

fn create_depth_texture(
    device: &wgpu::Device,
    config: &wgpu::SurfaceConfiguration,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth_texture"),
        size: wgpu::Extent3d {
            width:                 config.width,
            height:                config.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count:    1,
        dimension:       wgpu::TextureDimension::D2,
        format:          wgpu::TextureFormat::Depth32Float,
        usage:           wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats:    &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

/// Cree une TextureGpu depuis des donnees RGBA brutes.
fn create_texture_from_data(
    device: &wgpu::Device,
    queue:  &wgpu::Queue,
    width:  u32,
    height: u32,
    data:   &[u8],
    generate_mipmaps: bool, // <- NOUVEAU PARAMÈTRE
) -> TextureGpu {
    // 1. Calculer le nombre de niveaux de mipmaps requis
    let mip_level_count = if generate_mipmaps {
        width.max(height).ilog2() + 1
    } else {
        1
    };

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("tex"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count,
        sample_count:    1,
        dimension:       wgpu::TextureDimension::D2,
        format:          wgpu::TextureFormat::Rgba8UnormSrgb,
        usage:           wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats:    &[],
    });

    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture, mip_level: 0,
            origin:  wgpu::Origin3d::ZERO,
            aspect:  wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset: 0, bytes_per_row: Some(4 * width), rows_per_image: None,
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );

    // Génération des mipmaps seulement si demandée
    if generate_mipmaps {
        let mut current_data = data.to_vec();
        let mut w = width;
        let mut h = height;

        for level in 1..mip_level_count {
            let next_w = w.max(2) / 2;
            let next_h = h.max(2) / 2;
            let mut next_data = vec![0u8; (next_w * next_h * 4) as usize];

            for y in 0..next_h {
                for x in 0..next_w {
                    let mut r = 0u32;
                    let mut g = 0u32;
                    let mut b = 0u32;
                    let mut a = 0u32;

                    for dy in 0..2 {
                        for dx in 0..2 {
                            let sx = (x * 2 + dx).min(w - 1);
                            let sy = (y * 2 + dy).min(h - 1);
                            let idx = ((sy * w + sx) * 4) as usize;
                            r += current_data[idx] as u32;
                            g += current_data[idx + 1] as u32;
                            b += current_data[idx + 2] as u32;
                            a += current_data[idx + 3] as u32;
                        }
                    }

                    let dst_idx = ((y * next_w + x) * 4) as usize;
                    next_data[dst_idx]     = (r / 4) as u8;
                    next_data[dst_idx + 1] = (g / 4) as u8;
                    next_data[dst_idx + 2] = (b / 4) as u8;
                    next_data[dst_idx + 3] = (a / 4) as u8;
                }
            }

            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture, mip_level: level,
                    origin:  wgpu::Origin3d::ZERO,
                    aspect:  wgpu::TextureAspect::All,
                },
                &next_data,
                wgpu::TexelCopyBufferLayout {
                    offset: 0, bytes_per_row: Some(4 * next_w), rows_per_image: None,
                },
                wgpu::Extent3d { width: next_w, height: next_h, depth_or_array_layers: 1 },
            );

            current_data = next_data;
            w = next_w;
            h = next_h;
        }
    }

    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    TextureGpu { texture, view }
}

/// Calcule le MTV pour séparer A de B (à soustraire de la position de A).
/// Retourne None si pas de chevauchement.
/// Calcule la matrice light-space pour la shadow map (directional light).
/// Vue ortho depuis -direction×30, projection couvrant ±20 unités.
fn compute_light_space_mat(direction: glam::Vec3) -> glam::Mat4 {
    let dir       = direction.normalize();
    let light_pos = -dir * 30.0;
    let view      = glam::Mat4::look_at_rh(light_pos, glam::Vec3::ZERO, glam::Vec3::Y);
    let proj      = glam::Mat4::orthographic_rh(-20.0, 20.0, -20.0, 20.0, 0.1, 100.0);
    proj * view
}

fn aabb_mtv(
    center_a: glam::Vec3, he_a: glam::Vec3,
    center_b: glam::Vec3, he_b: glam::Vec3,
) -> Option<glam::Vec3> {
    let diff   = center_b - center_a;
    let sum_he = he_a + he_b;

    let ox = sum_he.x - diff.x.abs();
    let oy = sum_he.y - diff.y.abs();
    let oz = sum_he.z - diff.z.abs();

    if ox <= 0.0 || oy <= 0.0 || oz <= 0.0 {
        return None;
    }

    // Axe de pénétration minimale — MTV à soustraire de la position de A pour sortir de B.
    // Convention : sign = même sens que diff (B est dans cette direction).
    // Soustraire le MTV de A → A s'éloigne de B.
    if ox < oy && ox < oz {
        Some(glam::Vec3::new(if diff.x > 0.0 { ox } else { -ox }, 0.0, 0.0))
    } else if oy < oz {
        Some(glam::Vec3::new(0.0, if diff.y > 0.0 { oy } else { -oy }, 0.0))
    } else {
        Some(glam::Vec3::new(0.0, 0.0, if diff.z > 0.0 { oz } else { -oz }))
    }
}

#[wasm_bindgen]
impl World {
    pub async fn new(canvas: HtmlCanvasElement) -> Result<World, JsValue> {
        console_error_panic_hook::set_once();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        let width  = canvas.width();
        let height = canvas.height();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::default(),
                compatible_surface:     Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let surface_caps = surface.get_capabilities(&adapter);
        let format = surface_caps
            .formats
            .first()
            .copied()
            .ok_or_else(|| JsValue::from_str("Aucun format de surface supporté"))?;

        let config = wgpu::SurfaceConfiguration {
            usage:                         wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode:                  wgpu::PresentMode::Fifo,
            alpha_mode:                    wgpu::CompositeAlphaMode::Opaque,
            view_formats:                  vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let (depth_texture, depth_view) = create_depth_texture(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bind_group_layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        // Texture bind group layout (Group 1) : albedo + sampler + normal + sampler
        let texture_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture_bind_group_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding:    0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                // Normal map texture
                wgpu::BindGroupLayoutEntry {
                    binding:    2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding:    3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        // Sampler partage (linear, repeat)
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label:          Some("texture_sampler"),
            address_mode_u: wgpu::AddressMode::Repeat, // Important pour la répétition
            address_mode_v: wgpu::AddressMode::Repeat, // Important pour la répétition
            address_mode_w: wgpu::AddressMode::Repeat,
            mag_filter:     wgpu::FilterMode::Linear,
            min_filter:     wgpu::FilterMode::Linear,
            mipmap_filter:  wgpu::MipmapFilterMode::Linear, // Correction du type ici
            ..Default::default()
        });

        // Texture blanche 1x1 par defaut
        let default_tex = create_texture_from_data(&device, &queue, 1, 1, &[255u8, 255, 255, 255], false);
        // Flat normal : (128, 128, 255, 255) = vecteur (0,0,1) en tangent space
        let default_normal_tex = create_texture_from_data(&device, &queue, 1, 1, &[128u8, 128, 255, 255], false);

        // ── Light bind group layout (Group 2) ────────────────────────────────────
        let light_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("light_bind_group_layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let light_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("light_buffer"),
            size:               std::mem::size_of::<LightUniforms>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let light_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("light_bind_group"),
            layout:  &light_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: light_buffer.as_entire_binding(),
            }],
        });

        // ── Shadow map infrastructure ─────────────────────────────────────────
        let shadow_size = wgpu::Extent3d { width: 2048, height: 2048, depth_or_array_layers: 1 };
        let shadow_depth_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow_depth"),
            size: shadow_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let shadow_depth_view = shadow_depth_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Bind group layout Group 3 : shadow_map (depth) + comparison sampler
        let shadow_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type:    wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled:   false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });

        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label:          Some("shadow_sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            compare:        Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });

        let shadow_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("shadow_bg"),
            layout:  &shadow_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding:  0,
                    resource: wgpu::BindingResource::TextureView(&shadow_depth_view),
                },
                wgpu::BindGroupEntry {
                    binding:  1,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
            ],
        });

        // Shadow pipeline — bind group 0 : light_mvp uniform per entity
        let shadow_entity_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow_entity_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let shadow_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("shadow_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shadow.wgsl").into()),
        });

        let shadow_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("shadow_pipeline_layout"),
            bind_group_layouts: &[&shadow_entity_layout],
            ..Default::default()
        });

        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("shadow_pipeline"),
            layout: Some(&shadow_pipeline_layout),
            vertex: wgpu::VertexState {
                module:      &shadow_shader,
                entry_point: Some("vs_shadow"),
                buffers:     &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: None,
            primitive: wgpu::PrimitiveState {
                topology:  wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::LessEqual,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState {
                    constant:    2,
                    slope_scale: 2.0,
                    clamp:       0.0,
                },
            }),
            multisample:    wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache:          None,
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[
                &bind_group_layout,
                &texture_bind_group_layout,
                &light_bind_group_layout,
                &shadow_bind_group_layout,
            ],
            ..Default::default()
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("render_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module:      &shader,
                entry_point: Some("vs_main"),
                buffers:     &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module:      &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology:           wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face:         wgpu::FrontFace::Ccw,
                cull_mode:          Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::Less,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample:    wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache:          None,
        });

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("vertex_buffer"),
            contents: bytemuck::cast_slice(CUBE_VERTICES),
            usage:    wgpu::BufferUsages::VERTEX,
        });

        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("index_buffer"),
            contents: bytemuck::cast_slice(CUBE_INDICES),
            usage:    wgpu::BufferUsages::INDEX,
        });

        web_sys::console::log_1(&"[World] Pipeline 3D initialisée".into());

        Ok(World {
            device,
            queue,
            surface,
            config,
            depth_texture,
            depth_view,
            render_pipeline,
            bind_group_layout,
            vertex_buffer,
            index_buffer,
            next_id:        0,
            transforms:     SparseSet::new(),
            mesh_renderers: SparseSet::new(),
            entity_gpus:    SparseSet::new(),
            camera:         Camera::default(),
            texture_bind_group_layout,
            sampler,
            default_tex,
            default_normal_tex,
            textures:  Vec::new(),
            materials: SparseSet::new(),
            rigid_bodies:  SparseSet::new(),
            colliders:     SparseSet::new(),
            input:         InputState::default(),
            player_entity: None,
            camera_yaw:    0.0,
            camera_pitch:  0.0,
            point_lights:      SparseSet::new(),
            directional_light: None,
            light_bind_group_layout,
            light_buffer,
            light_bind_group,
            shadow_depth_texture,
            shadow_depth_view,
            shadow_bind_group_layout,
            shadow_bind_group,
            shadow_pipeline,
            shadow_entity_layout,
            persistent_entities: HashSet::new(),
            texture_registry:    HashMap::new(),
        })
    }
}
#[wasm_bindgen]
impl World {
    // ── Entités ──────────────────────────────────────────────────────────────

    /// Crée une entité vide. Retourne son handle (usize).
    pub fn create_entity(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    // ── Transform ────────────────────────────────────────────────────────────

    /// Ajoute un composant Transform à l'entité (position initiale xyz).
    pub fn add_transform(&mut self, id: usize, x: f32, y: f32, z: f32) {
        let mut t = Transform::default();
        t.position = glam::Vec3::new(x, y, z);
        self.transforms.insert(id, t);
    }

    pub fn set_position(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.position = glam::Vec3::new(x, y, z);
        }
    }

    pub fn set_rotation(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.rotation = glam::Vec3::new(x, y, z);
        }
    }

    pub fn set_scale(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(t) = self.transforms.get_mut(id) {
            t.scale = glam::Vec3::new(x, y, z);
        }
    }

    // ── MeshRenderer ─────────────────────────────────────────────────────────

    /// Ajoute un MeshRenderer Cube + crée les ressources GPU associées.
    pub fn add_mesh_renderer(&mut self, id: usize) {
        self.mesh_renderers.insert(id, MeshRenderer { mesh_type: MeshType::Cube });

        let uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("entity_uniform"),
            size:               std::mem::size_of::<EntityUniforms>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("entity_bind_group"),
            layout:  &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shadow_uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("shadow_entity_uniform"),
            size:               64, // mat4x4<f32>
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let shadow_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("shadow_entity_bg"),
            layout:  &self.shadow_entity_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: shadow_uniform_buffer.as_entire_binding(),
            }],
        });

        self.entity_gpus.insert(id, EntityGpu {
            uniform_buffer, bind_group,
            shadow_uniform_buffer, shadow_bind_group,
        });
    }

    // ── Caméra ───────────────────────────────────────────────────────────────

    pub fn set_camera(&mut self, ex: f32, ey: f32, ez: f32, tx: f32, ty: f32, tz: f32) {
        self.camera.eye    = glam::Vec3::new(ex, ey, ez);
        self.camera.target = glam::Vec3::new(tx, ty, tz);
    }

    // ── Textures ──────────────────────────────────────────────────────────────

    /// Charge des pixels RGBA bruts en GPU. Retourne un TextureId (u32).
    /// Cote TS : passer un Uint8Array de taille width * height * 4.
    pub fn upload_texture(&mut self, width: u32, height: u32, data: &[u8], generate_mipmaps: bool) -> u32 {
        assert_eq!(
            data.len() as u64,
            4 * width as u64 * height as u64,
            "upload_texture: data length ({}) != width * height * 4 ({})",
            data.len(),
            4 * width as u64 * height as u64,
        );
        let tex = create_texture_from_data(&self.device, &self.queue, width, height, data, generate_mipmaps);
        let id = self.textures.len() as u32;
        self.textures.push(tex);
        id
    }

    /// Rétrocompatibilité Phase 1-5. Utilise add_pbr_material pour le PBR.
    pub fn add_material(&mut self, entity_id: usize, texture_id: u32) {
        self.materials.insert(entity_id, Material {
            albedo_tex: texture_id, 
            normal_tex: u32::MAX, 
            metallic: 0.0, 
            roughness: 0.5,
            emissive: glam::Vec3::ZERO,
        });
    }

    /// Associe un matériau PBR complet à l'entité.
    pub fn add_pbr_material(
        &mut self,
        entity_id: usize,
        albedo_tex: u32,
        metallic:   f32,
        roughness:  f32,
    ) {
        self.materials.insert(entity_id, Material {
            albedo_tex,
            normal_tex: u32::MAX,
            metallic,
            roughness,
            emissive: glam::Vec3::ZERO, // Par défaut, n'émet pas de lumière
        });
    }

    /// Rend un objet émissif (ex: ampoule, néon).
    /// r,g,b > 1.0 permet de faire du "bloom" si on avait du post-process,
    /// ici cela garantit juste une couleur très vive.
    pub fn set_emissive(&mut self, entity_id: usize, r: f32, g: f32, b: f32) {
        if let Some(mat) = self.materials.get_mut(entity_id) {
            mat.emissive = glam::Vec3::new(r, g, b);
        }
    }

    /// Applique une normal map à l'entité (doit avoir un Material).
    pub fn set_normal_map(&mut self, entity_id: usize, normal_tex_id: u32) {
        if let Some(mat) = self.materials.get_mut(entity_id) {
            mat.normal_tex = normal_tex_id;
        }
    }

    // ── Rendu ─────────────────────────────────────────────────────────────────

    pub fn render_frame(&self, _delta_ms: f32) {
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::OutOfMemory) => {
                web_sys::console::error_1(&"[World] GPU hors mémoire".into());
                return;
            }
            Err(_) => return,
        };

        let view   = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let aspect = self.config.width as f32 / self.config.height as f32;
        let view_mat = self.camera.view_matrix();
        let proj_mat = self.camera.proj_matrix(aspect);

        // ── Light space matrix ────────────────────────────────────────────────
        let light_dir = self.directional_light.as_ref()
            .map(|dl| dl.direction)
            .unwrap_or(glam::Vec3::new(0.0, -1.0, 0.0));
        let lsm = compute_light_space_mat(light_dir);

        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // ── Upload EntityUniforms (MVP + model + metallic + roughness) ────────
        for (id, transform) in self.transforms.iter() {
            if self.mesh_renderers.get(id).is_none() { continue; }
            let Some(gpu) = self.entity_gpus.get(id) else { continue };

            let model = Mat4::from_translation(transform.position)
                * Mat4::from_euler(
                    EulerRot::XYZ,
                    transform.rotation.x.to_radians(),
                    transform.rotation.y.to_radians(),
                    transform.rotation.z.to_radians(),
                )
                * Mat4::from_scale(transform.scale);
            let mvp = proj_mat * view_mat * model;

            let (metallic, roughness, emissive) = self.materials.get(id)
                .map(|m| (m.metallic, m.roughness, m.emissive))
                .unwrap_or((0.0, 0.5, glam::Vec3::ZERO));

            let uniforms = EntityUniforms {
                mvp:   mvp.to_cols_array_2d(),
                model: model.to_cols_array_2d(),
                metallic,
                roughness,
                _pad1:    [0.0; 2],
                scale:    [transform.scale.x, transform.scale.y, transform.scale.z, 0.0],
                emissive: emissive.to_array(),
                _pad2:    0.0,
            };
            self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

            // Upload shadow uniform : light_mvp = lsm * model
            let light_mvp = lsm * model;
            self.queue.write_buffer(
                &gpu.shadow_uniform_buffer, 0,
                bytemuck::cast_slice(light_mvp.as_ref()),
            );
        }

        // ── Upload LightUniforms ──────────────────────────────────────────────
        {
            let mut lu = <LightUniforms as bytemuck::Zeroable>::zeroed();
            lu.camera_pos = [self.camera.eye.x, self.camera.eye.y, self.camera.eye.z, 0.0];
            lu.light_space_mat = lsm.to_cols_array_2d();

            if let Some(dl) = &self.directional_light {
                let dir = dl.direction.normalize();
                lu.directional = GpuDirectionalLight {
                    direction: dir.to_array(), _p0: 0.0,
                    color: dl.color.to_array(), intensity: dl.intensity,
                };
            }

            let light_ids: Vec<usize> = self.point_lights.iter().map(|(id, _)| id).collect();
            let mut n = 0usize;
            for id in light_ids {
                if n >= 8 { break; }
                let (Some(pl), Some(tr)) = (self.point_lights.get(id), self.transforms.get(id)) else { continue };
                lu.points[n] = GpuPointLight {
                    position: tr.position.to_array(), _p0: 0.0,
                    color: pl.color.to_array(), intensity: pl.intensity,
                };
                n += 1;
            }
            lu.n_points = n as u32;
            self.queue.write_buffer(&self.light_buffer, 0, bytemuck::bytes_of(&lu));
        }

        // ── 1. Shadow pass (depth-only) ───────────────────────────────────────
        {
            let mut shadow_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shadow_pass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow_depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes:    None,
                occlusion_query_set: None,
                multiview_mask:      None,
            });

            shadow_pass.set_pipeline(&self.shadow_pipeline);
            shadow_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            shadow_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);

            for (id, _) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };
                shadow_pass.set_bind_group(0, &gpu.shadow_bind_group, &[]);
                shadow_pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        // ── 2. Main pass (PBR) ────────────────────────────────────────────────
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &view,
                    resolve_target: None,
                    depth_slice:    None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(wgpu::Color { r: 0.05, g: 0.05, b: 0.08, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes:    None,
                occlusion_query_set: None,
                multiview_mask:      None,
            });

            pass.set_pipeline(&self.render_pipeline);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);

            for (id, _) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };

                // Group 1 : albedo + normal bind group (créé à la volée)
                let (albedo_view, normal_view) = if let Some(mat) = self.materials.get(id) {
                    let av = if (mat.albedo_tex as usize) < self.textures.len() {
                        &self.textures[mat.albedo_tex as usize].view
                    } else {
                        &self.default_tex.view
                    };
                    let nv = if (mat.normal_tex as usize) < self.textures.len() {
                        &self.textures[mat.normal_tex as usize].view
                    } else {
                        &self.default_normal_tex.view
                    };
                    (av, nv)
                } else {
                    (&self.default_tex.view, &self.default_normal_tex.view)
                };

                let tex_bg = self.make_tex_bind_group(albedo_view, normal_view);

                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.set_bind_group(1, &tex_bg, &[]);
                pass.set_bind_group(2, &self.light_bind_group, &[]);
                pass.set_bind_group(3, &self.shadow_bind_group, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
    }
}

#[wasm_bindgen]
impl World {
    // ── Physique ─────────────────────────────────────────────────────────────

    /// Désigne l'entité joueur. La caméra FPS la suivra automatiquement.
    pub fn set_player(&mut self, id: usize) {
        self.player_entity = Some(id);
    }

    /// Ajoute un RigidBody. `is_static = true` pour les entités fixes (sol, murs).
    pub fn add_rigid_body(&mut self, id: usize, is_static: bool) {
        self.rigid_bodies.insert(id, RigidBody { is_static, ..RigidBody::default() });
    }

    /// Ajoute un Collider AABB (demi-extents en mètres). Centre = Transform.position.
    pub fn add_collider_aabb(&mut self, id: usize, hx: f32, hy: f32, hz: f32) {
        self.colliders.insert(id, Collider {
            half_extents: glam::Vec3::new(hx, hy, hz),
        });
    }

    // ── Input ────────────────────────────────────────────────────────────────

    /// Transmet l'état input du frame courant.
    /// `keys` bitmask : bit0=W, bit1=S, bit2=A, bit3=D, bit4=SPACE.
    /// `mouse_dx/dy` : delta pixels depuis le dernier frame (Pointer Lock).
    pub fn set_input(&mut self, keys: u32, mouse_dx: f32, mouse_dy: f32) {
        self.input.keys     = keys;
        self.input.mouse_dx = mouse_dx;
        self.input.mouse_dy = mouse_dy;
    }

    /// Met à jour la physique et la caméra FPS. Appeler avant render_frame().
    pub fn update(&mut self, delta_ms: f32) {
        let dt = (delta_ms / 1000.0_f32).min(0.05); // cap 50 ms anti-spiral

        const GRAVITY:   f32 = 9.8;
        const SPEED:     f32 = 5.0;
        const JUMP_VEL:  f32 = 5.0;
        const MOUSE_SEN: f32 = 0.002; // radians/pixel

        // ── 1. Rotation caméra ───────────────────────────────────────────────
        self.camera_yaw   += self.input.mouse_dx * MOUSE_SEN;
        self.camera_pitch -= self.input.mouse_dy * MOUSE_SEN;
        self.camera_pitch  = self.camera_pitch
            .clamp(-89.0_f32.to_radians(), 89.0_f32.to_radians());

        let yaw        = self.camera_yaw;
        let forward_xz = glam::Vec3::new(yaw.sin(), 0.0, -yaw.cos());
        let right_xz   = glam::Vec3::new(yaw.cos(), 0.0,  yaw.sin());
        let keys       = self.input.keys;

        // ── 2. Gravité + input → velocity ────────────────────────────────────
        // Collecte des IDs dynamiques (évite double-borrow sur self.rigid_bodies)
        let dynamic_ids: Vec<usize> = self.rigid_bodies
            .iter()
            .filter(|(_, rb)| !rb.is_static)
            .map(|(id, _)| id)
            .collect();

        for &id in &dynamic_ids {
            let Some(rb) = self.rigid_bodies.get_mut(id) else { continue };

            // Gravité (toutes entités dynamiques)
            // Le saut écrase velocity.y par une valeur absolue → l'ordre est sans impact.
            rb.velocity.y -= GRAVITY * dt;

            // Input WASD + saut : uniquement pour l'entité joueur désignée
            if self.player_entity == Some(id) {
                // WASD → XZ (ré-écrit chaque frame pour un contrôle net sans glissance)
                let mut move_dir = glam::Vec3::ZERO;
                if keys & (1 << 0) != 0 { move_dir += forward_xz; }
                if keys & (1 << 1) != 0 { move_dir -= forward_xz; }
                if keys & (1 << 2) != 0 { move_dir -= right_xz;   }
                if keys & (1 << 3) != 0 { move_dir += right_xz;   }

                if move_dir.length_squared() > 0.0 {
                    let d = move_dir.normalize();
                    rb.velocity.x = d.x * SPEED;
                    rb.velocity.z = d.z * SPEED;
                } else {
                    rb.velocity.x = 0.0;
                    rb.velocity.z = 0.0;
                }

                // Saut (on lit on_ground avant de le remettre à false)
                if keys & (1 << 4) != 0 && rb.on_ground {
                    rb.velocity.y = JUMP_VEL;
                }
            }

            // Reset on_ground — rétabli par AABB si collision sol détectée
            rb.on_ground = false;
        }

        // ── 3. Intégration Euler ─────────────────────────────────────────────
        for &id in &dynamic_ids {
            let vel = match self.rigid_bodies.get(id) {
                Some(rb) => rb.velocity,
                None     => continue,
            };
            if let Some(tr) = self.transforms.get_mut(id) {
                tr.position += vel * dt;
            }
        }

        // ── 4. Résolution AABB ───────────────────────────────────────────────
        let static_ids: Vec<usize> = self.rigid_bodies
            .iter()
            .filter(|(_, rb)| rb.is_static)
            .map(|(id, _)| id)
            .collect();

        for &dyn_id in &dynamic_ids {
            for &sta_id in &static_ids {
                // Extraire positions + half_extents (Vec3 est Copy → pas de borrow actif)
                let (dyn_pos, dyn_he) = match (
                    self.transforms.get(dyn_id),
                    self.colliders.get(dyn_id),
                ) {
                    (Some(tr), Some(co)) => (tr.position, co.half_extents),
                    _ => continue,
                };

                let (sta_pos, sta_he) = match (
                    self.transforms.get(sta_id),
                    self.colliders.get(sta_id),
                ) {
                    (Some(tr), Some(co)) => (tr.position, co.half_extents),
                    _ => continue,
                };

                let Some(mtv) = aabb_mtv(dyn_pos, dyn_he, sta_pos, sta_he) else { continue };

                // Corriger position (soustraire le MTV)
                if let Some(tr) = self.transforms.get_mut(dyn_id) {
                    tr.position -= mtv;
                }

                // Annuler la composante velocity + détecter on_ground
                if let Some(rb) = self.rigid_bodies.get_mut(dyn_id) {
                    if mtv.x.abs() > 0.0 { rb.velocity.x = 0.0; }
                    if mtv.z.abs() > 0.0 { rb.velocity.z = 0.0; }
                    if mtv.y.abs() > 0.0 {
                        // mtv.y < 0 : soustraire une valeur négative → position.y augmente
                        // → l'entité statique est en dessous → on_ground
                        if mtv.y < 0.0 { rb.on_ground = true; }
                        rb.velocity.y = 0.0;
                    }
                }
            }
        }

        // ── 5. Caméra FPS ────────────────────────────────────────────────────
        if let Some(pid) = self.player_entity {
            if let Some(tr) = self.transforms.get(pid) {
                let eye   = tr.position + glam::Vec3::new(0.0, 1.6, 0.0);
                let pitch = self.camera_pitch;
                // Magnitude est 1 par construction ; .normalize() protège contre l'arrondi f32 à pitch extrême.
                let fwd   = glam::Vec3::new(
                    pitch.cos() * yaw.sin(),
                    pitch.sin(),
                    -pitch.cos() * yaw.cos(),
                ).normalize();
                self.camera.eye    = eye;
                self.camera.target = eye + fwd;
            }
        }
    }
}

#[wasm_bindgen]
impl World {
    // ── Éclairage ────────────────────────────────────────────────────────────

    /// Ajoute une point light attachée à l'entité (doit avoir un Transform).
    /// Couleur (r, g, b) entre 0.0 et 1.0, intensity en lux (ex: 5.0–20.0).
    pub fn add_point_light(&mut self, id: usize, r: f32, g: f32, b: f32, intensity: f32) {
        self.point_lights.insert(id, PointLight {
            color:     glam::Vec3::new(r, g, b),
            intensity,
        });
    }

    /// Définit la lumière directionnelle (soleil). Un seul appel suffit.
    /// direction (dx, dy, dz) : vecteur vers lequel la lumière pointe (normalisé automatiquement).
    pub fn add_directional_light(
        &mut self,
        dx: f32, dy: f32, dz: f32,
        r: f32, g: f32, b: f32,
        intensity: f32,
    ) {
        self.directional_light = Some(DirectionalLightData {
            direction: glam::Vec3::new(dx, dy, dz),
            color:     glam::Vec3::new(r, g, b),
            intensity,
        });
    }
}

#[wasm_bindgen]
impl World {
    // ── Scènes ───────────────────────────────────────────────────────────────

    /// Enregistre un TextureId GPU sous un nom string.
    /// Appeler avant load_scene() pour que les textures nommées soient résolvables.
    pub fn register_texture(&mut self, name: String, texture_id: u32) {
        self.texture_registry.insert(name, texture_id);
    }

    /// Marque (ou démarque) une entité comme persistante.
    /// Les entités persistantes survivent aux appels à load_scene().
    pub fn set_persistent(&mut self, id: usize, persistent: bool) {
        if persistent {
            self.persistent_entities.insert(id);
        } else {
            self.persistent_entities.remove(&id);
        }
    }

    /// Charge une scène depuis un JSON string.
    /// Supprime les entités non-persistantes, puis crée les entités du JSON.
    /// Retourne un Uint32Array des IDs des nouvelles entités créées.
    pub fn load_scene(&mut self, json: &str) -> js_sys::Uint32Array {
        let scene: SceneData = match serde_json::from_str(json) {
            Ok(s)  => s,
            Err(e) => {
                web_sys::console::error_1(&format!("[load_scene] JSON invalide: {e}").into());
                return js_sys::Uint32Array::new_with_length(0);
            }
        };

        self.clear_scene();

        // Lumière directionnelle
        if let Some(dl) = scene.directional_light {
            self.directional_light = Some(DirectionalLightData {
                direction: glam::Vec3::from(dl.direction),
                color:     glam::Vec3::from(dl.color),
                intensity: dl.intensity,
            });
        }

        // Créer les entités
        let mut new_ids: Vec<u32> = Vec::new();

        for entity_data in scene.entities {
            let id = self.create_entity();
            new_ids.push(id as u32);

            if let Some(t) = entity_data.transform {
                let mut tr = Transform::default();
                tr.position = glam::Vec3::from(t.position);
                tr.rotation = glam::Vec3::from(t.rotation);
                tr.scale    = glam::Vec3::from(t.scale);
                self.transforms.insert(id, tr);
            }

            if entity_data.mesh_renderer == Some(true) {
                self.add_mesh_renderer(id);
            }

            if let Some(mat) = entity_data.material {
                let tex_id = self.texture_registry
                    .get(&mat.texture)
                    .copied()
                    .unwrap_or_else(|| {
                        web_sys::console::warn_1(
                            &format!("[load_scene] texture '{}' non enregistrée", mat.texture).into()
                        );
                        u32::MAX
                    });
                let normal_id = if mat.normal_texture.is_empty() {
                    u32::MAX
                } else {
                    self.texture_registry.get(&mat.normal_texture).copied().unwrap_or(u32::MAX)
                };
                self.materials.insert(id, Material {
                    albedo_tex: tex_id,
                    normal_tex: normal_id,
                    metallic:   mat.metallic,
                    roughness:  mat.roughness,
                    emissive:   glam::Vec3::ZERO,
                });
            }

            if let Some(rb) = entity_data.rigid_body {
                self.rigid_bodies.insert(id, RigidBody { is_static: rb.is_static, ..RigidBody::default() });
            }

            if let Some(he) = entity_data.collider_aabb {
                self.colliders.insert(id, Collider {
                    half_extents: glam::Vec3::from(he),
                });
            }

            if let Some(pl) = entity_data.point_light {
                self.point_lights.insert(id, PointLight {
                    color:     glam::Vec3::from(pl.color),
                    intensity: pl.intensity,
                });
            }
        }

        js_sys::Uint32Array::from(new_ids.as_slice())
    }

    /// Sérialise la scène courante (toutes les entités) en JSON string.
    pub fn save_scene(&self) -> String {
        use scene::{SceneEntityData, SceneData};

        let directional_light = self.directional_light.as_ref().map(|dl| SceneDirectionalLight {
            direction: dl.direction.to_array(),
            color:     dl.color.to_array(),
            intensity: dl.intensity,
        });

        // Collecter tous les IDs d'entités uniques
        let all_ids: HashSet<usize> = self.transforms.iter().map(|(id, _)| id)
            .chain(self.mesh_renderers.iter().map(|(id, _)| id))
            .chain(self.materials.iter().map(|(id, _)| id))
            .chain(self.rigid_bodies.iter().map(|(id, _)| id))
            .chain(self.colliders.iter().map(|(id, _)| id))
            .chain(self.point_lights.iter().map(|(id, _)| id))
            .collect();

        // Trouver le nom de texture inverse (TextureId → nom)
        let id_to_name: HashMap<u32, String> = self.texture_registry
            .iter()
            .map(|(name, &id)| (id, name.clone()))
            .collect();

        let mut entities: Vec<SceneEntityData> = Vec::new();
        let mut sorted_ids: Vec<usize> = all_ids.into_iter().collect();
        sorted_ids.sort();

        for id in sorted_ids {
            let transform = self.transforms.get(id).map(|t| SceneTransform {
                position: t.position.to_array(),
                rotation: t.rotation.to_array(),
                scale:    t.scale.to_array(),
            });
            let mesh_renderer = if self.mesh_renderers.get(id).is_some() { Some(true) } else { None };
            let material = self.materials.get(id).map(|m| SceneMaterial {
                texture:        id_to_name.get(&m.albedo_tex).cloned().unwrap_or_default(),
                normal_texture: id_to_name.get(&m.normal_tex).cloned().unwrap_or_default(),
                metallic:       m.metallic,
                roughness:      m.roughness,
            });
            let rigid_body = self.rigid_bodies.get(id).map(|rb| SceneRigidBody {
                is_static: rb.is_static,
            });
            let collider_aabb = self.colliders.get(id).map(|c| c.half_extents.to_array());
            let point_light = self.point_lights.get(id).map(|pl| ScenePointLight {
                color:     pl.color.to_array(),
                intensity: pl.intensity,
            });

            entities.push(SceneEntityData {
                transform, mesh_renderer, material, rigid_body, collider_aabb, point_light,
            });
        }

        let scene = SceneData { directional_light, entities };
        serde_json::to_string_pretty(&scene).unwrap_or_default()
    }
}

impl World {
    fn make_tex_bind_group(
        &self,
        albedo_view: &wgpu::TextureView,
        normal_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("tex_bg"),
            layout:  &self.texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(albedo_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(normal_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        })
    }
}

impl World {
    /// Supprime tous les composants des entités non-persistantes.
    /// Les entités persistantes et la texture_registry sont conservées.
    /// La directional_light est réinitialisée.
    fn clear_scene(&mut self) {
        // Collecter tous les IDs présents dans n'importe quel SparseSet
        let all_ids: HashSet<usize> = self.transforms.iter().map(|(id, _)| id)
            .chain(self.mesh_renderers.iter().map(|(id, _)| id))
            .chain(self.materials.iter().map(|(id, _)| id))
            .chain(self.rigid_bodies.iter().map(|(id, _)| id))
            .chain(self.colliders.iter().map(|(id, _)| id))
            .chain(self.point_lights.iter().map(|(id, _)| id))
            .filter(|id| !self.persistent_entities.contains(id))
            .collect();

        for id in all_ids {
            self.transforms.remove(id);
            self.mesh_renderers.remove(id);
            self.entity_gpus.remove(id);
            self.materials.remove(id);
            self.rigid_bodies.remove(id);
            self.colliders.remove(id);
            self.point_lights.remove(id);
        }

        self.directional_light = None;
    }
}
