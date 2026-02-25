# Design — Groupement d'objets (style Unity)

Date : 2026-02-25
Statut : Approuvé

## Objectif

Permettre de regrouper des entités de la scène sous un parent commun (entité vide "Group"), avec héritage complet des transformations (position + rotation + scale) via la hiérarchie parent-enfant dans le moteur Rust.

---

## 1. Moteur Rust (engine-core)

### 1.1 Nouveau composant

```rust
// ecs/components.rs
pub struct Parent {
    pub parent_id: usize,
}
```

Ajout dans `World` :
```rust
parents: SparseSet<Parent>,
```

### 1.2 Sémantique des transforms

- `Transform` devient **local** dès qu'une entité a un parent.
- Les entités racines (sans parent) : local = world (comportement inchangé).
- Au rendu, le world transform est calculé récursivement :
  ```
  world_matrix(id) = world_matrix(parent_id) × local_matrix(id)
  ```

### 1.3 Nouvelle API WASM

```rust
// Hiérarchie
set_parent(child_id: usize, parent_id: usize)
    // Convertit le world transform courant de child en local relatif à parent
remove_parent(child_id: usize)
    // Convertit le local transform en world, supprime la relation
get_parent(child_id: usize) -> u32       // u32::MAX = pas de parent
get_children(parent_id: usize) -> Vec<u32>

// Transforms
get_transform_array(id) -> [f32; 9]       // LOCAL (inchangé en signature, change en sémantique)
get_world_transform_array(id) -> [f32; 9] // WORLD — nouveau, pour gizmo et centroïde
```

### 1.4 Modifications du rendu

Dans `render_frame`, le calcul du model matrix pour chaque entité appelle `compute_world_matrix(id)` qui remonte la chaîne de parents. Pour les entités racines (aucun parent), comportement identique à aujourd'hui.

---

## 2. Editor TypeScript

### 2.1 Multi-select

`editorStore` :
```typescript
// Avant
selectedId: EntityId | null

// Après
selectedIds: EntityId[]

// Helpers
select(id)           // sélection unique (remplace tout)
toggleSelect(id)     // Ctrl+Clic — ajoute/retire
selectAll()          // Ctrl+A
clearSelection()     // Escape / clic fond vide
```

Interactions :
- Clic simple → sélection unique
- `Ctrl+Clic` → toggle
- `Escape` → désélectionner
- `Ctrl+A` → tout sélectionner

### 2.2 Inspecteur

- 1 entité sélectionnée → affiche ses propriétés (transform LOCAL si enfant)
- N entités → affiche `N entities selected`
- `get_world_transform_array` utilisé pour l'affichage de la position monde dans le header de l'inspecteur

### 2.3 Gizmo multi-select

- Position du gizmo = centroïde des world positions sélectionnées
- Translation → applique le delta world en local à chaque entité
- Rotation / Scale → pivot = centroïde, applique dans l'espace local de chaque entité

### 2.4 SceneGraph — arbre

Affichage hiérarchique avec indent par niveau :
```
▾ TableGroup        (expand/collapse)
    Table
    Chair_1
    Chair_2
Lamp
Floor
```

- Chevron `▾`/`▸` cliquable pour expand/collapse (état local par entité)
- Drag-and-drop pour reparenter :
  - Drop sur entité → `set_parent(dragged, target)`
  - Drop dans le vide → `remove_parent(dragged)`
- Entités groupe (sans mesh) : icône `◻` distincte
- `Ctrl+Clic` dans l'arbre pour multi-select

### 2.5 Actions Group / Ungroup

**Group** (`Ctrl+G`, bouton toolbar) :
1. Calculer le centroïde des world positions sélectionnées
2. Créer une entité vide "Group" à ce centroïde (sans MeshRenderer)
3. `set_parent(child, groupId)` pour chaque entité sélectionnée
4. Sélectionner le groupe résultant

**Ungroup** (`Ctrl+Shift+G`) sur groupe sélectionné :
1. `remove_parent(child)` pour chaque enfant
2. Supprimer l'entité groupe si elle n'a pas de MeshRenderer
3. Sélectionner les entités libérées

---

## 3. EngineBridge

Nouveaux wrappers dans `engineBridge.ts` :
```typescript
setParent(childId, parentId): void
removeParent(childId): void
getParent(childId): EntityId | null
getChildren(parentId): EntityId[]
getWorldTransform(id): Transform
```

---

## 4. Persistence (save_scene / load_scene)

Le JSON de scène inclut les relations parent-enfant :
```json
{
  "entities": [
    { "id": 0, "name": "Group", "transform": {...} },
    { "id": 1, "name": "Chair", "parent_id": 0, "transform": {...} }
  ]
}
```

`load_scene` reconstruit les relations `set_parent` après création des entités.

---

## 5. Sprints

**Sprint 1** — Moteur Rust
- Composant `Parent` + `SparseSet<parents>` dans World
- `compute_world_matrix` récursif dans le rendu
- API WASM : `set_parent`, `remove_parent`, `get_parent`, `get_children`, `get_world_transform_array`
- Persistence JSON avec `parent_id`

**Sprint 2** — Editor multi-select + SceneGraph arbre
- `selectedIds[]` dans editorStore
- Interactions clavier/souris multi-select
- SceneGraph tree avec expand/collapse
- EngineBridge nouveaux wrappers

**Sprint 3** — Group/Ungroup + Gizmo + Drag-and-drop
- Actions Group/Ungroup (toolbar + raccourcis)
- Gizmo centroïde multi-select
- Drag-and-drop pour reparenter dans SceneGraph
- Inspecteur adapté (local vs world transform)

---

## 6. Critères de done

- Sélectionner N entités → `Ctrl+G` crée un groupe au centroïde
- Déplacer/Rotation/Scale du groupe → tous les enfants bougent correctement
- `Ctrl+Shift+G` libère les enfants en world space
- Drag-and-drop dans SceneGraph reparente correctement
- Save/Load scène préserve la hiérarchie
- Undo/Redo fonctionne sur toutes ces actions
