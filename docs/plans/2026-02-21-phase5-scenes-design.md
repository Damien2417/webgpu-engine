# Phase 5 — Scènes + Sérialisation : Design Document

**Date :** 2026-02-21
**Objectif :** Workflow data-driven (scènes JSON) + switch de scène in-game avec entités persistantes.

---

## Contexte et motivations

Arrêter de hardcoder la création d'entités (cubes, lumières, transforms) en TypeScript. Charger un monde complet depuis un fichier JSON. Permettre de vider la scène courante pour en charger une nouvelle en cours de jeu (ex: menu → niveau 1 → niveau 2). L'API de sérialisation Rust (via serde) doit être symétrique (save/load) et agnostique pour préparer l'éditeur Phase 7.

---

## Décisions architecturales

### IDs stables lors du reset partiel

**Approche retenue : compteur monotone + cleanup SparseSet.**

Le compteur `next_id` existant ne fait qu'incrémenter — les IDs ne sont jamais réassignés. `clear_scene()` supprime les composants des entités non-persistantes de tous les SparseSets. Les entités persistantes conservent leurs IDs intacts par construction. Pas de nouvelle dépendance, pas de changement d'API publique.

### Textures : registre nommé

Les scènes JSON référencent les textures par nom string. TypeScript enregistre les `TextureId` GPU sous ces noms avant `load_scene()`. Le chargement des images reste en TS, la scène reste pure data.

### Reset partiel : entités persistantes

`world.set_persistent(id, true)` — l'entité (typiquement le joueur) survit aux `load_scene()`. Les nouvelles entités chargées depuis le JSON reçoivent des IDs >= `next_id` courant, sans conflit.

### Pas de SceneManager Rust

Le switch de scène se gère en TS : `fetch()` du JSON → `world.load_scene(json_string)`. Pas de couche inutile en Rust.

---

## Format JSON de scène

```json
{
  "directional_light": {
    "direction": [-0.5, -1.0, -0.3],
    "color": [1.0, 0.95, 0.8],
    "intensity": 1.2
  },
  "entities": [
    {
      "transform": { "position": [0, -0.5, 0], "rotation": [0, 0, 0], "scale": [20, 1, 20] },
      "mesh_renderer": true,
      "material": { "texture": "floor_checker" },
      "rigid_body": { "is_static": true },
      "collider_aabb": [10, 0.5, 10]
    },
    {
      "transform": { "position": [4, 2.5, 4], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "point_light": { "color": [0.3, 0.8, 1.0], "intensity": 10.0 }
    }
  ]
}
```

**Règles :**
- `directional_light` — optionnel ; absent = pas de lumière directionnelle
- `transform` — obligatoire si l'entité a mesh_renderer, point_light, rigid_body ou collider_aabb
- `mesh_renderer: true` — booléen (un seul mesh type pour l'instant : Cube)
- `material.texture` — nom string résolu via `texture_registry` ; absent = texture blanche
- `rigid_body.is_static` — seul champ persisté (velocity et on_ground réinitialisés au chargement)
- `collider_aabb` — tableau `[hx, hy, hz]`
- `point_light.color` — tableau `[r, g, b]`

---

## Nouveaux champs World

```rust
persistent_entities: HashSet<usize>,        // IDs marqués persistants
texture_registry:    HashMap<String, u32>,  // nom → TextureId GPU
```

## API wasm_bindgen

```typescript
// Registre de textures nommées (appeler avant load_scene)
world.register_texture(name: string, texture_id: number): void

// Marquer une entité comme persistante (survit aux load_scene)
world.set_persistent(id: number, persistent: boolean): void

// Charger une scène depuis un JSON string — retourne les IDs créés
world.load_scene(json: string): Uint32Array

// Sauvegarder la scène courante en JSON string
world.save_scene(): string
```

## Workflow TS typique

```typescript
// 1. Upload textures une seule fois
const floorTex = world.upload_texture(w, h, data);
world.register_texture("floor_checker", floorTex);

// 2. Créer le joueur persistant
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.3, 0.9, 0.3);
world.set_player(player);
world.set_persistent(player, true);

// 3. Charger une scène
const json = await fetch("scenes/level1.json").then(r => r.text());
world.load_scene(json);

// 4. Plus tard, changer de scène
const json2 = await fetch("scenes/level2.json").then(r => r.text());
world.load_scene(json2);  // joueur conservé, reste remplacé
```

## Dépendances Rust

```toml
serde      = { version = "1", features = ["derive"] }
serde_json = { version = "1", default-features = false, features = ["alloc"] }
```

`default-features = false` + `features = ["alloc"]` = compatible WASM sans `std::io`.

---

## Ce qui n'est PAS dans cette phase

- SceneManager nommé côté Rust (géré en TS via fetch)
- Chargement async de textures depuis URL dans Rust
- Scènes imbriquées ou prefabs
- Validation JSON (erreurs → panic avec message console)
