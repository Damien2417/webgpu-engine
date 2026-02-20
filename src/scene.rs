use glam::Vec3;

/// Types de maillage supportés. Extensible (Sphere, Mesh(id), etc.)
pub enum MeshType {
    Cube,
}

/// Données pures d'une entité (pas de ressources GPU ici).
pub struct Entity {
    pub position: Vec3,
    pub rotation: Vec3, // angles Euler en degrés (X, Y, Z)
    pub scale:    Vec3,
    pub mesh:     MeshType,
}

impl Entity {
    pub fn new_cube() -> Self {
        Entity {
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            scale:    Vec3::ONE,
            mesh:     MeshType::Cube,
        }
    }
}
