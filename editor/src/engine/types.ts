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
