use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct SceneTransform {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub scale:    [f32; 3],
}

impl Default for SceneTransform {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale:    [1.0, 1.0, 1.0],
        }
    }
}

fn default_metallic()  -> f32 { 0.0 }
fn default_roughness() -> f32 { 0.5 }
fn default_fov()  -> f32 { 60.0 }
fn default_near() -> f32 { 0.1 }
fn default_far()  -> f32 { 1000.0 }

// Désérialiseurs qui acceptent `null` comme équivalent de la valeur par défaut.
// `#[serde(default = "...")]` gère les champs ABSENTS ; ces fonctions gèrent les
// champs présents mais explicitement `null` (sessions corrompues / anciennes versions).
fn deser_fov<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
    Ok(Option::<f32>::deserialize(d)?.unwrap_or(60.0))
}
fn deser_near<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
    Ok(Option::<f32>::deserialize(d)?.unwrap_or(0.1))
}
fn deser_far<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
    Ok(Option::<f32>::deserialize(d)?.unwrap_or(1000.0))
}
fn deser_metallic<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
    Ok(Option::<f32>::deserialize(d)?.unwrap_or(0.0))
}
fn deser_roughness<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
    Ok(Option::<f32>::deserialize(d)?.unwrap_or(0.5))
}

#[derive(Serialize, Deserialize)]
pub struct SceneCameraComponent {
    #[serde(default = "default_fov",  deserialize_with = "deser_fov")]
    pub fov:  f32,
    #[serde(default = "default_near", deserialize_with = "deser_near")]
    pub near: f32,
    #[serde(default = "default_far",  deserialize_with = "deser_far")]
    pub far:  f32,
    #[serde(default = "default_follow_entity")]
    pub follow_entity: bool,
    #[serde(default)]
    pub is_active: bool,
}
fn default_follow_entity() -> bool { true }

#[derive(Serialize, Deserialize)]
pub struct SceneMaterial {
    pub texture: String,
    #[serde(default)]
    pub normal_texture: String,
    #[serde(default = "default_metallic", deserialize_with = "deser_metallic")]
    pub metallic: f32,
    #[serde(default = "default_roughness", deserialize_with = "deser_roughness")]
    pub roughness: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emissive: Option<[f32; 3]>,
}

#[derive(Serialize, Deserialize)]
pub struct SceneRigidBody {
    pub is_static: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ScenePointLight {
    pub color:     [f32; 3],
    pub intensity: f32,
}

fn default_cone_angle_deg() -> f32 { 30.0 }

#[derive(Serialize, Deserialize)]
pub struct SceneDirectionalLight {
    pub direction: [f32; 3],
    pub color:     [f32; 3],
    pub intensity: f32,
    #[serde(default = "default_cone_angle_deg")]
    pub cone_angle_deg: f32,
}

/// Représente une entité dans le JSON de scène.
#[derive(Serialize, Deserialize, Default)]
pub struct SceneEntityData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform:     Option<SceneTransform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_renderer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material:      Option<SceneMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rigid_body:    Option<SceneRigidBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collider_aabb: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_light:   Option<ScenePointLight>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<SceneCameraComponent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_index: Option<usize>,  // index dans le tableau entities (pas l'ID moteur)
}

/// Structure top-level du fichier JSON de scène.
#[derive(Serialize, Deserialize, Default)]
pub struct SceneData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directional_light: Option<SceneDirectionalLight>,
    #[serde(default)]
    pub entities: Vec<SceneEntityData>,
}
