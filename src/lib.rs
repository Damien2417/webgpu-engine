#![cfg(target_arch = "wasm32")]

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

#[wasm_bindgen]
pub struct Engine {
    device:  wgpu::Device,
    queue:   wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config:  wgpu::SurfaceConfiguration,
}

#[wasm_bindgen]
impl Engine {
    pub async fn init(canvas: HtmlCanvasElement) -> Result<Engine, JsValue> {
        console_error_panic_hook::set_once();

        // 1. Instance WebGPU (navigateur uniquement)
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        // 2. Surface depuis le canvas (SurfaceTarget::Canvas prend ownership → 'static)
        let width  = canvas.width();
        let height = canvas.height();
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // 3. Adapter compatible (async)
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference:       wgpu::PowerPreference::default(),
                compatible_surface:     Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| JsValue::from_str("Aucun adapter WebGPU disponible"))?;

        // 4. Device + Queue (async)
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
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
            usage:        wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode:   wgpu::CompositeAlphaMode::Opaque, // BROWSER_WEBGPU supporte toujours Opaque
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        web_sys::console::log_1(&"[Engine] WebGPU initialisé avec succès".into());

        Ok(Engine { device, queue, surface, config })
    }

    pub fn render_frame(&self) {
        // Acquérir la texture courante du backbuffer
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::OutOfMemory) => {
                web_sys::console::error_1(&"[Engine] GPU hors mémoire — arrêt du rendu".into());
                return;
            }
            Err(_) => return, // Lost/Outdated/Timeout — skip ce frame
        };

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        // Créer l'encodeur de commandes GPU pour ce frame
        let mut encoder = self.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
        );

        // Render pass avec clear color (bleu sombre)
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.2,
                            b: 0.3,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes:         None,
                occlusion_query_set:      None,
            });
        } // _pass droppé ici → commandes du render pass finalisées

        // Soumettre les commandes GPU
        self.queue.submit(std::iter::once(encoder.finish()));

        // Présenter le frame
        output.present();
    }
}
