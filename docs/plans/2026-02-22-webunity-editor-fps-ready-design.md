# WebUnity Editor — FPS Ready Design
**Date :** 2026-02-22
**Objectif :** Rendre l'éditeur WebUnity capable de builder et jouer une démo FPS complète (niveau jouable + scripting ennemis).

---

## Contexte

Le Phase 7 (editor de base) est complet :
- 4-panel layout (Viewport, SceneGraph, Inspector, AssetBrowser)
- Transform editing + translate gizmo
- Play/Stop mode
- Save/Load JSON scenes
- Asset browser (textures)
- Engine WebGPU avec PBR, physique partielle, lighting

**Ce qui manque pour builder un FPS :**
- Composants non exposés dans l'Inspector (Lights, Materials, Physics)
- Pas de bouton "Add Component" (modèle Unity)
- FPS Camera en play mode absente
- Capture input WASD + souris en play mode absente
- Mesh plan (sol) absent dans l'engine
- Scripting pour comportements custom (ennemis) absent

---

## Modèle de référence : Unity

Le modèle est celui de Unity :
- L'engine fournit des **composants built-in** (Rigidbody, Collider, Light, MeshRenderer, PlayerController)
- Le créateur **ajoute des composants** à ses entités via l'Inspector
- Les **comportements custom** (IA, logique de jeu) sont écrits via un **Script component** (JS)
- Aucun scripting requis pour les comportements standard (physique, rendu, lumières, FPS movement)

---

## Architecture cible

```
┌─────────────────────────────────────────────────────────────────────┐
│  EDITOR (React/TypeScript)                                          │
│                                                                     │
│  Inspector                                                          │
│  ├── TransformPanel       (existant)                                │
│  ├── MeshRendererPanel    (à créer) — type: Cube/Plane/Sphere       │
│  ├── MaterialPanel        (à créer) — texture, metallic, roughness  │
│  ├── RigidbodyPanel       (à créer) — static/dynamic, masse         │
│  ├── ColliderPanel        (à créer) — AABB half-extents             │
│  ├── LightPanel           (à créer) — type, couleur, intensité      │
│  ├── PlayerControllerPanel (à créer) — FOV, speed, mouse sensitivity│
│  └── ScriptPanel          (à créer) — code JS + lifecycle hooks     │
│                                                                     │
│  "Add Component" button → dropdown des composants disponibles       │
│                                                                     │
│  Viewport                                                           │
│  ├── Play mode → pointer lock + WASD capture → set_input()          │
│  └── FPS crosshair overlay pendant play mode                        │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ engineBridge.ts
┌─────────────────────────────────────────────────────────────────────┐
│  ENGINE-CORE (Rust/WASM)                                            │
│                                                                     │
│  Nouveaux features natifs :                                         │
│  ├── Plane mesh (sol, mur flat, plafond)                            │
│  ├── Gravity + réponse collision (RigidBody dynamic sur static)     │
│  └── FPS Camera (first-person si PlayerController présent)          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phases d'implémentation

### Phase A — Système de composants dans l'Inspector

**Principe :** Ajouter un bouton "Add Component" en bas de l'Inspector. Il ouvre un dropdown listant les composants disponibles. Chaque composant ajouté fait apparaître son panel.

**Composants à implémenter :**

#### A1 — MeshRendererPanel
- Sélecteur de type de mesh : **Cube** (existant) / **Plane** (à ajouter engine) / Sphere (futur)
- Déjà appelé implicitement à la création d'entité, mais le créateur doit pouvoir le configurer

#### A2 — MaterialPanel
- Champ texture : picker depuis les assets importés
- Sliders : Metallic (0.0 – 1.0), Roughness (0.0 – 1.0)
- Color picker : Emissive RGB
- Appelle : `add_pbr_material()`, `set_normal_map()`, `set_emissive()`

#### A3 — RigidbodyPanel
- Toggle : Static / Dynamic
- Champ masse (float)
- Appelle : `add_rigid_body(id, is_static)`

#### A4 — ColliderPanel (BoxCollider)
- Inputs X/Y/Z pour half-extents
- Appelle : `add_collider_aabb(id, hx, hy, hz)`

#### A5 — LightPanel
- Sélecteur type : Point Light / Directional Light
- Color picker RGB
- Slider Intensité
- Slider Portée (pour Point Light)
- Appelle : `add_point_light()` ou `add_directional_light()`

#### A6 — PlayerControllerPanel
- Slider FOV (45°–120°)
- Slider Speed (m/s)
- Slider Mouse Sensitivity
- Appelle : `set_player(id)` + configure les paramètres FPS

#### A7 — ScriptPanel (Scripting JS)
- Zone textarea pour code JavaScript
- Lifecycle hooks exposés : `onStart(entity, engine)`, `onUpdate(entity, engine, deltaMs)`
- Accès à l'API engine via objet `engine` passé en paramètre
- Exécution sandboxée : `new Function()` ou `eval` dans un contexte contrôlé
- Exemple d'IA ennemie :
  ```javascript
  // onUpdate — ChasePlayer
  const player = engine.getEntityByTag('player');
  if (!player) return;
  const myPos = engine.getPosition(entity.id);
  const playerPos = engine.getPosition(player.id);
  const dx = playerPos.x - myPos.x;
  const dz = playerPos.z - myPos.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 10) {
    engine.setPosition(entity.id,
      myPos.x + dx/dist * 2 * deltaMs/1000,
      myPos.y,
      myPos.z + dz/dist * 2 * deltaMs/1000
    );
  }
  ```

**Modifications sceneStore.ts :**
- Ajouter `components: Record<string, ComponentData>` par entité
- Sauvegarder/recharger tous les composants dans le JSON de scène

---

### Phase B — Engine-core : Features natifs manquants

#### B1 — Plane mesh
- Ajouter `MeshType::Plane` dans `ecs/components.rs`
- Vertices : 4 vertices, 2 triangles (quad), normales vers le haut (+Y)
- Exposer via `set_mesh_type(id, mesh_type: &str)` — "cube" | "plane"

#### B2 — Gravity + collision response
- Dans `update(delta_ms)` : appliquer vélocité Y -= gravity * dt aux RigidBody dynamiques
- Détection sol : si Y < collider_floor_y → reset Y velocity, set Y = floor_y
- Simple AABB vs AABB overlap pour stop lateral movement
- **Note :** Pas de moteur physique complet — physique simplifiée suffisante pour FPS

#### B3 — FPS Camera en play mode
- Nouvelle méthode : `set_fps_mode(enabled: bool)`
- En FPS mode : la camera position = player position + eye_offset (0, 1.7, 0)
- La camera direction = yaw/pitch du joueur (contrôlés par mouse_dx/mouse_dy de set_input)
- Sortie de play mode → retour caméra orbitale

#### B4 — Nouvelles API engine pour le scripting
- `get_entity_by_tag(tag: &str) → Option<u32>` — trouver le joueur, etc.
- `set_tag(id: u32, tag: &str)` — tagger une entité
- `get_position(id: u32) → [f32; 3]` — déjà couvert par get_transform_array mais exposer séparément
- `set_velocity(id: u32, vx: f32, vy: f32, vz: f32)` — pour les scripts

---

### Phase C — Play Mode FPS

#### C1 — Pointer Lock + Input capture
- Dans Viewport.tsx, au démarrage du play mode :
  - `canvas.requestPointerLock()` → capture la souris
  - Event listeners : `keydown`/`keyup` → bitmask WASD+Space
  - `mousemove` → accumuler dx/dy
  - Chaque frame : `engine.set_input(bitmask, mouse_dx, mouse_dy)`
  - Sortie play mode : `document.exitPointerLock()`

#### C2 — FPS HUD overlay
- Crosshair : `<div>` CSS centré, 2 lignes croisées (+)
- Health bar (optionnel MVP) : valeur exposée via engine ou store
- Affiché uniquement en play mode

#### C3 — Script execution loop
- Dans la boucle render de Viewport, en play mode :
  - Pour chaque entité avec un ScriptPanel : appeler `onUpdate(entity, engineProxy, deltaMs)`
  - `engineProxy` = objet JS wrappant les méthodes de engineBridge (set_position, get_position, etc.)
  - `onStart` appelé une fois au démarrage du play mode

---

## Flux créateur de jeu (FPS demo)

1. Créer entités : Floor (Plane), Walls (Cubes), Player (Cube), Enemies (Cubes)
2. Player : Add Component → PlayerController → configure FOV/speed
3. Floor/Walls : Add Component → Rigidbody (Static) + BoxCollider
4. Player : Add Component → Rigidbody (Dynamic) + BoxCollider
5. Enemies : Add Component → Script → écrire comportement chase
6. Ajouter une Light (directional light comme soleil)
7. Assigner des matériaux/textures aux murs et sols
8. Cliquer Play → FPS jouable

---

## Données de scène (JSON enrichi)

```json
{
  "entities": [
    {
      "id": 1,
      "name": "Player",
      "transform": [0, 1, 0, 0, 0, 0, 1, 1, 1],
      "components": {
        "meshRenderer": { "meshType": "cube" },
        "material": { "texId": 0, "metallic": 0.0, "roughness": 0.8 },
        "rigidbody": { "isStatic": false },
        "collider": { "hx": 0.4, "hy": 0.9, "hz": 0.4 },
        "playerController": { "fov": 75, "speed": 5.0, "mouseSensitivity": 0.002 }
      }
    },
    {
      "id": 2,
      "name": "Enemy_1",
      "transform": [5, 0, 5, 0, 0, 0, 1, 1, 1],
      "components": {
        "meshRenderer": { "meshType": "cube" },
        "material": { "texId": 1, "metallic": 0.0, "roughness": 1.0 },
        "rigidbody": { "isStatic": false },
        "collider": { "hx": 0.5, "hy": 0.9, "hz": 0.5 },
        "script": { "code": "// onUpdate chase script..." }
      }
    }
  ]
}
```

---

## Ce qui n'est PAS dans ce scope (YAGNI)

- Rotate/Scale gizmos — les transforms peuvent être édités numériquement
- Undo/Redo — complexité non justifiée pour outil perso
- Multi-select
- Hierarchy drag-drop (parent/child)
- Sphere/Capsule mesh
- NavMesh / pathfinding natif — délégué au script utilisateur
- Editor de script avec syntax highlighting (textarea suffit pour MVP)
- Hot-reload de scripts
- Audio engine

---

## Ordre d'implémentation recommandé

1. **B1** Plane mesh (débloque le level design)
2. **A3 + A4** Rigidbody + Collider panels + "Add Component" button
3. **A5** Light panel (débloque l'éclairage des niveaux)
4. **A2** Material panel (débloque la customisation visuelle)
5. **B2** Gravity + collision (débloque la physique de base)
6. **B3 + B4** FPS Camera + nouvelles APIs (débloque le play mode FPS)
7. **A6** PlayerController panel
8. **C1** Pointer lock + WASD capture
9. **A7 + C3** Script component + execution loop (débloque l'IA ennemie)
10. **C2** FPS HUD (polish final)
