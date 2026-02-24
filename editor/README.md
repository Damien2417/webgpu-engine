# WebUnity Editor

Éditeur de scènes 3D style Unity, embarqué dans le navigateur. Interface React 18 + Zustand, rendu WebGPU via le moteur Rust/WASM `engine-core`.

---

## Lancer

```bash
cd editor
npm install
npm run dev   # http://localhost:5173
```

Prérequis : Node 18+, le fichier `engine-core/pkg/` doit être buildé
(`cd engine-core && wasm-pack build --target web`).

---

## Interface

```
┌─ WebUnity ───────────────────────────────────────────────────────────────┐
│  Toolbar : [W] Move  [E] Rotate  [R] Scale  |  ▶ Play  ⏸ Pause  ⏹ Stop  │
├──────────┬───────────────────────────────────────────┬───────────────────┤
│          │                                           │                   │
│  Scene   │             Viewport                      │    Inspector      │
│  Graph   │     [canvas WebGPU]                       │                   │
│          │     [gizmos overlay]                      │  Tag              │
│  Search  │     [FPS counter]                         │  Transform        │
│  + Add   │                                           │  MeshRenderer     │
│          │                                           │  Material / PBR   │
│  Entity  │  RMB look | WASD move | Q/E up/down       │  RigidBody        │
│  Entity  │  Shift boost | F focus | scroll zoom      │  Collider         │
│  ...     │                                           │  PointLight       │
│          │                                           │  Camera           │
│          │                                           │  Particle         │
│          │                                           │  Script           │
│          │                                           │  [+ Add Component]│
├──────────┴───────────────────────────────────────────┴───────────────────┤
│  Asset Browser  —  import PNG/JPG/OBJ/GLB  |  cliquer = appliquer        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| `W` | Mode translate (gizmo) |
| `E` | Mode rotate (gizmo) |
| `R` | Mode scale (gizmo) |
| `F` | Cadrer la caméra sur l'entité sélectionnée |
| `Suppr` / `Backspace` | Supprimer l'entité sélectionnée |
| `Ctrl+D` | Dupliquer l'entité sélectionnée |
| `Ctrl+Z` | Annuler (undo) |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Rétablir (redo) |
| `Ctrl+S` | Sauvegarder la scène (`.json`) |
| **Caméra éditeur** | |
| RMB + drag | Rotation de la caméra libre |
| WASD | Déplacement |
| Q / E | Monter / Descendre |
| Shift | Boost vitesse ×2 |
| Molette | Avancer/Reculer sur l'axe de visée |

---

## Panneaux — fonctionnalités détaillées

### Scene Graph

- `+` pour créer une entité vide
- Clic = sélectionner
- Double-clic = renommer inline
- Clic droit = supprimer
- Ctrl+D = dupliquer l'entité sélectionnée
- Barre de recherche filtre par nom

### Viewport

- Rendu WebGPU temps réel (FPS affiché en haut à gauche)
- Caméra orbitale libre en mode éditeur (RMB + WASD + Q/E + molette)
- Gizmos 3D : translate (flèches XYZ), rotate (anneaux), scale (cubes)
- Overlay 2D canvas par-dessus le canvas WebGPU

### Inspector

Chaque composant est un panneau repliable. Les composants existants s'affichent
automatiquement ; `+ Add Component` permet d'en ajouter de nouveaux.

| Composant | Propriétés |
|-----------|-----------|
| **Tag** | Chaîne libre, utilisable depuis les scripts (`engine.getEntityByTag`) |
| **Transform** | Position / Rotation (degrés) / Scale — sliders + inputs numériques |
| **MeshRenderer** | Type de mesh : Cube / Sphere / Cylinder / Plane / Custom (.obj/.glb) |
| **Material** | Albedo (texture ou couleur), Metallic, Roughness, Normal map, Émissif |
| **RigidBody** | Dynamique / Statique, visualisation de la vélocité |
| **Collider** | AABB half-extents XYZ, bouton « Fit to Mesh » |
| **PointLight** | Couleur RGB + Intensité |
| **Camera** | FOV, Near, Far, bouton « Set as Active » |
| **Particle** | Rate, Lifetime, Speed, Spread, Gravity — émetteur pur JS |
| **Script** | Éditeur de code inline exécuté chaque frame en mode Play |

### Asset Browser

- Import : PNG, JPG (textures) — OBJ, GLB (modèles 3D)
- Cliquer sur une texture = l'appliquer à l'entité sélectionnée
- Les assets sont persistés en `localStorage` (base64) entre sessions

### Toolbar / Play mode

- **Play** : snapshot JSON de la scène, démarre la simulation (physique + scripts + particules)
- **Pause** : fige la game loop sans perdre l'état
- **Stop** : restaure le snapshot initial

En mode Play, le viewport capture la souris pour le contrôle FPS.
`Échap` libère la souris.

---

## Script API

Les scripts se rédigent dans le panneau **Script** de l'Inspector.
La fonction est appelée chaque frame en mode Play.

```js
// Paramètres disponibles : entity (id, name), engine, deltaMs

// Déplacement
engine.setPosition(entity.id, x, y, z)
engine.getPosition(entity.id)           // → [x, y, z]
engine.setRotation(entity.id, x, y, z) // degrés Euler
engine.getRotation(entity.id)           // → [x, y, z]
engine.setScale(entity.id, x, y, z)

// Physique
engine.setVelocity(entity.id, vx, vy, vz)
engine.getVelocity(entity.id)           // → [vx, vy, vz]

// Input
engine.getKey('arrowleft')              // → boolean (insensible à la casse)

// Entités
engine.spawnEntity('NomEntité')         // → newId  (ajoute un MeshRenderer)
engine.destroyEntity(id)
engine.getEntityIds()                   // → number[]
engine.getEntityName(id)                // → string
engine.getEntityByTag('ennemi')         // → id | null

// Debug
engine.log('message', valeur)
```

### Exemple — mouvement latéral

```js
const speed = 3;
const [x, y, z] = engine.getPosition(entity.id);
if (engine.getKey('arrowleft'))  engine.setPosition(entity.id, x - speed * deltaMs / 1000, y, z);
if (engine.getKey('arrowright')) engine.setPosition(entity.id, x + speed * deltaMs / 1000, y, z);
```

### Exemple — spawn d'entités

```js
if (engine.getKey(' ') && deltaMs > 0) {
  const id = engine.spawnEntity('Balle');
  const [x, y, z] = engine.getPosition(entity.id);
  engine.setPosition(id, x, y + 1, z);
  engine.setVelocity(id, 0, 5, -10);
}
```

---

## Architecture

```
editor/src/
├── engine/
│   ├── engineBridge.ts      Singleton EngineBridge — wrapper TypeScript autour du WASM World
│   ├── types.ts             Types partagés (EntityId, Transform, ComponentStore…)
│   ├── scriptRunner.ts      Compile + exécute les scripts JS (new Function), proxy engineProxy
│   ├── particleSystem.ts    Émetteur de particules pur JS (pool d'entités moteur)
│   ├── sessionPersistence.ts localStorage — sauvegarde/restaure assets + scène entre sessions
│   └── parsers/
│       ├── parseObj.ts      Parser OBJ → Float32Array vertices + Uint32Array indices
│       └── parseGltf.ts     Parser GLB/GLTF → même format
│
├── store/
│   ├── editorStore.ts       Zustand — selectedId, gizmoMode, isPlaying, isPaused, undo/redo stacks
│   ├── sceneStore.ts        Zustand — liste d'entités React (sync depuis WASM)
│   ├── componentStore.ts    Zustand — données composants éditeur (Material, Script, Camera…)
│   ├── assetStore.ts        Zustand — assets importés (textures + modèles 3D), persistés localStorage
│   └── customMeshStore.ts   Zustand — registre meshes custom uploadés
│
└── components/
    ├── Toolbar/             Boutons W/E/R, Play/Pause/Stop
    ├── MenuBar/             New / Save JSON / Load JSON
    ├── SceneGraph/          Liste entités + rename + search + raccourcis
    ├── Viewport/            Canvas WebGPU + boucle RAF + caméra orbitale + GizmoOverlay
    ├── Inspector/
    │   ├── ComponentPanels  Dispatch vers les bons panels selon les composants présents
    │   ├── AddComponentButton
    │   └── panels/          Un fichier par composant (Transform, Material, Camera, Script…)
    └── AssetBrowser/        Import drag-drop + galerie thumbnails
```

### Undo / Redo

Chaque opération destructive (`Delete`, `Ctrl+D`, modifications de transform via gizmo)
pousse un snapshot `{ engineJson, editorMeta }` sur `undoStack`.
`Ctrl+Z` dépile le dernier snapshot et pousse l'état courant sur `redoStack`.
`Ctrl+Y` fait l'inverse. Maximum 20 états dans chaque stack.

### Boucle de rendu

- **Mode éditeur** : `bridge.startLoop(onFrame)` — `World::render_frame(deltaMs)` uniquement
- **Mode Play** : `bridge.startGameLoop(onFrame)` — `World::update(deltaMs)` + `render_frame` + scripts + particules
- **Pause** : `bridge.stopLoop()` sans restaurer la scène
