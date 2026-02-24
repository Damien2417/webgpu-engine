import { create } from 'zustand';

export interface CustomMeshAsset {
  name: string;
  oldIndex: number;
  vertices: number[];
  indices: number[];
  backendId?: string;
}

interface CustomMeshState {
  meshes: CustomMeshAsset[];
  addMesh: (m: CustomMeshAsset) => void;
  clear: () => void;
}

export const useCustomMeshStore = create<CustomMeshState>((set) => ({
  meshes: [],
  addMesh: (m) => set((s) => ({ meshes: [...s.meshes, m] })),
  clear: () => set({ meshes: [] }),
}));
