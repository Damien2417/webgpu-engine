#![cfg(target_arch = "wasm32")]

mod camera;
mod ecs;
mod mesh;

use camera::Camera;
use ecs::{Collider, Material, MeshRenderer, MeshType, PointLight, RigidBody, SparseSet, Transform};
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES};

use bytemuck;
use glam::{EulerRot, Mat4};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

struct EntityGpu {
    uniform_buffer: wgpu::Buffer,
    bind_group:     wgpu::BindGroup,
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
    texture:    wgpu::Texture,
    view:       wgpu::TextureView,
    bind_group: wgpu::BindGroup,
}



// ── Types GPU pour l'éclairage ────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct EntityUniforms {
    mvp:   [[f32; 4]; 4],
    model: [[f32; 4]; 4],
}

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
    camera_pos:  [f32; 4],             // offset   0 — xyz utilisé, w=0
    directional: GpuDirectionalLight,  // offset  16 — 32 bytes
    n_points:    u32,                  // offset  48
    _pad:        [u32; 3],             // offset  52 — alignement array<PointLight,8> sur 16
    points:      [GpuPointLight; 8],   // offset  64 — 8 × 32 = 256 bytes
}
// Total : 320 bytes

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
    #[allow(dead_code)]
    sampler:                   wgpu::Sampler,
    default_tex:               TextureGpu,
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
    device:  &wgpu::Device,
    queue:   &wgpu::Queue,
    width:   u32,
    height:  u32,
    data:    &[u8],
    layout:  &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
) -> TextureGpu {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("tex"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count:    1,
        dimension:       wgpu::TextureDimension::D2,
        format:          wgpu::TextureFormat::Rgba8UnormSrgb,
        usage:           wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats:    &[],
    });

    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture:   &texture,
            mip_level: 0,
            origin:    wgpu::Origin3d::ZERO,
            aspect:    wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset:         0,
            bytes_per_row:  Some(4 * width),
            rows_per_image: None,
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );

    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label:   Some("tex_bind_group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding:  0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding:  1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    });

    TextureGpu { texture, view, bind_group }
}

/// Calcule le MTV pour séparer A de B (à soustraire de la position de A).
/// Retourne None si pas de chevauchement.
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
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        // Texture bind group layout (Group 1) : texture + sampler
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
            ],
        });

        // Sampler partage (linear, clamp-to-edge)
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter:     wgpu::FilterMode::Linear,
            min_filter:     wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Texture blanche 1x1 par defaut
        let default_tex = create_texture_from_data(
            &device, &queue, 1, 1,
            &[255u8, 255, 255, 255],
            &texture_bind_group_layout, &sampler,
        );

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

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout, &texture_bind_group_layout, &light_bind_group_layout],
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

        self.entity_gpus.insert(id, EntityGpu { uniform_buffer, bind_group });
    }

    // ── Caméra ───────────────────────────────────────────────────────────────

    pub fn set_camera(&mut self, ex: f32, ey: f32, ez: f32, tx: f32, ty: f32, tz: f32) {
        self.camera.eye    = glam::Vec3::new(ex, ey, ez);
        self.camera.target = glam::Vec3::new(tx, ty, tz);
    }

    // ── Textures ──────────────────────────────────────────────────────────────

    /// Charge des pixels RGBA bruts en GPU. Retourne un TextureId (u32).
    /// Cote TS : passer un Uint8Array de taille width * height * 4.
    pub fn upload_texture(&mut self, width: u32, height: u32, data: &[u8]) -> u32 {
        assert_eq!(
            data.len() as u64,
            4 * width as u64 * height as u64,
            "upload_texture: data length ({}) != width * height * 4 ({})",
            data.len(),
            4 * width as u64 * height as u64,
        );
        let tex = create_texture_from_data(
            &self.device, &self.queue,
            width, height, data,
            &self.texture_bind_group_layout, &self.sampler,
        );
        let id = self.textures.len() as u32;
        self.textures.push(tex);
        id
    }

    /// Associe une texture a une entite (doit avoir un MeshRenderer).
    pub fn add_material(&mut self, entity_id: usize, texture_id: u32) {
        self.materials.insert(entity_id, Material { texture_id });
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

        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // Upload EntityUniforms (MVP + Model) pour chaque entité avec Transform + MeshRenderer
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

            let uniforms = EntityUniforms {
                mvp:   mvp.to_cols_array_2d(),
                model: model.to_cols_array_2d(),
            };
            self.queue.write_buffer(&gpu.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        }

        // ── Upload LightUniforms (Group 2) ───────────────────────────────────
        {
            let mut lu = <LightUniforms as bytemuck::Zeroable>::zeroed();
            lu.camera_pos = [
                self.camera.eye.x, self.camera.eye.y, self.camera.eye.z, 0.0,
            ];

            if let Some(dl) = &self.directional_light {
                let dir = dl.direction.normalize();
                lu.directional = GpuDirectionalLight {
                    direction: dir.to_array(),
                    _p0: 0.0,
                    color: dl.color.to_array(),
                    intensity: dl.intensity,
                };
            }

            let mut n = 0usize;
            let light_ids: Vec<usize> = self.point_lights
                .iter()
                .map(|(id, _)| id)
                .collect();
            for id in light_ids {
                if n >= 8 { break; }
                let (Some(pl), Some(tr)) = (self.point_lights.get(id), self.transforms.get(id)) else { continue };
                lu.points[n] = GpuPointLight {
                    position:  tr.position.to_array(),
                    _p0: 0.0,
                    color:     pl.color.to_array(),
                    intensity: pl.intensity,
                };
                n += 1;
            }
            lu.n_points = n as u32;

            self.queue.write_buffer(&self.light_buffer, 0, bytemuck::bytes_of(&lu));
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &view,
                    resolve_target: None,
                    depth_slice:    None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.05, g: 0.05, b: 0.08, a: 1.0,
                        }),
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

            // Draw call par entité : bind group 0 (MVP) + bind group 1 (texture)
            for (id, _renderer) in self.mesh_renderers.iter() {
                let Some(gpu) = self.entity_gpus.get(id) else { continue };

                // Sélectionner la texture : Material si présent, sinon blanc par défaut
                let tex_bg = if let Some(mat) = self.materials.get(id) {
                    let tex_idx = mat.texture_id as usize;
                    if tex_idx < self.textures.len() {
                        &self.textures[tex_idx].bind_group
                    } else {
                        &self.default_tex.bind_group
                    }
                } else {
                    &self.default_tex.bind_group
                };

                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.set_bind_group(1, tex_bg, &[]);
                pass.set_bind_group(2, &self.light_bind_group, &[]);
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
