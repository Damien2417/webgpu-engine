import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { registerEmitter, unregisterEmitter } from '../../../engine/particleSystem';
import type { EntityId, ParticleData } from '../../../engine/types';

const defaultParticle: ParticleData = {
  rate: 10, lifetime: 2, speed: 3, spread: 0.3, gravity: 2, color: [1, 0.5, 0],
};

export default function ParticlePanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const cfg: ParticleData = getComponents(entityId).particle ?? defaultParticle;

  const apply = (next: ParticleData) => {
    setComponent(entityId, 'particle', next);
    registerEmitter(entityId, next);
  };

  React.useEffect(() => {
    registerEmitter(entityId, cfg);
    return () => unregisterEmitter(entityId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, cfg]);

  const row = (label: string, key: keyof ParticleData, min: number, max: number, step: number) => (
    <div key={key} style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
      <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={cfg[key] as number}
        onChange={e => apply({ ...cfg, [key]: +e.target.value })} style={{ width:80 }} />
      <span style={{ color:'var(--text-dim)', width:32, textAlign:'right' }}>
        {(cfg[key] as number).toFixed(step < 1 ? 2 : 0)}
      </span>
    </div>
  );

  return (
    <PanelSection title="Particle Emitter" onRemove={() => {
      unregisterEmitter(entityId);
      removeComponent(entityId, 'particle');
    }}>
      {row('Rate/s',   'rate',     1,  100, 1)}
      {row('Lifetime', 'lifetime', 0.1, 10, 0.1)}
      {row('Speed',    'speed',    0.1, 20, 0.1)}
      {row('Spread',   'spread',   0,   1,  0.05)}
      {row('Gravity',  'gravity',  0,   20, 0.1)}
    </PanelSection>
  );
}
