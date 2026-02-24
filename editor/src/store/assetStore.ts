import { create } from 'zustand';

export interface AssetItem {
  name: string;
  url: string;
  texId: number;
  backendId?: string;
}

interface AssetState {
  assets: AssetItem[];
  addAsset: (a: AssetItem) => void;
  removeAsset: (texId: number) => void;
  clear: () => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  addAsset: (a) => set(s => ({ assets: [...s.assets, a] })),
  removeAsset: (texId) => set(s => ({ assets: s.assets.filter(a => a.texId !== texId) })),
  clear:    () => set({ assets: [] }),
}));
