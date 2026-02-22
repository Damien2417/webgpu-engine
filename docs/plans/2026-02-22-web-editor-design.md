# WebUnity Editor — Design Document (Phase 7)

**Date :** 2026-02-22
**Objectif :** Mini-éditeur web SaaS complet style Unity — viewport WebGPU, scene graph, inspector, gizmos, asset browser, play/stop.
**Stack :** React 18 + TypeScript + Vite + Zustand + engine-core WASM

---

## Layout

```
┌──────────┬─────────────────────────────────┬──────────────┐
│ MenuBar  │        Toolbar                  │              │
├──────────┼─────────────────────────────────┤              │
│          │                                 │  Inspector   │
│  Scene   │        Viewport                 │              │
│  Graph   │   [WebGPU canvas]               │  Transform   │
│          │   [Gizmo overlay SVG]           │  Material    │
│  entités │                                 │  Light...    │
│  tree    │                                 │              │
├──────────┴─────────────────────────────────┴──────────────┤
│              Asset Browser                                 │
└────────────────────────────────────────────────────────────┘
```

---

## Stack

| Couche   | Choix                                              |
|----------|----------------------------------------------------|
| UI       | React 18 + TypeScript                              |
| Build    | Vite                                               |
| State    | Zustand (léger, sans Provider boilerplate)         |
| Engine   | `engine-core/pkg/` WASM (même que game-app)        |
| Gizmos   | Overlay `<canvas 2D>` sur le viewport WebGPU       |

---

## Structure `editor/`

```
editor/
├── src/
│   ├── main.tsx
│   ├── App.tsx                    ← layout 4 panneaux (CSS grid)
│   ├── components/
│   │   ├── Viewport/
│   │   │   ├── Viewport.tsx       ← canvas WebGPU + canvas 2D overlay
│   │   │   └── GizmoOverlay.tsx   ← rendu gizmos translate/rotate/scale
│   │   ├── SceneGraph/
│   │   │   ├── SceneGraph.tsx     ← arbre d'entités cliquables
│   │   │   └── EntityNode.tsx     ← nœud individuel (nom, icône, visibility)
│   │   ├── Inspector/
│   │   │   ├── Inspector.tsx      ← panneau droite, sections par composant
│   │   │   ├── TransformPanel.tsx ← position/rotation/scale inputs
│   │   │   ├── MaterialPanel.tsx  ← albedo, metallic, roughness
│   │   │   └── LightPanel.tsx     ← color, intensity
│   │   ├── AssetBrowser/
│   │   │   ├── AssetBrowser.tsx   ← grille de thumbnails
│   │   │   └── AssetItem.tsx      ← texture/mesh/material draggable
│   │   ├── Toolbar/
│   │   │   └── Toolbar.tsx        ← W/E/R gizmo mode + Play/Stop
│   │   └── MenuBar/
│   │       └── MenuBar.tsx        ← File > New / Save JSON / Load JSON
│   ├── store/
│   │   ├── editorStore.ts         ← selectedEntityId, gizmoMode, isPlaying
│   │   └── sceneStore.ts          ← liste entités + composants (miroir WASM)
│   └── engine/
│       ├── engineBridge.ts        ← singleton World, init, commandes
│       └── types.ts               ← EntityId, Transform, Material, Light...
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Architecture des données

### `editorStore` (Zustand)

```typescript
interface EditorState {
  selectedEntityId: number | null;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  isPlaying: boolean;
  sceneSnapshot: string | null;   // JSON snapshot pour Play/Stop

  selectEntity: (id: number | null) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  play: () => void;
  stop: () => void;
}
```

### `sceneStore` (Zustand)

```typescript
interface SceneState {
  entities: EntityData[];           // miroir de l'état WASM
  addEntity: (name: string) => void;
  removeEntity: (id: number) => void;
  updateTransform: (id: number, t: Partial<Transform>) => void;
  loadFromJson: (json: string) => void;
  toJson: () => string;
}
```

---

## Flux de données

```
User interaction
     │
     ▼
React UI (click, drag, input)
     │
     ▼
editorStore / sceneStore (Zustand)
     │
     ▼
engineBridge.ts (commandes WASM)
     │
     ▼
World WASM (engine-core)
     │
     ▼
WebGPU render loop (RAF)
     │
     ▼
Viewport canvas ← rendu 3D
GizmoOverlay    ← projection 3D→2D
```

---

## Gizmos

- **Overlay `<canvas 2D>`** transparent, positionné en `position:absolute` au-dessus du canvas WebGPU
- En mode **Edit** : projection des positions 3D → screen space via matrices view/projection exposées par le WASM
- Handles visuels : flèches colorées (XYZ = rouge/vert/bleu), anneaux pour rotation, cubes pour scale
- Drag sur un handle → `world.set_transform(id, ...)` en continu
- Keyboard : `W` = translate, `E` = rotate, `R` = scale, `Escape` = déselect

---

## Play / Stop

| Mode | Comportement |
|------|-------------|
| **Edit** | RAF pausé, gizmos actifs, scène modifiable, scene graph interactif |
| **Play** | Snapshot JSON de la scène → moteur tourne en boucle RAF, UI lecture seule |
| **Stop** | Restaure snapshot, retour Edit mode |

---

## MenuBar — File

- **New** : réinitialise la scène (scène vide)
- **Save** : `world.save_scene()` → téléchargement `.json`
- **Load** : `<input type="file">` → `world.load_scene(json)`

---

## Thème visuel

Inspiré de Unity Dark Theme : fond `#1e1e1e`, panneaux `#252526`, headers `#2d2d2d`, accent `#4fc3f7`. CSS custom properties, pas de framework CSS externe.

---

## Phases d'implémentation suggérées

1. **Setup** : scaffolding `editor/` Vite + React + Zustand, layout CSS grid de base
2. **Engine bridge** : init WASM, render loop dans Viewport, caméra orbitale
3. **Scene Graph** : liste entités, sélection, add/remove entity
4. **Inspector** : TransformPanel connecté à sceneStore + engineBridge
5. **Gizmos** : overlay canvas 2D, handles translate (W)
6. **Gizmos** : rotate (E) + scale (R)
7. **Asset Browser** : drag & drop textures sur entités
8. **Play/Stop** : snapshot + restore
9. **MenuBar** : Save/Load JSON
10. **Polish** : thème, keyboard shortcuts, UX
