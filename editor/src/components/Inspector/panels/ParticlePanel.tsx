import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { registerEmitter, unregisterEmitter } from '../../../engine/particleSystem';
import type { EntityId, ParticleData } from '../../../engine/types';

const defaultParticle: ParticleData = {
  rate: 20,
  lifetime: 1.8,
  speed: 3,
  spread: 0.3,
  gravity: 2,
  sizeStart: 0.16,
  sizeEnd: 0.02,
  colorStart: [1.0, 0.65, 0.15],
  colorEnd: [0.9, 0.1, 0.0],
};

function normalizeParticle(input: any): ParticleData {
  return {
    rate: typeof input?.rate === 'number' ? input.rate : defaultParticle.rate,
    lifetime: typeof input?.lifetime === 'number' ? input.lifetime : defaultParticle.lifetime,
    speed: typeof input?.speed === 'number' ? input.speed : defaultParticle.speed,
    spread: typeof input?.spread === 'number' ? input.spread : defaultParticle.spread,
    gravity: typeof input?.gravity === 'number' ? input.gravity : defaultParticle.gravity,
    sizeStart: typeof input?.sizeStart === 'number' ? input.sizeStart : 0.1,
    sizeEnd: typeof input?.sizeEnd === 'number' ? input.sizeEnd : 0.0,
    colorStart: Array.isArray(input?.colorStart)
      ? input.colorStart
      : (Array.isArray(input?.color) ? input.color : defaultParticle.colorStart),
    colorEnd: Array.isArray(input?.colorEnd)
      ? input.colorEnd
      : (Array.isArray(input?.color) ? input.color : defaultParticle.colorEnd),
  };
}

export default function ParticlePanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const cfg: ParticleData = normalizeParticle(getComponents(entityId).particle ?? defaultParticle);

  const apply = (next: ParticleData) => {
    setComponent(entityId, 'particle', next);
    registerEmitter(entityId, next);
  };

  React.useEffect(() => {
    registerEmitter(entityId, cfg);
    return () => unregisterEmitter(entityId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, cfg]);

  const row = (
    label: string,
    key: 'rate' | 'lifetime' | 'speed' | 'spread' | 'gravity' | 'sizeStart' | 'sizeEnd',
    min: number,
    max: number,
    step: number
  ) => (
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
      {row('Size Start', 'sizeStart', 0.01, 2, 0.01)}
      {row('Size End',   'sizeEnd',   0, 2, 0.01)}

      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Color Start</span>
        <input
          type="color"
          value={`#${cfg.colorStart.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`}
          onChange={(e) => {
            const hex = e.target.value;
            apply({
              ...cfg,
              colorStart: [
                parseInt(hex.slice(1, 3), 16) / 255,
                parseInt(hex.slice(3, 5), 16) / 255,
                parseInt(hex.slice(5, 7), 16) / 255,
              ],
            });
          }}
          style={{ width: 36, height: 20, border: 'none', padding: 0, background: 'transparent' }}
        />
      </div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Color End</span>
        <input
          type="color"
          value={`#${cfg.colorEnd.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`}
          onChange={(e) => {
            const hex = e.target.value;
            apply({
              ...cfg,
              colorEnd: [
                parseInt(hex.slice(1, 3), 16) / 255,
                parseInt(hex.slice(3, 5), 16) / 255,
                parseInt(hex.slice(5, 7), 16) / 255,
              ],
            });
          }}
          style={{ width: 36, height: 20, border: 'none', padding: 0, background: 'transparent' }}
        />
      </div>
    </PanelSection>
  );
}
