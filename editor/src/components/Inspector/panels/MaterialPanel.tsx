import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, MaterialData } from '../../../engine/types';

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: 11, gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', width: 70, flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 80 }}
      />
      <span style={{ color: 'var(--text-dim)', width: 32, textAlign: 'right' }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export default function MaterialPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const mat: MaterialData = getComponents(entityId).material ?? {
    texId: -1, metallic: 0.0, roughness: 0.5, emissive: [0, 0, 0],
  };

  const apply = (next: MaterialData) => {
    setComponent(entityId, 'material', next);
    if (next.texId >= 0) {
      bridge.addPbrMaterial(entityId, next.texId, next.metallic, next.roughness);
    }
    bridge.setEmissive(entityId, next.emissive[0], next.emissive[1], next.emissive[2]);
  };

  return (
    <PanelSection title="Material (PBR)" onRemove={() => removeComponent(entityId, 'material')}>
      <SliderRow label="Metallic"   value={mat.metallic}   min={0} max={1} step={0.01} onChange={v => apply({ ...mat, metallic: v })} />
      <SliderRow label="Roughness"  value={mat.roughness}  min={0} max={1} step={0.01} onChange={v => apply({ ...mat, roughness: v })} />
      <SliderRow label="Emissive R" value={mat.emissive[0]} min={0} max={1} step={0.01} onChange={v => apply({ ...mat, emissive: [v, mat.emissive[1], mat.emissive[2]] })} />
      <SliderRow label="Emissive G" value={mat.emissive[1]} min={0} max={1} step={0.01} onChange={v => apply({ ...mat, emissive: [mat.emissive[0], v, mat.emissive[2]] })} />
      <SliderRow label="Emissive B" value={mat.emissive[2]} min={0} max={1} step={0.01} onChange={v => apply({ ...mat, emissive: [mat.emissive[0], mat.emissive[1], v] })} />
    </PanelSection>
  );
}
