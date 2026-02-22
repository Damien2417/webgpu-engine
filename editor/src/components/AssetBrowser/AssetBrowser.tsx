import React, { useState, useRef } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';

interface AssetItem { name: string; url: string; texId: number; }

export default function AssetBrowser() {
  const [assets, setAssets]  = useState<AssetItem[]>([]);
  const fileRef              = useRef<HTMLInputElement>(null);
  const selectedId           = useEditorStore(s => s.selectedId);

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
      if (texId >= 0) {
        setAssets(prev => [...prev, { name: file.name, url: URL.createObjectURL(file), texId }]);
      }
    }
    e.target.value = '';
  };

  const applyToSelected = (texId: number) => {
    if (selectedId === null) return;
    bridge.addMaterial(selectedId, texId);
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
        {selectedId === null && assets.length > 0 && (
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none' }}>— sélectionner une entité puis cliquer une texture</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, flex: 1, overflowY: 'auto' }}>
        {assets.map((a, i) => (
          <div
            key={i}
            title={`Appliquer ${a.name}`}
            onClick={() => applyToSelected(a.texId)}
            style={{ width: 64, cursor: 'pointer', textAlign: 'center' }}
          >
            <img src={a.url} alt={a.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)', display: 'block' }} />
            <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
