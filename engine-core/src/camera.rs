use glam::{Mat4, Vec3};

pub struct Camera {
    pub eye:    Vec3,
    pub target: Vec3,
    pub up:     Vec3,
    pub fov_y:  f32, // degrés
}

impl Default for Camera {
    fn default() -> Self {
        Camera {
            eye:    Vec3::new(3.0, 2.0, 5.0),
            target: Vec3::ZERO,
            up:     Vec3::Y,
            fov_y:  45.0,
        }
    }
}

impl Camera {
    /// Matrice de vue (world → camera space).
    pub fn view_matrix(&self) -> Mat4 {
        Mat4::look_at_rh(self.eye, self.target, self.up)
    }

    /// Matrice de projection perspective (camera → clip space).
    /// aspect = largeur / hauteur du canvas.
    pub fn proj_matrix(&self, aspect: f32) -> Mat4 {
        Mat4::perspective_rh(
            self.fov_y.to_radians(),
            aspect,
            0.1,    // near plane
            1000.0, // far plane
        )
    }
}
