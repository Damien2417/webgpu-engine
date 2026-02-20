# WebGPU Initialization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Initialiser WebGPU depuis Rust/WASM et afficher un premier frame (clear color bleu) dans un canvas HTML, avec la boucle RAF gérée par TypeScript.

**Architecture:** `Engine::init(canvas)` est une méthode statique async Rust exposée via wasm-bindgen comme JS Promise. TypeScript attend la Promise puis appelle `engine.render_frame()` à chaque tick `requestAnimationFrame`. wgpu (backend `BROWSER_WEBGPU`) gère Instance → Surface → Adapter → Device → RenderPass → Present.

**Tech Stack:** Rust 2024 edition, wgpu 22 (webgpu feature), wasm-bindgen 0.2, wasm-bindgen-futures 0.4, wasm-pack --target web, TypeScript, Vite 7, vite-plugin-wasm, vite-plugin-top-level-await.

**Design doc :** `docs/plans/2026-02-20-webgpu-init-design.md`

---

## Prérequis

Avant de commencer, vérifier que ces outils sont installés :

```bash
rustup target list --installed | grep wasm32-unknown-unknown
# Si absent : rustup target add wasm32-unknown-unknown

wasm-pack --version
# Si absent : cargo install wasm-pack
```

---

## Task 1 : Mettre à jour `engine-core/Cargo.toml`

**Files:**
- Modify: `engine-core/Cargo.toml`

### Step 1 : Remplacer le contenu de Cargo.toml

```toml
[package]
name = "engine-core"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
js-sys = "0.3"

web-sys = { version = "0.3", features = [
    "console",
    "HtmlCanvasElement",
] }

[dependencies.wgpu]
version = "22"
default-features = false
features = [
    "webgpu",
    "wgsl",
]
```

**Pourquoi `default-features = false`** : évite d'embarquer Vulkan/Metal/DX12 dans le binaire WASM. Sans ça, le binaire serait énorme et ne compilerait probablement pas pour wasm32.

### Step 2 : Vérifier la résolution des dépendances

```bash
cd engine-core
cargo fetch
```

Attendu : téléchargement de wgpu et ses dépendances (peut être long la première fois, ~50+ crates). Pas d'erreur.

### Step 3 : Vérification rapide du typage (sans compiler WASM)

```bash
cargo check --target wasm32-unknown-unknown
```

Attendu à ce stade : erreurs de compilation dans `lib.rs` car le code utilise encore `web_sys::console` uniquement. **C'est normal** — on va réécrire lib.rs à la prochaine tâche.

---

## Task 2 : Scaffold de la struct `Engine` (version stub qui compile)

**Files:**
- Modify: `engine-core/src/lib.rs`

**Objectif :** Écrire le squelette complet avec les bons types wgpu, mais avec des implémentations `todo!()` temporaires. Valider que les imports et la struct compilent avant d'implémenter la logique.

### Step 1 : Réécrire `engine-core/src/lib.rs` avec le scaffold

```rust
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
    pub async fn init(_canvas: HtmlCanvasElement) -> Result<Engine, JsValue> {
        todo!("impl Engine::init")
    }

    pub fn render_frame(&self) {
        todo!("impl Engine::render_frame")
    }
}
```

### Step 2 : Vérifier que le scaffold compile

```bash
cd engine-core
cargo check --target wasm32-unknown-unknown
```

Attendu : **succès** (0 erreur). Les `todo!()` sont du code Rust valide. Si des erreurs apparaissent sur les types wgpu, vérifier que les features `"webgpu"` et `"wgsl"` sont bien dans Cargo.toml.

---

## Task 3 : Implémenter `Engine::init`

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Remplacer le stub `init` par l'implémentation complète

Remplacer uniquement la fonction `init` dans `impl Engine` :

```rust
pub async fn init(canvas: HtmlCanvasElement) -> Result<Engine, JsValue> {
    // 1. Créer l'instance WebGPU (backend navigateur uniquement)
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..Default::default()
    });

    // 2. Créer la surface depuis le canvas HTML
    //    SurfaceTarget::Canvas prend ownership du canvas → surface 'static
    let width  = canvas.width();
    let height = canvas.height();
    let surface = instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // 3. Demander un adapter compatible avec notre surface (async)
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference:       wgpu::PowerPreference::default(),
            compatible_surface:     Some(&surface),
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| JsValue::from_str("Aucun adapter WebGPU disponible. Vérifier que WebGPU est activé dans le navigateur."))?;

    // 4. Demander le device et la queue (async)
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default(), None)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // 5. Choisir le format de surface et configurer
    let surface_caps = surface.get_capabilities(&adapter);
    let format = surface_caps
        .formats
        .first()
        .copied()
        .ok_or_else(|| JsValue::from_str("Aucun format de surface supporté"))?;

    let config = wgpu::SurfaceConfiguration {
        usage:                          wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width,
        height,
        present_mode:                   wgpu::PresentMode::Fifo,
        alpha_mode:                     surface_caps.alpha_modes[0],
        view_formats:                   vec![],
        desired_maximum_frame_latency:  2,
    };
    surface.configure(&device, &config);

    Ok(Engine { device, queue, surface, config })
}
```

### Step 2 : Vérifier la compilation

```bash
cd engine-core
cargo check --target wasm32-unknown-unknown
```

Attendu : **succès**. Si erreur `desired_maximum_frame_latency` n'existe pas → la version de wgpu dans Cargo.lock est < 0.19 ; forcer `version = ">=0.19"` dans Cargo.toml.

---

## Task 4 : Implémenter `Engine::render_frame`

**Files:**
- Modify: `engine-core/src/lib.rs`

### Step 1 : Remplacer le stub `render_frame` par l'implémentation

Remplacer uniquement la fonction `render_frame` dans `impl Engine` :

```rust
pub fn render_frame(&self) {
    // Acquérir la texture courante de la surface (le "backbuffer")
    let output = match self.surface.get_current_texture() {
        Ok(t) => t,
        Err(_) => return, // surface perdue (resize, etc.) — on skip ce frame
    };

    let view = output
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    // Créer l'encodeur de commandes GPU pour ce frame
    let mut encoder = self.device.create_command_encoder(
        &wgpu::CommandEncoderDescriptor { label: Some("render_encoder") }
    );

    // Ouvrir un render pass avec clear color (bleu sombre)
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
    } // _pass droppé ici → les commandes du render pass sont finalisées

    // Soumettre les commandes au GPU
    self.queue.submit(std::iter::once(encoder.finish()));

    // Présenter le frame (swap du backbuffer)
    output.present();
}
```

### Step 2 : Build WASM complet

```bash
cd engine-core
wasm-pack build --target web
```

Attendu : dossier `engine-core/pkg/` généré avec :
- `engine_core.js`
- `engine_core_bg.wasm`
- `engine_core.d.ts`
- `package.json`

Si erreur de compilation : lire attentivement le message. Les erreurs wgpu/WASM sont souvent des features manquantes ou des types non-Send.

### Step 3 : Commit du code Rust

```bash
cd ..
git add engine-core/Cargo.toml engine-core/Cargo.lock engine-core/src/lib.rs
git commit -m "feat(engine-core): WebGPU init + clear color render via wgpu"
```

---

## Task 5 : Configurer Vite pour les imports WASM

**Files:**
- Modify: `game-app/package.json`
- Create: `game-app/vite.config.ts`

### Step 1 : Installer les plugins Vite

```bash
cd game-app
npm install --save-dev vite-plugin-wasm vite-plugin-top-level-await
```

Attendu : packages ajoutés dans `node_modules/`, `package.json` mis à jour.

### Step 2 : Créer `game-app/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
  ],
});
```

**Pourquoi ces deux plugins :**
- `vite-plugin-wasm` : transforme les imports `.wasm` en modules ES valides (Vite par défaut ne sait pas les gérer)
- `vite-plugin-top-level-await` : permet `await` au niveau module (nécessaire pour `await init()` et `await Engine.init()` directement dans main.ts)

### Step 3 : Commit config Vite

```bash
cd game-app
git add vite.config.ts package.json package-lock.json
git commit -m "feat(game-app): configure Vite for WASM imports"
```

---

## Task 6 : Mettre à jour `index.html`

**Files:**
- Modify: `game-app/index.html`

### Step 1 : Remplacer `<div id="app">` par un canvas

Remplacer le contenu du `<body>` :

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebGPU Engine</title>
    <style>
      body { margin: 0; background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <canvas id="game-canvas" width="800" height="600"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Note :** `width` et `height` sur le `<canvas>` définissent la résolution interne (pixels GPU). Ce sont ces valeurs qui seront lues par `canvas.width()` et `canvas.height()` en Rust dans `Engine::init`.

---

## Task 7 : Réécrire `game-app/src/main.ts`

**Files:**
- Modify: `game-app/src/main.ts`

### Step 1 : Supprimer les fichiers inutiles du template Vite

```bash
cd game-app
# Supprimer les fichiers du template Vite par défaut (optionnel mais propre)
rm -f src/counter.ts src/typescript.svg src/style.css
```

### Step 2 : Réécrire `main.ts`

```typescript
import init, { Engine } from '../../engine-core/pkg/engine_core.js';

// 1. Charger et initialiser le module WASM (fetch + instantiate le .wasm)
await init();

// 2. Récupérer le canvas du DOM
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #game-canvas introuvable dans le DOM');
}

// 3. Initialiser le moteur GPU depuis Rust (async → JS Promise)
//    Si WebGPU n'est pas supporté, Engine.init() rejette la Promise avec un message d'erreur
const engine: Engine = await Engine.init(canvas);

// 4. Boucle de rendu pilotée par TypeScript
function loop(): void {
  engine.render_frame();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
```

**Import path expliqué :**
- `../../engine-core/pkg/engine_core.js` : chemin relatif depuis `game-app/src/` vers le dossier `pkg/` généré par wasm-pack
- Le fichier `engine_core.js` (snake_case) correspond au crate nommé `engine-core` (kebab → snake)
- `init` (export default) : charge le binaire `.wasm`
- `Engine` (export nommé) : la struct Rust exposée via `#[wasm_bindgen]`

### Step 3 : Commit du frontend

```bash
cd ..
git add game-app/index.html game-app/src/main.ts
git commit -m "feat(game-app): WASM import + WebGPU canvas + RAF loop"
```

---

## Task 8 : Test d'intégration complet

**Objectif :** Vérifier que le canvas affiche un écran bleu uni.

### Step 1 : (Re)build le WASM si lib.rs a changé

```bash
cd engine-core
wasm-pack build --target web
cd ..
```

Attendu : `engine-core/pkg/` régénéré sans erreur.

### Step 2 : Lancer le dev server Vite

```bash
cd game-app
npm run dev
```

Attendu : output similaire à :
```
  VITE v7.x.x  ready in XXX ms
  ➜  Local:   http://localhost:5173/
```

### Step 3 : Vérification visuelle dans le navigateur

1. Ouvrir `http://localhost:5173/` dans Chrome ou Edge (Firefox n'a pas encore WebGPU stable)
2. Vérifier que le canvas affiche un **rectangle bleu sombre** (couleur `0.1, 0.2, 0.3`)
3. Ouvrir la console DevTools — aucune erreur ne devrait apparaître

### Step 4 : Debugging si écran noir ou erreur

**Erreur "WebGPU not supported"** → utiliser Chrome 113+ ou Edge 113+. Activer `chrome://flags/#enable-unsafe-webgpu` si nécessaire.

**Erreur "Cannot find module '../../engine-core/pkg/engine_core.js'"** → vérifier que `wasm-pack build --target web` a bien été lancé et que `engine-core/pkg/` existe.

**Erreur MIME type sur `.wasm`** → `vite-plugin-wasm` n'est pas actif. Vérifier `vite.config.ts` et `npm install`.

**Canvas noir (pas d'erreur)** → ouvrir DevTools → onglet "Application" → "GPU" pour voir si WebGPU est actif. Ou ajouter `console.log("Engine initialisé", engine)` dans main.ts avant la boucle.

### Step 5 : Commit final de validation

```bash
git add .
git commit -m "feat: WebGPU clear color render opérationnel (Rust/WASM + TypeScript)"
```

---

## Rappel : workflow de développement

Après toute modification Rust, toujours re-builder le WASM avant de tester :

```bash
# Terminal 1 (une seule fois au démarrage) :
cd game-app && npm run dev

# Terminal 2 (après chaque modif Rust) :
cd engine-core && wasm-pack build --target web
# Vite HMR ne détecte pas automatiquement les changements du pkg/ → rafraîchir le navigateur manuellement
```
