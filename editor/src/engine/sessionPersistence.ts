import { bridge } from './engineBridge';
import { useAssetStore } from '../store/assetStore';
import { useCustomMeshStore } from '../store/customMeshStore';
import { useComponentStore } from '../store/componentStore';
import { useSceneStore } from '../store/sceneStore';
import { useEditorStore, type GizmoMode } from '../store/editorStore';
import { syncEditorComponentsToEngine } from './syncEditorComponents';
import { backendAssetContentUrl, listBackendAssets } from '../api/assetBackend';
import type { EntityComponents } from './types';

const STORAGE_KEY = 'nova_forge_editor_session_v1';

interface PersistedAsset {
  name: string;
  dataUrl?: string;
  texId: number;
  backendId?: string;
}

interface PersistedCustomMesh {
  name: string;
  oldIndex: number;
  vertices?: number[];
  indices?: number[];
  backendId?: string;
}

interface PersistedEditorUi {
  selectedId: number | null;  // kept for backwards compat on load
  gizmoMode: GizmoMode;
  isPaused: boolean;
}

interface PersistedViewportCamera {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
}

interface PersistedSession {
  version: 1;
  engineScene: unknown;
  editorMeta: Record<number, EntityComponents>;
  assets: PersistedAsset[];
  customMeshes: PersistedCustomMesh[];
  editorUi: PersistedEditorUi;
  viewportCamera: PersistedViewportCamera | null;
}

let viewportCameraState: PersistedViewportCamera | null = null;

export function setViewportCameraState(state: PersistedViewportCamera): void {
  viewportCameraState = state;
}

export function getViewportCameraState(): PersistedViewportCamera | null {
  return viewportCameraState;
}

function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => reject(new Error('Failed to decode image data URL'));
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function cloneScene<T>(scene: T): T {
  return JSON.parse(JSON.stringify(scene));
}

function remapSceneCustomMeshTypes(scene: any, meshMap: Map<number, number>): any {
  const next = cloneScene(scene ?? { entities: [], directional_light: null });
  if (!Array.isArray(next?.entities)) return next;
  for (const e of next.entities) {
    if (typeof e?.mesh_type !== 'string') continue;
    const m = e.mesh_type.match(/^custom:(\d+)$/);
    if (!m) continue;
    const oldIdx = Number(m[1]);
    const newIdx = meshMap.get(oldIdx);
    if (newIdx !== undefined) e.mesh_type = `custom:${newIdx}`;
  }
  return next;
}

async function imageDataFromBlob(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function remapEditorMetaTextureIds(
  meta: Record<number, EntityComponents>,
  texMap: Map<number, number>,
): Record<number, EntityComponents> {
  const out: Record<number, EntityComponents> = {};
  for (const [id, comps] of Object.entries(meta)) {
    const next: EntityComponents = { ...comps };
    if (next.material) {
      next.material = {
        ...next.material,
        texId: texMap.get(next.material.texId) ?? next.material.texId,
      };
    }
    out[Number(id)] = next;
  }
  return out;
}

export function saveSessionToLocalStorage(): void {
  if (!bridge.isReady) return;
  try {
    // Keep engine scene authoritative with latest editor-side component metadata.
    syncEditorComponentsToEngine();

    const editor = useEditorStore.getState();
    const payload: PersistedSession = {
      version: 1,
      engineScene: JSON.parse(bridge.saveScene()),
      editorMeta: useComponentStore.getState().serialize(),
      assets: useAssetStore.getState().assets.map((a) => ({
        name: a.name,
        dataUrl: a.backendId ? undefined : a.url,
        texId: a.texId,
        backendId: a.backendId,
      })),
      customMeshes: useCustomMeshStore.getState().meshes.map((m) => ({
        name: m.name,
        oldIndex: m.oldIndex,
        vertices: m.backendId ? undefined : m.vertices,
        indices: m.backendId ? undefined : m.indices,
        backendId: m.backendId,
      })),
      editorUi: {
        selectedId: editor.selectedIds.at(-1) ?? null,
        gizmoMode: editor.gizmoMode,
        isPaused: editor.isPaused,
      },
      viewportCamera: viewportCameraState,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[SessionPersistence] save failed', err);
  }
}

export async function restoreSessionFromLocalStorage(): Promise<boolean> {
  if (!bridge.isReady) return false;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || parsed.version !== 1) return false;

    useAssetStore.getState().clear();
    useCustomMeshStore.getState().clear();

    const texMap = new Map<number, number>();
    const orderedAssets = [...(parsed.assets ?? [])].sort((a, b) => a.texId - b.texId);

    // Resolve texture sources in parallel to speed up restore.
    const resolvedAssets = await Promise.all(orderedAssets.map(async (a) => {
      try {
        if (a.dataUrl) {
          const imageData = await dataUrlToImageData(a.dataUrl);
          return { a, imageData, displayUrl: a.dataUrl };
        }
        if (a.backendId) {
          const res = await fetch(backendAssetContentUrl(a.backendId));
          if (!res.ok) return null;
          const blob = await res.blob();
          const imageData = await imageDataFromBlob(blob);
          const displayUrl = URL.createObjectURL(blob);
          return { a, imageData, displayUrl };
        }
      } catch (err) {
        console.warn('[SessionPersistence] Failed to resolve texture asset', a.name, err);
      }
      return null;
    }));

    for (const r of resolvedAssets) {
      if (!r) continue;
      const newTexId = bridge.uploadTexture(r.imageData.width, r.imageData.height, r.imageData.data);
      if (newTexId < 0) continue;
      bridge.registerTexture(r.a.name, newTexId);
      useAssetStore.getState().addAsset({
        name: r.a.name,
        url: r.displayUrl,
        texId: newTexId,
        backendId: r.a.backendId,
      });
      texMap.set(r.a.texId, newTexId);
    }

    const orderedMeshes = [...(parsed.customMeshes ?? [])].sort((a, b) => a.oldIndex - b.oldIndex);
    // Resolve mesh payloads in parallel (fetch/parse), then upload in deterministic oldIndex order.
    const resolvedMeshes = await Promise.all(orderedMeshes.map(async (m) => {
      let vertices = m.vertices;
      let indices = m.indices;
      if ((!vertices || !indices) && m.backendId) {
        try {
          const res = await fetch(backendAssetContentUrl(m.backendId));
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            const lower = m.name.toLowerCase();
            if (lower.endsWith('.glb')) {
              const { parseGlb } = await import('./parsers/parseGltf');
              const parsedMesh = await parseGlb(buffer);
              vertices = Array.from(parsedMesh.vertices);
              indices = Array.from(parsedMesh.indices);
            } else if (lower.endsWith('.obj')) {
              const { parseObj } = await import('./parsers/parseObj');
              const parsedMesh = parseObj(new TextDecoder().decode(buffer));
              vertices = Array.from(parsedMesh.vertices);
              indices = Array.from(parsedMesh.indices);
            }
          }
        } catch (err) {
          console.warn('[SessionPersistence] Failed to parse cached backend mesh', m.name, err);
        }
      }
      if (!vertices || !indices) return null;
      return { m, vertices, indices };
    }));

    const meshMap = new Map<number, number>();
    for (const r of resolvedMeshes) {
      if (!r) continue;
      const newIndex = bridge.uploadCustomMesh(Float32Array.from(r.vertices), Uint32Array.from(r.indices));
      if (newIndex < 0) continue;
      meshMap.set(r.m.oldIndex, newIndex);
      useCustomMeshStore.getState().addMesh({
        name: r.m.name,
        oldIndex: newIndex,
        vertices: r.vertices,
        indices: r.indices,
        backendId: r.m.backendId,
      });
    }

    const remappedScene = remapSceneCustomMeshTypes(
      parsed.engineScene ?? { entities: [], directional_light: null },
      meshMap,
    );
    bridge.loadScene(JSON.stringify(remappedScene));
    const remappedMeta = remapEditorMetaTextureIds(parsed.editorMeta ?? {}, texMap);
    useComponentStore.getState().deserialize(remappedMeta);
    syncEditorComponentsToEngine();
    viewportCameraState = parsed.viewportCamera ?? null;
    const editor = useEditorStore.getState();
    editor.setGizmoMode(parsed.editorUi?.gizmoMode ?? 'translate');
    editor.setPaused(!!parsed.editorUi?.isPaused);
    editor.select(parsed.editorUi?.selectedId ?? null);
    useSceneStore.getState().refresh();
    return true;
  } catch (err) {
    console.error('[SessionPersistence] restore failed', err);
    return false;
  }
}

export async function hydrateAssetLibraryFromBackend(): Promise<void> {
  if (!bridge.isReady) return;
  const backendAssets = await listBackendAssets();
  if (backendAssets.length === 0) return;

  useAssetStore.getState().clear();
  useCustomMeshStore.getState().clear();

  const textures = backendAssets.filter((a) => a.kind === 'texture');
  const resolvedTextures = await Promise.all(textures.map(async (a) => {
    try {
      const res = await fetch(backendAssetContentUrl(a.id));
      if (!res.ok) return null;
      const blob = await res.blob();
      const imageData = await imageDataFromBlob(blob);
      return { a, imageData, url: URL.createObjectURL(blob) };
    } catch {
      return null;
    }
  }));
  for (const r of resolvedTextures) {
    if (!r) continue;
    const texId = bridge.uploadTexture(r.imageData.width, r.imageData.height, r.imageData.data);
    if (texId < 0) continue;
    bridge.registerTexture(r.a.name, texId);
    useAssetStore.getState().addAsset({
      name: r.a.name,
      texId,
      url: r.url,
      backendId: r.a.id,
    });
  }

  const models = backendAssets.filter((a) => a.kind === 'model');
  for (const m of models) {
    const res = await fetch(backendAssetContentUrl(m.id));
    if (!res.ok) continue;
    const buffer = await res.arrayBuffer();
    const lower = m.name.toLowerCase();
    let parsed: { vertices: Float32Array; indices: Uint32Array } | null = null;
    try {
      if (lower.endsWith('.glb')) {
        const { parseGlb } = await import('./parsers/parseGltf');
        parsed = await parseGlb(buffer);
      } else if (lower.endsWith('.obj')) {
        const { parseObj } = await import('./parsers/parseObj');
        parsed = parseObj(new TextDecoder().decode(buffer));
      }
    } catch (err) {
      console.warn('[SessionPersistence] Failed to parse backend model', m.name, err);
    }
    if (!parsed) continue;
    const idx = bridge.uploadCustomMesh(parsed.vertices, parsed.indices);
    if (idx < 0) continue;
    useCustomMeshStore.getState().addMesh({
      name: m.name,
      oldIndex: idx,
      vertices: Array.from(parsed.vertices),
      indices: Array.from(parsed.indices),
      backendId: m.id,
    });
  }
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let autosaveDebounce: ReturnType<typeof setTimeout> | null = null;
let unsubscribers: Array<() => void> = [];
let autosaveDirty = false;
let idleHandle: number | null = null;

const requestIdle = (cb: () => void): number => {
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') {
    return w.requestIdleCallback(cb, { timeout: 1500 });
  }
  return window.setTimeout(cb, 300);
};

const cancelIdle = (id: number) => {
  const w = window as any;
  if (typeof w.cancelIdleCallback === 'function') {
    w.cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
};

function flushAutosaveNow() {
  autosaveDirty = false;
  saveSessionToLocalStorage();
}

function scheduleAutosave(): void {
  autosaveDirty = true;
  if (autosaveDebounce !== null) clearTimeout(autosaveDebounce);
  autosaveDebounce = setTimeout(() => {
    if (idleHandle !== null) cancelIdle(idleHandle);
    idleHandle = requestIdle(() => {
      idleHandle = null;
      if (autosaveDirty) flushAutosaveNow();
    });
    autosaveDebounce = null;
  }, 1200);
}

export function startAutoSessionSave(): () => void {
  stopAutoSessionSave();

  // Light safety net: flush pending dirty state eventually, without aggressive cadence.
  autosaveTimer = setInterval(() => {
    if (autosaveDirty) flushAutosaveNow();
  }, 15000);

  // Save quickly after changes across editor stores.
  unsubscribers = [
    useSceneStore.subscribe(() => scheduleAutosave()),
    useComponentStore.subscribe(() => scheduleAutosave()),
    useAssetStore.subscribe(() => scheduleAutosave()),
    useCustomMeshStore.subscribe(() => scheduleAutosave()),
    useEditorStore.subscribe(() => scheduleAutosave()),
  ];

  return () => stopAutoSessionSave();
}

export function stopAutoSessionSave(): void {
  if (autosaveTimer !== null) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
  if (autosaveDebounce !== null) {
    clearTimeout(autosaveDebounce);
    autosaveDebounce = null;
  }
  if (idleHandle !== null) {
    cancelIdle(idleHandle);
    idleHandle = null;
  }
  if (autosaveDirty) {
    flushAutosaveNow();
  }
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
}
