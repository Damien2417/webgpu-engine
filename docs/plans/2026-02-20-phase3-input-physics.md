# Phase 3 — Input + Physique AABB Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter input clavier/souris FPS et physique AABB pour produire une mini-démo jouable (WASD + souris + saut + collisions).

**Architecture:** Monolithic World — `RigidBody` + `Collider` dans `components.rs`, SparseSets dans `World`, `update(delta_ms)` exécute le pipeline physique complet (gravité → input → Euler → AABB → caméra FPS). La caméra suit automatiquement l'entité `player_entity` en Rust.

**Tech Stack:** Rust/WASM (wgpu 28, glam 0.29, wasm-bindgen 0.2), wasm-pack --target web, TypeScript/Vite, Pointer Lock API.

---

### Notes préliminaires

- **Pas de `cargo test`** — crate wasm-only (`#![cfg(target_arch = "wasm32")]`). Vérification = `cargo check --target wasm32-unknown-unknown`.
- **Commits engine-core séparés** du root repo (`engine-core/` est un git submodule).
- **SparseSet API** : `iter()` → `(usize, &T)` (id copié), `get(id: usize)`, `get_mut(id: usize)`.
- **Vec3 est Copy** dans glam — on peut copier hors des borrows.
- **Convention MTV** dans `aabb_mtv(A, B)` : vecteur à soustraire de A pour sortir de B. Si `mtv.y < 0` : A est poussé vers le haut → `on_ground = true`.

---

### Task 1 : Ajouter RigidBody + Collider dans components.rs

**Files:**
- Modify: `engine-core/src/ecs/components.rs`
- Modify: `engine-core/src/ecs/mod.rs`

**Step 1 : Ajouter les types à la fin de components.rs**

Ouvrir `engine-core/src/ecs/components.rs` et ajouter après la définition de `Material` :

```rust
// ── RigidBody ───────────────────────────────────────────────────────────────

pub struct RigidBody {
    pub velocity:  Vec3,
    pub is_static: bool,   // true = entité fixe (sol, murs) — pas d'intégration
    pub on_ground: bool,   // mis à jour par PhysicsSystem chaque frame
}

impl Default for RigidBody {
    fn default() -> Self {
        RigidBody { velocity: Vec3::ZERO, is_static: false, on_ground: false }
    }
}

// ── Collider AABB ───────────────────────────────────────────────────────────

pub struct Collider {
    pub half_extents: Vec3,  // demi-dimensions ; centre = Transform.position
}
```

**Step 2 : Exporter depuis ecs/mod.rs**

Remplacer la ligne `pub use components::{...}` dans `engine-core/src/ecs/mod.rs` par :

```rust
pub use components::{Collider, Material, MeshRenderer, MeshType, RigidBody, Transform};
```

**Step 3 : Vérifier**

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`

**Step 4 : Commit**

```bash
cd engine-core && git add src/ecs/components.rs src/ecs/mod.rs
git commit -m "feat(ecs): add RigidBody + Collider AABB components"
```

---

### Task 2 : Ajouter InputState + champs physique dans World

**Files:**
- Modify: `engine-core/src/lib.rs`

**Step 1 : Ajouter l'import des nouveaux types**

Ligne 8, remplacer :
```rust
use ecs::{Material, MeshRenderer, MeshType, SparseSet, Transform};
```
par :
```rust
use ecs::{Collider, Material, MeshRenderer, MeshType, RigidBody, SparseSet, Transform};
```

**Step 2 : Ajouter struct InputState** (non-pub, après `TextureGpu` vers ligne 27)

```rust
#[derive(Default)]
struct InputState {
    keys:     u32,
    mouse_dx: f32,
    mouse_dy: f32,
}
```

**Step 3 : Ajouter les champs dans World** (après `materials: SparseSet<Material>`)

```rust
    // Physique
    rigid_bodies:  SparseSet<RigidBody>,
    colliders:     SparseSet<Collider>,

    // Input + caméra FPS
    input:          InputState,
    player_entity:  Option<usize>,
    camera_yaw:     f32,   // radians — rotation horizontale
    camera_pitch:   f32,   // radians — rotation verticale, clampé ±89°
```

**Step 4 : Initialiser dans `World::new()`** (dans le `Ok(World { ... })`, après `materials: SparseSet::new()`)

```rust
            rigid_bodies:  SparseSet::new(),
            colliders:     SparseSet::new(),
            input:         InputState::default(),
            player_entity: None,
            camera_yaw:    0.0,
            camera_pitch:  0.0,
```

**Step 5 : Vérifier**

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`

**Step 6 : Commit**

```bash
cd engine-core && git add src/lib.rs
git commit -m "feat(world): add RigidBody/Collider SparseSets + InputState + FPS camera fields"
```

---

### Task 3 : Exposer les méthodes API wasm_bindgen

**Files:**
- Modify: `engine-core/src/lib.rs`

**Step 1 : Ajouter un nouveau bloc `impl World` à la fin de lib.rs**

```rust
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
}
```

**Step 2 : Vérifier**

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`

**Step 3 : Commit**

```bash
cd engine-core && git add src/lib.rs
git commit -m "feat(api): expose set_player, add_rigid_body, add_collider_aabb, set_input"
```

---

### Task 4 : Implémenter World::update() — gravité + input + Euler

**Files:**
- Modify: `engine-core/src/lib.rs`

**Step 1 : Ajouter la fonction helper `aabb_mtv` avant le premier `#[wasm_bindgen] impl World`**

```rust
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

    // Axe de pénétration minimale — MTV à soustraire de A pour sortir de B
    // Convention : sign = opposé à diff (B est de ce côté → on pousse A dans l'autre)
    if ox < oy && ox < oz {
        Some(glam::Vec3::new(if diff.x > 0.0 { ox } else { -ox }, 0.0, 0.0))
    } else if oy < oz {
        Some(glam::Vec3::new(0.0, if diff.y > 0.0 { oy } else { -oy }, 0.0))
    } else {
        Some(glam::Vec3::new(0.0, 0.0, if diff.z > 0.0 { oz } else { -oz }))
    }
}
```

**Step 2 : Ajouter `update()` dans le bloc de la Task 3**

```rust
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

            // Gravité
            rb.velocity.y -= GRAVITY * dt;

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
        // (implémenté dans Task 5 — placeholder)

        // ── 5. Caméra FPS ────────────────────────────────────────────────────
        if let Some(pid) = self.player_entity {
            if let Some(tr) = self.transforms.get(pid) {
                let eye   = tr.position + glam::Vec3::new(0.0, 1.6, 0.0);
                let pitch = self.camera_pitch;
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
```

**Step 3 : Vérifier**

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`

**Step 4 : Commit**

```bash
cd engine-core && git add src/lib.rs
git commit -m "feat(physics): gravity + WASD input + Euler integration in World::update"
```

---

### Task 5 : Résolution de collisions AABB

**Files:**
- Modify: `engine-core/src/lib.rs`

**Step 1 : Remplacer le commentaire placeholder** `// ── 4. Résolution AABB ─── (placeholder)` par le code suivant :

```rust
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
                        // mtv.y < 0 : on a soustrait une valeur négative → position.y a augmenté
                        // → l'entité statique est en dessous → on_ground
                        if mtv.y < 0.0 { rb.on_ground = true; }
                        rb.velocity.y = 0.0;
                    }
                }
            }
        }
```

**Step 2 : Vérifier**

```bash
cd engine-core && cargo check --target wasm32-unknown-unknown 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`

**Step 3 : Build WASM complet**

```bash
cd engine-core && wasm-pack build --target web 2>&1 | tail -5
```

Expected: `[INFO]: Your wasm pkg is ready to publish at ...`

**Step 4 : Commit**

```bash
cd engine-core && git add src/lib.rs
git commit -m "feat(physics): AABB collision resolution with MTV + on_ground detection"
```

---

### Task 6 : Réécrire main.ts — démo FPS jouable

**Files:**
- Modify: `game-app/src/main.ts`

**Step 1 : Remplacer tout le contenu de main.ts**

```typescript
import init, { World } from '../../engine-core/pkg/engine_core.js';

await init();

// ── Canvas + WebGPU ───────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// ── Constantes input ──────────────────────────────────────────────────────
const KEY_W     = 1 << 0;
const KEY_S     = 1 << 1;
const KEY_A     = 1 << 2;
const KEY_D     = 1 << 3;
const KEY_SPACE = 1 << 4;

// ── Générateur de texture damier ──────────────────────────────────────────
function makeChecker(
  world: World,
  size: number,
  c1: [number, number, number],
  c2: [number, number, number]
): number {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = (x + y) % 2 === 0 ? c1 : c2;
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return world.upload_texture(size, size, data);
}

const floorTex = makeChecker(world, 8, [180, 180, 180], [60, 60, 60]);
const boxTex   = makeChecker(world, 4, [220, 120,  60], [140, 60, 20]);

// ── Scène ─────────────────────────────────────────────────────────────────

// Sol invisible (collider seul)
const floor = world.create_entity();
world.add_transform(floor, 0, -0.5, 0);
world.add_rigid_body(floor, true);
world.add_collider_aabb(floor, 10, 0.5, 10);

// Sol visible (cube plat décoratif, pas de physique)
const floorMesh = world.create_entity();
world.add_transform(floorMesh, 0, -0.5, 0);
world.set_scale(floorMesh, 20, 1, 20);
world.add_mesh_renderer(floorMesh);
world.add_material(floorMesh, floorTex);

// Cubes obstacles statiques
const obstacles: [number, number, number][] = [
  [ 3, 0.5,  3], [-3, 0.5,  3],
  [ 3, 0.5, -3], [-3, 0.5, -3],
  [ 6, 0.5,  0], [-6, 0.5,  0],
  [ 0, 0.5,  6], [ 0, 0.5, -6],
];
for (const [x, y, z] of obstacles) {
  const box = world.create_entity();
  world.add_transform(box, x, y, z);
  world.add_mesh_renderer(box);
  world.add_material(box, boxTex);
  world.add_rigid_body(box, true);
  world.add_collider_aabb(box, 0.5, 0.5, 0.5);
}

// Joueur (dynamique, sans MeshRenderer — vue FPS)
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);   // démarre en hauteur, tombe sur le sol
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.3, 0.9, 0.3);
world.set_player(player);

// ── Input ─────────────────────────────────────────────────────────────────
let keysMask   = 0;
let mouseDxAcc = 0;
let mouseDyAcc = 0;

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW':  keysMask |= KEY_W;     break;
    case 'KeyS':  keysMask |= KEY_S;     break;
    case 'KeyA':  keysMask |= KEY_A;     break;
    case 'KeyD':  keysMask |= KEY_D;     break;
    case 'Space': keysMask |= KEY_SPACE; e.preventDefault(); break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW':  keysMask &= ~KEY_W;     break;
    case 'KeyS':  keysMask &= ~KEY_S;     break;
    case 'KeyA':  keysMask &= ~KEY_A;     break;
    case 'KeyD':  keysMask &= ~KEY_D;     break;
    case 'Space': keysMask &= ~KEY_SPACE; break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    mouseDxAcc += e.movementX;
    mouseDyAcc += e.movementY;
  }
});

// Pointer Lock au clic sur le canvas
canvas.addEventListener('click', () => canvas.requestPointerLock());

// Overlay "Cliquer pour jouer"
const overlay = document.createElement('div');
overlay.textContent = 'Cliquer pour jouer — WASD + Souris + ESPACE (saut)';
overlay.style.cssText = [
  'position:fixed', 'inset:0', 'display:flex',
  'align-items:center', 'justify-content:center',
  'color:white', 'font:bold 20px sans-serif',
  'background:rgba(0,0,0,.55)', 'pointer-events:none',
].join(';');
document.body.appendChild(overlay);

document.addEventListener('pointerlockchange', () => {
  overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
});

// ── Boucle de jeu ─────────────────────────────────────────────────────────
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  world.set_input(keysMask, mouseDxAcc, mouseDyAcc);
  mouseDxAcc = 0;
  mouseDyAcc = 0;

  world.update(delta);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
```

**Step 2 : Build WASM**

```bash
cd engine-core && wasm-pack build --target web 2>&1 | tail -5
```

Expected: `[INFO]: Your wasm pkg is ready to publish at ...`

**Step 3 : Vérifier TypeScript**

```bash
cd game-app && npm run build 2>&1 | tail -10
```

Expected: `built in Xs` sans erreur TypeScript

**Step 4 : Tester dans le browser**

```bash
cd game-app && npm run dev
```

Ouvrir Chrome/Edge 113+, naviguer vers `http://localhost:5173`. Critères de succès :
- [ ] Clic → souris capturée (Pointer Lock actif, overlay disparu)
- [ ] WASD → le joueur se déplace dans la scène
- [ ] Souris → regard FPS (yaw + pitch)
- [ ] ESPACE → saut — le joueur revient sur le sol
- [ ] Les cubes oranges sont visibles et bloquent le déplacement (on ne les traverse pas)
- [ ] Le joueur ne tombe pas à travers le sol

**Step 5 : Commit**

```bash
# Root repo (main.ts modifié, pas dans le submodule)
cd /e/Programmation/webgpu-engine
git add game-app/src/main.ts
git commit -m "feat(demo): FPS demo — WASD + mouse look + jump + AABB collisions"
```

---

### Task 7 : Commits finaux + mise à jour MEMORY.md

**Step 1 : Commit root repo (submodule + main.ts)**

```bash
cd /e/Programmation/webgpu-engine
git add engine-core game-app/src/main.ts
git commit -m "feat: Phase 3 — Input + Physique AABB (FPS demo jouable)"
```

**Step 2 : Mettre à jour MEMORY.md**

Ouvrir `C:/Users/damie/.claude/projects/E--Programmation-webgpu-engine/memory/MEMORY.md`.

- Section `## État actuel` : remplacer "Phase 2 complète" par "Phase 3 complète — FPS demo jouable"
- Ajouter à `## API TS` : `set_player(id)`, `add_rigid_body(id, is_static)`, `add_collider_aabb(id, hx, hy, hz)`, `set_input(keys, dx, dy)`, `update(delta)`
- Section `## Pièges connus` : ajouter note sur la convention MTV
- Section `## Prochaine phase` : Phase 4 — Éclairage Phong

**Step 3 : Vérifier l'état git final**

```bash
cd /e/Programmation/webgpu-engine && git log --oneline -8
```

Expected : les commits Phase 3 sont visibles, submodule à jour.
