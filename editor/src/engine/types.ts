export type EntityId = number;

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number]; // euler degrees
  scale:    [number, number, number];
}

export interface EntityData {
  id:        EntityId;
  name:      string;
  transform: Transform;
  hasMesh:   boolean;
}

export interface MaterialData {
  texId:     number;                     // -1 = no texture
  metallic:  number;                     // 0.0–1.0
  roughness: number;                     // 0.0–1.0
  emissive:  [number, number, number];   // RGB 0.0–1.0
}

export interface RigidbodyData {
  isStatic: boolean;
}

export interface ColliderData {
  hx: number;
  hy: number;
  hz: number;
}

export interface PointLightData {
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface CameraData {
  fov:          number;
  near:         number;
  far:          number;
  isActive:     boolean;
  followEntity: boolean;
}

export interface DirectionalLightData {
  dx: number;
  dy: number;
  dz: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface ParticleData {
  rate:       number;  // particles/second
  lifetime:   number;  // seconds
  speed:      number;  // units/second
  spread:     number;  // 0-1 cone spread
  gravity:    number;  // downward force
  sizeStart:  number;  // spawn size
  sizeEnd:    number;  // end-of-life size
  colorStart: [number, number, number];
  colorEnd:   [number, number, number];
}

export interface EntityComponents {
  meshType?:         'cube' | 'plane';
  material?:         MaterialData;
  rigidbody?:        RigidbodyData;
  collider?:         ColliderData;
  pointLight?:       PointLightData;
  directionalLight?: DirectionalLightData;
  isPlayer?:         boolean;
  script?:           string;
  camera?:           CameraData;
  particle?:         ParticleData;
}
