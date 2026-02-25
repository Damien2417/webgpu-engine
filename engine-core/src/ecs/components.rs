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

#[derive(Debug, Clone, PartialEq, Default)]
pub enum MeshType {
    #[default]
    Cube,
    Plane,
    Custom(usize),  // index into World::custom_meshes
    Sphere,
    Cylinder,
}

pub struct MeshRenderer {
    pub mesh_type: MeshType,
}

// ── Material ───────────────────────────────────────────────────────────────

/// Matériau PBR associé à une entité.
pub struct Material {
    pub albedo_tex:  u32,   // TextureId GPU (index dans World::textures)
    pub normal_tex:  u32,   // TextureId GPU — u32::MAX = flat normal default
    pub metallic:    f32,   // 0.0 diélectrique, 1.0 métal
    pub roughness:   f32,   // 0.0 miroir, 1.0 mat
    pub emissive:    Vec3,  // Couleur auto-illuminée (r, g, b)
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

// ── Parent ────────────────────────────────────────────────────────────────

pub struct Parent {
    pub parent_id: usize,
}

// ── Camera ────────────────────────────────────────────────────────────────

pub struct CameraComponent {
    pub fov:           f32,   // degrees, default 60
    pub near:          f32,   // default 0.1
    pub far:           f32,   // default 1000.0
    pub follow_entity: bool,  // true: use entity transform, false: independent free camera
}

impl Default for CameraComponent {
    fn default() -> Self {
        CameraComponent { fov: 60.0, near: 0.1, far: 1000.0, follow_entity: true }
    }
}
