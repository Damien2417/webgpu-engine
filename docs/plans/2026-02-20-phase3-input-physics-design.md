# Phase 3 — Input + Physique AABB : Design Document

**Date :** 2026-02-20
**Objectif :** Ajouter input clavier/souris et physique AABB pour produire une mini-démo FPS jouable.
**Approche retenue :** Monolithic World (tout dans `lib.rs` + composants dans `components.rs`).

---

## Nouveaux composants ECS

**`engine-core/src/ecs/components.rs`** :

```rust
pub struct RigidBody {
    pub velocity:  Vec3,
    pub is_static: bool,   // true = sol/murs (pas d'intégration)
    pub on_ground: bool,   // mis à jour par PhysicsSystem chaque frame
}

pub struct Collider {
    pub half_extents: Vec3,  // AABB centré sur Transform.position
}
```

`World` ajoute deux SparseSets :
- `rigid_bodies: SparseSet<RigidBody>`
- `colliders: SparseSet<Collider>`

---

## InputState

```rust
struct InputState {
    keys:     u32,   // bitmask : bit0=W, bit1=S, bit2=A, bit3=D, bit4=SPACE
    mouse_dx: f32,
    mouse_dy: f32,
}
```

Constantes TS (simples entiers, pas de wasm_bindgen nécessaire) :
```typescript
const KEY_W     = 1 << 0;
const KEY_S     = 1 << 1;
const KEY_A     = 1 << 2;
const KEY_D     = 1 << 3;
const KEY_SPACE = 1 << 4;
```

---

## PhysicsSystem — World::update(delta_ms)

Exécution séquentielle :

1. **Gravité** — `rb.velocity.y -= 9.8 * delta_s` pour tous RigidBody non-statiques
2. **Input → velocity XZ** — lit `camera_yaw`, transforme WASD en direction locale, speed = 5 m/s
3. **Saut** — si `SPACE && on_ground` : `rb.velocity.y = 5.0`
4. **Intégration Euler** — `transform.position += rb.velocity * delta_s`
5. **Résolution AABB** — pour chaque paire (dynamique, statique) :
   - Test overlap sur les 3 axes
   - MTV (Minimum Translation Vector) = axe de pénétration minimale
   - Correction position + annulation de la composante velocity sur cet axe
   - Si MTV est l'axe Y et correction vers le haut → `on_ground = true`
6. **Mise à jour caméra** — `camera.eye = player.position + (0, 1.6, 0)`, `camera.target = eye + forward(yaw, pitch)`

---

## Caméra FPS ECS-driven

- `World` stocke `player_entity: usize` (défini via `set_player(id)`)
- `camera_yaw: f32` et `camera_pitch: f32` (clampé à ±89°) accumulés dans World
- Après résolution physique, la caméra se recalcule automatiquement
- `set_camera()` reste disponible mais non appelé depuis TS en mode FPS

---

## API TypeScript (après Phase 3)

```typescript
// Nouveaux appels disponibles :
world.set_player(entity_id);
world.add_rigid_body(entity_id, is_static);        // is_static: boolean
world.add_collider_aabb(entity_id, hx, hy, hz);   // half_extents

// Boucle de jeu :
world.set_input(keysMask, mouseDx, mouseDy);
world.update(delta_ms);
world.render_frame(delta_ms);
```

---

## Démo FPS (game-app/src/main.ts)

**Scène :**
- Sol plat : entité statique, AABB 10×0.5×10, texture damier
- 8 cubes obstacles disposés en arène (statiques, avec MeshRenderer + Collider)
- Joueur : entité dynamique, démarre à (0, 2, 0), RigidBody + Collider (0.3, 0.9, 0.3)

**Contrôles TS :**
- `keydown`/`keyup` → bitmask
- `mousemove` → accumule dx/dy (reset chaque frame après `set_input`)
- Pointer Lock API : clic sur canvas → souris capturée

**Séquence boucle TS :**
```typescript
world.set_input(keysMask, accMouseDx, accMouseDy);
accMouseDx = 0; accMouseDy = 0;
world.update(delta);
world.render_frame(delta);
```

---

## Fichiers à modifier / créer

| Fichier | Action |
|---------|--------|
| `engine-core/src/ecs/components.rs` | Ajouter `RigidBody`, `Collider` |
| `engine-core/src/lib.rs` | Ajouter `InputState`, `player_entity`, `camera_yaw/pitch`, SparseSets, `set_input()`, `update()`, `set_player()`, `add_rigid_body()`, `add_collider_aabb()` |
| `game-app/src/main.ts` | Réécrire pour démo FPS (Pointer Lock, input, scène arène) |

---

## Critères de succès

- Le joueur peut marcher (WASD), regarder (souris), sauter (SPACE)
- Le joueur ne traverse pas le sol ni les cubes obstacles
- La gravité ramène le joueur au sol après un saut
- FPS stable à 60 Hz dans Chrome/Edge 113+
