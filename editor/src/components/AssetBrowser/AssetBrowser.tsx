import React, { useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';
import { useAssetStore } from '../../store/assetStore';
import { useComponentStore } from '../../store/componentStore';
import { useSceneStore } from '../../store/sceneStore';
import type { MaterialData } from '../../engine/types';

export default function AssetBrowser() {
  const assets     = useAssetStore(s => s.assets);
  const addAsset   = useAssetStore(s => s.addAsset);
  const fileRef    = useRef<HTMLInputElement>(null);
  const modelRef   = useRef<HTMLInputElement>(null);
  const selectedId = useEditorStore(s => s.selectedId);

  const importTextures = async (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      const bitmap    = await createImageBitmap(file);
      const offscreen = document.createElement('canvas');
      offscreen.width  = bitmap.width;
      offscreen.height = bitmap.height;
      const ctx       = offscreen.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data }  = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const texId     = bridge.uploadTexture(bitmap.width, bitmap.height, data);
      if (texId >= 0) addAsset({ name: file.name, url: URL.createObjectURL(file), texId });
    }
    e.target.value = '';
  };

  const import3dModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    let mesh;
    try {
      if (file.name.toLowerCase().endsWith('.glb')) {
        const { parseGlb } = await import('../../engine/parsers/parseGltf');
        mesh = await parseGlb(buffer);
      } else if (file.name.toLowerCase().endsWith('.obj')) {
        const { parseObj } = await import('../../engine/parsers/parseObj');
        mesh = parseObj(new TextDecoder().decode(buffer));
      } else {
        alert('Unsupported format. Use .obj or .glb');
        return;
      }
    } catch (err) {
      alert('Parse error: ' + String(err));
      return;
    }
    const meshIdx = bridge.uploadCustomMesh(mesh.vertices, mesh.indices);
    if (meshIdx < 0) return;
    const baseName = file.name.replace(/.w+$/, '');
    const { addEntity } = useSceneStore.getState();
    const { select } = useEditorStore.getState();
    const id = addEntity(baseName);
    bridge.setMeshType(id, `custom:${meshIdx}`);
    select(id);
    e.target.value = '';
  };

  const applyToSelected = (texId: number) => {
    if (selectedId === null) return;
    const existing = useComponentStore.getState().getComponents(selectedId).material ?? {
      texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0] as [number, number, number],
    };
    const next: MaterialData = { ...existing, texId };
    useComponentStore.getState().setComponent(selectedId, 'material', next);
    bridge.addPbrMaterial(selectedId, texId, next.metallic, next.roughness);
    bridge.setEmissive(selectedId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 8px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>
        <span>Assets</span>
        <button
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 11 }}
          onClick={() => fileRef.current?.click()}
        >+ Import</button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={importTextures} />
        <button
          style={{ background: 'none', border: '1px solid var(--border)', color: '#9b59b6', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 11 }}
          onClick={() => modelRef.current?.click()}
        >+ 3D Model</button>
        <input ref={modelRef} type="file" accept=".obj,.glb" style={{ display: 'none' }} onChange={import3dModel} />
        {selectedId === null && assets.length > 0 && (
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', fontSize: 10 }}>— select an entity first</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, flex: 1, overflowY: 'auto' }}>
        {assets.map((a, i) => (
          <div
            key={i}
            title={`Apply ${a.name}`}
            onClick={() => applyToSelected(a.texId)}
            style={{ width: 64, cursor: selectedId !== null ? 'pointer' : 'default', textAlign: 'center', opacity: selectedId !== null ? 1 : 0.5 }}
          >
            <img src={a.url} alt={a.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)', display: 'block' }} />
            <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
