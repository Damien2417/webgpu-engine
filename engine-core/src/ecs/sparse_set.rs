/// Sentinel : indique l'absence d'un composant dans le vecteur sparse.
const EMPTY: usize = usize::MAX;

/// Conteneur de composants basé sur un Sparse Set.
///
/// - `sparse[entity_id]` → index dans `dense` (ou EMPTY si absent)
/// - `dense`             → composants compactés (itération rapide)
/// - `ids`               → entity_id correspondant à chaque slot dense
pub struct SparseSet<T> {
    sparse: Vec<usize>,
    dense:  Vec<T>,
    ids:    Vec<usize>,
}

impl<T> Default for SparseSet<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> SparseSet<T> {
    pub fn new() -> Self {
        SparseSet {
            sparse: Vec::new(),
            dense:  Vec::new(),
            ids:    Vec::new(),
        }
    }

    /// Insère ou remplace le composant pour `id`.
    pub fn insert(&mut self, id: usize, value: T) {
        assert!(id != usize::MAX, "entity id usize::MAX is reserved as sentinel");
        if id >= self.sparse.len() {
            self.sparse.resize(id + 1, EMPTY);
        }
        if self.sparse[id] != EMPTY {
            let idx = self.sparse[id];
            self.dense[idx] = value;
        } else {
            let idx = self.dense.len();
            self.sparse[id] = idx;
            self.dense.push(value);
            self.ids.push(id);
        }
    }

    /// Retourne une référence immutable, ou None si absent.
    pub fn get(&self, id: usize) -> Option<&T> {
        assert!(id != usize::MAX, "entity id usize::MAX is reserved as sentinel");
        if id >= self.sparse.len() || self.sparse[id] == EMPTY {
            return None;
        }
        Some(&self.dense[self.sparse[id]])
    }

    /// Retourne une référence mutable, ou None si absent.
    pub fn get_mut(&mut self, id: usize) -> Option<&mut T> {
        assert!(id != usize::MAX, "entity id usize::MAX is reserved as sentinel");
        if id >= self.sparse.len() || self.sparse[id] == EMPTY {
            return None;
        }
        let idx = self.sparse[id];
        Some(&mut self.dense[idx])
    }

    /// Itère sur tous les composants : (entity_id, &T).
    pub fn iter(&self) -> impl Iterator<Item = (usize, &T)> {
        debug_assert_eq!(self.ids.len(), self.dense.len(), "ids/dense désynchronisés");
        self.ids.iter().copied().zip(self.dense.iter())
    }

    /// Supprime le composant pour `id`. Retourne true si existait.
    /// Utilise swap-remove : O(1), réordonne les éléments dense.
    pub fn remove(&mut self, id: usize) -> bool {
        if id >= self.sparse.len() || self.sparse[id] == EMPTY {
            return false;
        }
        let idx      = self.sparse[id];
        let last_idx = self.dense.len() - 1;

        // Swap-remove dans dense + ids
        self.dense.swap_remove(idx);
        self.ids.swap_remove(idx);

        // L'élément qui était au dernier slot est maintenant à idx
        // → mettre à jour son entrée sparse (sauf si on a supprimé le dernier)
        if idx <= last_idx && idx < self.ids.len() {
            let moved_id = self.ids[idx];
            self.sparse[moved_id] = idx;
        }

        self.sparse[id] = EMPTY;
        true
    }
}
