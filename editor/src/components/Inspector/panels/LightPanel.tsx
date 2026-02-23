import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, PointLightData, DirectionalLightData } from '../../../engine/types';

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

export default function LightPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const c = getComponents(entityId);

  if (c.pointLight !== undefined) {
    const pl: PointLightData = c.pointLight;

    const apply = (next: PointLightData) => {
      setComponent(entityId, 'pointLight', next);
      bridge.addPointLight(entityId, next.r, next.g, next.b, next.intensity);
    };

    return (
      <PanelSection title="Point Light" onRemove={() => removeComponent(entityId, 'pointLight')}>
        <SliderRow label="Intensity" value={pl.intensity} min={0} max={20} step={0.1}  onChange={v => apply({ ...pl, intensity: v })} />
        <SliderRow label="R"         value={pl.r}         min={0} max={1}  step={0.01} onChange={v => apply({ ...pl, r: v })} />
        <SliderRow label="G"         value={pl.g}         min={0} max={1}  step={0.01} onChange={v => apply({ ...pl, g: v })} />
        <SliderRow label="B"         value={pl.b}         min={0} max={1}  step={0.01} onChange={v => apply({ ...pl, b: v })} />
      </PanelSection>
    );
  }

  if (c.directionalLight !== undefined) {
    const dl: DirectionalLightData = c.directionalLight;

    const apply = (next: DirectionalLightData) => {
      setComponent(entityId, 'directionalLight', next);
      bridge.addDirectionalLight(next.dx, next.dy, next.dz, next.r, next.g, next.b, next.intensity);
    };

    return (
      <PanelSection title="Directional Light" onRemove={() => removeComponent(entityId, 'directionalLight')}>
        <SliderRow label="Intensity" value={dl.intensity} min={0} max={5}  step={0.05} onChange={v => apply({ ...dl, intensity: v })} />
        <SliderRow label="Dir X"     value={dl.dx}        min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dx: v })} />
        <SliderRow label="Dir Y"     value={dl.dy}        min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dy: v })} />
        <SliderRow label="Dir Z"     value={dl.dz}        min={-1} max={1} step={0.01} onChange={v => apply({ ...dl, dz: v })} />
        <SliderRow label="R"         value={dl.r}         min={0} max={1}  step={0.01} onChange={v => apply({ ...dl, r: v })} />
        <SliderRow label="G"         value={dl.g}         min={0} max={1}  step={0.01} onChange={v => apply({ ...dl, g: v })} />
        <SliderRow label="B"         value={dl.b}         min={0} max={1}  step={0.01} onChange={v => apply({ ...dl, b: v })} />
      </PanelSection>
    );
  }

  return null;
}
