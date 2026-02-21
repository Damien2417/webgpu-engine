# engine-core

Core du moteur 3D en Rust + WebGPU, compile en WebAssembly (`wasm32`) et expose une API simple via `wasm-bindgen`.

## Ce que contient le moteur

- rendu 3D WebGPU (pipeline + depth buffer)
- ECS minimal base sur `SparseSet`
- entites avec `Transform` + `MeshRenderer` (cube)
- materials/textures (`upload_texture`, `add_material`)
- physique simple:
  - `RigidBody` dynamique/statique
  - collisions AABB
  - resolution par MTV
  - `on_ground` + saut
- camera FPS pilotee par input clavier/souris

## Structure

- `src/lib.rs`: initialisation GPU, ECS runtime, update + render, API WASM
- `src/ecs/*`: composants et conteneur `SparseSet`
- `src/mesh.rs`: vertex layout + mesh cube
- `src/camera.rs`: matrices vue/projection
- `src/shader.wgsl`: shader du pipeline

## Prerequis

- Rust stable
- target `wasm32-unknown-unknown`
- `wasm-pack` (recommande pour generer le package JS/WASM)
- navigateur avec WebGPU active

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
wasm-pack build --target web
```

Le build genere le package dans `pkg/`.

## Usage rapide (cote app web)

Exemple JS minimal (dans le projet qui consomme `engine-core`):

```ts
import init, { World } from "./pkg/engine_core.js";

await init();
const canvas = document.querySelector("canvas")!;
const world = await World.new(canvas);

const player = world.create_entity();
world.add_transform(player, 0, 2, 0);
world.add_mesh_renderer(player);
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.4, 0.9, 0.4);
world.set_player(player);

function frame(deltaMs: number) {
  world.update(deltaMs);
  world.render_frame(deltaMs);
  requestAnimationFrame((t) => frame(16.67));
}
requestAnimationFrame((t) => frame(16.67));
```

## API `World` (resume)

- Entites:
  - `create_entity()`
- Transform:
  - `add_transform(id, x, y, z)`
  - `set_position(id, x, y, z)`
  - `set_rotation(id, x, y, z)`
  - `set_scale(id, x, y, z)`
- Rendu/mesh:
  - `add_mesh_renderer(id)`
  - `render_frame(delta_ms)`
- Camera:
  - `set_camera(ex, ey, ez, tx, ty, tz)`
- Textures/materials:
  - `upload_texture(width, height, data)`
  - `add_material(entity_id, texture_id)`
- Physique/input/game loop:
  - `set_player(id)`
  - `add_rigid_body(id, is_static)`
  - `add_collider_aabb(id, hx, hy, hz)`
  - `set_input(keys, mouse_dx, mouse_dy)`
  - `update(delta_ms)`

## Input bitmask

`set_input(keys, mouse_dx, mouse_dy)` utilise:

- bit 0: `W`
- bit 1: `S`
- bit 2: `A`
- bit 3: `D`
- bit 4: `SPACE`

## Notes

- Le crate est limite a `wasm32` (`#![cfg(target_arch = "wasm32")]`).
- Si WebGPU n'est pas disponible sur la machine cible, l'initialisation `World::new` peut echouer.
