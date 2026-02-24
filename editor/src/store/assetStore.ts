import { create } from 'zustand';

export interface AssetItem {
  name:  string;
  url:   string;
  texId: number;
}

interface AssetState {
  assets: AssetItem[];
  addAsset: (a: AssetItem) => void;
  clear: () => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  addAsset: (a) => set(s => ({ assets: [...s.assets, a] })),
  clear:    () => set({ assets: [] }),
}));
