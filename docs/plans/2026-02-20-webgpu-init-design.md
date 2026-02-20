# Design : Initialisation WebGPU depuis Rust/WASM

**Date** : 2026-02-20
**Statut** : Approuvé
**Scope** : Étape 2 — Init GPU + premier rendu (clear color)

---

## Contexte

Le projet est un moteur de jeu 3D web hybride :
- **engine-core** : Rust compilé en WASM via `wasm-pack`
- **game-app** : TypeScript / Vite qui importe le WASM

L'étape précédente (Hello World console.log) valide le pont WASM. Cette étape initialise WebGPU depuis Rust et affiche un premier frame (clear color).

---

## Décisions d'architecture

### 1. Init async : static method → JS Promise

`Engine::init(canvas)` est une méthode statique async en Rust. wasm-bindgen la convertit automatiquement en JS Promise.

```typescript
const engine = await Engine.init(canvas);
```

Rejeté : two-step `new Engine()` + `await engine.init()` car ça impose des champs `Option<>` partout et un état invalide intermédiaire.

### 2. Boucle RAF : TypeScript

TypeScript gère `requestAnimationFrame` et appelle `engine.render_frame()` à chaque tick. Plus flexible (pause, debug UI), un seul aller-retour WASM par frame.

### 3. Scope du premier rendu

Clear color uniquement (bleu sombre `0.1, 0.2, 0.3`). Pas de géométrie, pas de shaders. Objectif : valider la pipeline complète Instance→Surface→Adapter→Device→RenderPass→Present.

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `engine-core/Cargo.toml` | +`wgpu@23`, `wasm-bindgen-futures`, `js-sys`, +features `HtmlCanvasElement` |
| `engine-core/src/lib.rs` | Réécriture : Engine struct GPU + init async + render_frame |
| `game-app/index.html` | `<div id="app">` → `<canvas id="game-canvas" width="800" height="600">` |
| `game-app/vite.config.ts` | Nouveau : `vite-plugin-wasm` + `vite-plugin-top-level-await` |
| `game-app/package.json` | +`vite-plugin-wasm@^3`, `vite-plugin-top-level-await@^1` |
| `game-app/src/main.ts` | Réécriture : import WASM, `Engine.init(canvas)`, RAF loop |

---

## Architecture détaillée

### Engine struct (Rust)

```rust
pub struct Engine {
    device:  wgpu::Device,
    queue:   wgpu::Queue,
    surface: wgpu::Surface<'static>,  // 'static OK : canvas owned by wgpu
    config:  wgpu::SurfaceConfiguration,
}
```

### Séquence d'init

```
Engine::init(canvas: HtmlCanvasElement) -> Result<Engine, JsValue>
  1. wgpu::Instance (backends: BROWSER_WEBGPU)
  2. instance.create_surface(SurfaceTarget::Canvas(canvas))
  3. instance.request_adapter(compatible_surface).await
  4. adapter.request_device(...).await
  5. surface.get_capabilities(&adapter) → format
  6. surface.configure(&device, &config)
  7. return Ok(Engine { device, queue, surface, config })
```

### Séquence render_frame

```
engine.render_frame()
  1. surface.get_current_texture()
  2. texture.create_view()
  3. device.create_command_encoder()
  4. encoder.begin_render_pass(clear color: 0.1, 0.2, 0.3, 1.0)
  5. drop render pass (finalise les commandes)
  6. queue.submit([encoder.finish()])
  7. output.present()
```

### TypeScript (main.ts)

```typescript
await init();                          // charge le .wasm
const engine = await Engine.init(canvas);
function loop() {
  engine.render_frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

---

## Dépendances Rust

```toml
[dependencies]
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["console", "HtmlCanvasElement"] }

[dependencies.wgpu]
version = "23"
default-features = false
features = ["webgpu", "wgsl"]
```

**Pourquoi `default-features = false`** : évite d'embarquer Vulkan/Metal/DX12 dans le WASM. Réduit drastiquement la taille du binaire.

---

## Points techniques à surveiller

1. **`Surface<'static>`** : garanti car `SurfaceTarget::Canvas(canvas)` prend le canvas par valeur — wgpu en prend ownership.
2. **`wasm-bindgen` + async** : une fonction `pub async fn` annotée `#[wasm_bindgen]` est automatiquement wrappée en JS Promise. Pas besoin de `JsFuture` ou `future_to_promise` manuel.
3. **Vite + WASM** : `vite-plugin-wasm` est nécessaire pour que Vite comprenne l'import du `.wasm`. Sans lui, Vite refuse les modules WASM non-inlinés.
4. **`wasm-pack build --target web`** : doit être relancé après chaque modification Rust avant `npm run dev`.
