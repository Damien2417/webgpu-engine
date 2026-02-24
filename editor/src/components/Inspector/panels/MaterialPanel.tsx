import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { useAssetStore } from '../../../store/assetStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, MaterialData } from '../../../engine/types';

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} style={{ width: 80 }} />
      <span style={{ color: 'var(--text-dim)', width: 32, textAlign: 'right' }}>{value.toFixed(2)}</span>
    </div>
  );
}

function ColorRow({ label, r, g, b, onChange }: {
  label: string; r: number; g: number; b: number;
  onChange: (r: number, g: number, b: number) => void;
}) {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  const hexColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>{label}</span>
      <input
        type="color"
        value={hexColor}
        onChange={e => {
          const hex = e.target.value;
          const nr = parseInt(hex.slice(1,3), 16) / 255;
          const ng = parseInt(hex.slice(3,5), 16) / 255;
          const nb = parseInt(hex.slice(5,7), 16) / 255;
          onChange(nr, ng, nb);
        }}
        style={{ width: 40, height: 22, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3 }}
      />
      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{hexColor}</span>
    </div>
  );
}

export default function MaterialPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const assets = useAssetStore(s => s.assets);
  const mat: MaterialData = getComponents(entityId).material ?? {
    texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0],
  };

  const apply = (next: MaterialData) => {
    setComponent(entityId, 'material', next);
    bridge.addPbrMaterial(entityId, next.texId, next.metallic, next.roughness);
    bridge.setEmissive(entityId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  return (
    <PanelSection title="Material (PBR)" onRemove={() => removeComponent(entityId, 'material')}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 11, gap: 4 }}>
        <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>Albedo</span>
        <select
          value={mat.texId}
          onChange={e => apply({ ...mat, texId: parseInt(e.target.value) })}
          style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '2px 4px', fontSize: 11 }}
        >
          <option value={-1}>None (white)</option>
          {assets.map(a => (
            <option key={a.texId} value={a.texId}>{a.name}</option>
          ))}
        </select>
      </div>
      <SliderRow label="Metallic"  value={mat.metallic}  min={0} max={1} step={0.01} onChange={v => apply({ ...mat, metallic: v })} />
      <SliderRow label="Roughness" value={mat.roughness} min={0} max={1} step={0.01} onChange={v => apply({ ...mat, roughness: v })} />
      <ColorRow  label="Emissive"  r={mat.emissive[0]} g={mat.emissive[1]} b={mat.emissive[2]}
        onChange={(r,g,b) => apply({ ...mat, emissive: [r,g,b] })} />
    </PanelSection>
  );
}
