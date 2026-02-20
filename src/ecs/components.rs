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
