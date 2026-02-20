#![cfg(target_arch = "wasm32")]

mod camera;
mod mesh;
mod scene;

use camera::Camera;
use mesh::{Vertex, CUBE_INDICES, CUBE_VERTICES};
use scene::Entity;

use bytemuck;
use glam::{EulerRot, Mat4, Vec3};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

// ─── Ressources GPU par entité ───────────────────────────────────────────────

/// Chaque entité possède son propre uniform buffer + bind group.
/// Cela permet de rendre N entités en un seul render pass avec des MVP distincts.
struct EntityGpu {
    uniform_buffer: wgpu::Buffer,
    bind_group:     wgpu::BindGroup,
}

// ─── Engine ──────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct Engine {
    // GPU core
    device:  wgpu::Device,
    queue:   wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config:  wgpu::SurfaceConfiguration,

    // Profondeur (requis pour l'occlusion correcte des faces 3D)
    depth_texture: wgpu::Texture,
    depth_view:    wgpu::TextureView,

    // Pipeline de rendu (shader compilé + vertex layout + depth state)
    render_pipeline:   wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout, // conservé pour create_cube()

    // Géométrie partagée (cube hardcodé, identique pour toutes les entités)
    vertex_buffer: wgpu::Buffer,
    index_buffer:  wgpu::Buffer,

    // Scène : données logiques + ressources GPU (indices parallèles)
    entities:   Vec<Entity>,
    entity_gpu: Vec<EntityGpu>,

    // Caméra
    camera: Camera,
}

// ─── Helper : créer la depth texture ─────────────────────────────────────────

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

// ─── wasm_bindgen API ─────────────────────────────────────────────────────────

#[wasm_bindgen]
impl Engine {
    /// Initialise WebGPU, compile les shaders et crée toute la pipeline.
    /// Retourne une JS Promise via wasm-bindgen.
    pub async fn init(canvas: HtmlCanvasElement) -> Result<Engine, JsValue> {
        console_error_panic_hook::set_once();

        // 1. Instance (backend navigateur uniquement)
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        // 2. Surface depuis le canvas
        let width  = canvas.width();
        let height = canvas.height();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // 3. Adapter
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::default(),
                compatible_surface:     Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;

        // 4. Device + Queue
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // 5. Configuration de la surface
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

        // 6. Depth texture
        let (depth_texture, depth_view) = create_depth_texture(&device, &config);

        // 7. Shader (embarqué à la compilation via include_str!)
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        // 8. Bind group layout : un uniform buffer (MVP matrix) par entité
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

        // 9. Pipeline layout + render pipeline
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:              Some("pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
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

        // 10. Vertex + index buffers (géométrie cube partagée)
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

        web_sys::console::log_1(&"[Engine] Pipeline 3D initialisée".into());

        Ok(Engine {
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
            entities:   Vec::new(),
            entity_gpu: Vec::new(),
            camera:     Camera::default(),
        })
    }
}

#[wasm_bindgen]
impl Engine {
    // ── Scène ────────────────────────────────────────────────────────────────

    /// Crée un cube dans la scène. Retourne son handle (index dans Vec<Entity>).
    pub fn create_cube(&mut self) -> usize {
        let id = self.entities.len();
        self.entities.push(Entity::new_cube());

        // Créer un uniform buffer dédié à cette entité
        let uniform_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("entity_uniform"),
            size:               std::mem::size_of::<Mat4>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Bind group pour associer ce buffer au shader
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("entity_bind_group"),
            layout:  &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        self.entity_gpu.push(EntityGpu { uniform_buffer, bind_group });
        id
    }

    /// Modifie la position d'une entité (aucun effet si id invalide).
    pub fn set_position(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(e) = self.entities.get_mut(id) {
            e.position = Vec3::new(x, y, z);
        }
    }

    /// Modifie la rotation d'une entité en degrés Euler (XYZ).
    pub fn set_rotation(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(e) = self.entities.get_mut(id) {
            e.rotation = Vec3::new(x, y, z);
        }
    }

    /// Modifie l'échelle d'une entité.
    pub fn set_scale(&mut self, id: usize, x: f32, y: f32, z: f32) {
        if let Some(e) = self.entities.get_mut(id) {
            e.scale = Vec3::new(x, y, z);
        }
    }

    // ── Caméra ───────────────────────────────────────────────────────────────

    /// Positionne la caméra (eye = position, target = point visé).
    pub fn set_camera(&mut self, ex: f32, ey: f32, ez: f32, tx: f32, ty: f32, tz: f32) {
        self.camera.eye    = Vec3::new(ex, ey, ez);
        self.camera.target = Vec3::new(tx, ty, tz);
    }

    // ── Rendu ─────────────────────────────────────────────────────────────────

    /// Rendu d'un frame. delta_ms = temps écoulé depuis le frame précédent (ms).
    /// Appelé par TypeScript à chaque requestAnimationFrame.
    pub fn render_frame(&self, _delta_ms: f32) {
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::OutOfMemory) => {
                web_sys::console::error_1(&"[Engine] GPU hors mémoire".into());
                return;
            }
            Err(_) => return, // Lost/Outdated/Timeout — skip ce frame
        };

        let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let aspect = self.config.width as f32 / self.config.height as f32;

        // Matrices partagées par toutes les entités de ce frame
        let view_mat = self.camera.view_matrix();
        let proj_mat = self.camera.proj_matrix(aspect);

        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // Calculer et uploader les MVP de toutes les entités avant d'ouvrir le render pass
        for (i, entity) in self.entities.iter().enumerate() {
            let model = Mat4::from_translation(entity.position)
                * Mat4::from_euler(
                    EulerRot::XYZ,
                    entity.rotation.x.to_radians(),
                    entity.rotation.y.to_radians(),
                    entity.rotation.z.to_radians(),
                )
                * Mat4::from_scale(entity.scale);

            let mvp = proj_mat * view_mat * model;
            self.queue.write_buffer(
                &self.entity_gpu[i].uniform_buffer,
                0,
                bytemuck::bytes_of(&mvp),
            );
        }

        // Render pass unique avec clear color + depth clear
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

            // Un draw call par entité avec son propre bind group (MVP unique)
            for gpu in &self.entity_gpu {
                pass.set_bind_group(0, &gpu.bind_group, &[]);
                pass.draw_indexed(0..36, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
    }
}
