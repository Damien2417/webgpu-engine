use glam::Vec3;

pub struct Transform {
    pub position: Vec3,
    pub rotation: Vec3,
    pub scale:    Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Transform {
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            scale:    Vec3::ONE,
        }
    }
}

pub enum MeshType {
    Cube,
}

pub struct MeshRenderer {
    pub mesh_type: MeshType,
}

// ── Material ───────────────────────────────────────────────────────────────

/// Associe une texture (par TextureId) à une entité.
pub struct Material {
    pub texture_id: u32,
}

// ── RigidBody ───────────────────────────────────────────────────────────────

pub struct RigidBody {
    pub velocity:  Vec3,
    pub is_static: bool,   // true = entité fixe (sol, murs) — pas d'intégration
    pub on_ground: bool,   // mis à jour par PhysicsSystem chaque frame
}

impl Default for RigidBody {
    fn default() -> Self {
        RigidBody {
            velocity:  Vec3::ZERO,
            is_static: false,
            on_ground: false,
        }
    }
}

// ── Collider AABB ───────────────────────────────────────────────────────────

pub struct Collider {
    pub half_extents: Vec3,  // demi-dimensions ; centre = Transform.position
}

// ── PointLight ────────────────────────────────────────────────────────────

pub struct PointLight {
    pub color:     Vec3,
    pub intensity: f32,
}
