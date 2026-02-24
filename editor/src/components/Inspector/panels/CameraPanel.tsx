import React from 'react';
import PanelSection from './PanelSection';
import { useComponentStore } from '../../../store/componentStore';
import { bridge } from '../../../engine/engineBridge';
import type { EntityId, CameraData } from '../../../engine/types';

export default function CameraPanel({ entityId }: { entityId: EntityId }) {
  const { getComponents, setComponent, removeComponent } = useComponentStore();
  const cam: CameraData = getComponents(entityId).camera ?? {
    fov: 60, near: 0.1, far: 1000, isActive: false, followEntity: true,
  };

  const apply = (next: CameraData) => {
    setComponent(entityId, 'camera', next);
    bridge.addCamera(entityId, next.fov, next.near, next.far);
    bridge.setCameraFollowEntity(entityId, next.followEntity);
    if (next.isActive) bridge.setActiveCamera(entityId);
    else if (cam.isActive && !next.isActive) bridge.removeActiveCamera();
  };

  return (
    <PanelSection title="Camera" onRemove={() => {
      removeComponent(entityId, 'camera');
      bridge.removeActiveCamera();
    }}>
      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>FOV</span>
        <input type="range" min={10} max={120} step={1} value={cam.fov}
          onChange={e => apply({ ...cam, fov: +e.target.value })} style={{ width:80 }} />
        <span style={{ color:'var(--text-dim)', width:32, textAlign:'right' }}>{cam.fov}deg</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:3, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Near</span>
        <input type="number" value={cam.near} step={0.01} min={0.001}
          onChange={e => apply({ ...cam, near: +e.target.value })}
          style={{ width:70, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'1px 4px', fontSize:11 }} />
      </div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:6, fontSize:11, gap:4 }}>
        <span style={{ color:'var(--text-dim)', width:70, flexShrink:0 }}>Far</span>
        <input type="number" value={cam.far} step={1} min={1}
          onChange={e => apply({ ...cam, far: +e.target.value })}
          style={{ width:70, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'1px 4px', fontSize:11 }} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => apply({ ...cam, isActive: !cam.isActive })}
          style={{ fontSize:11, padding:'2px 10px', borderRadius:3, border:'1px solid var(--border)', cursor:'pointer',
            background: cam.isActive ? 'var(--accent)' : 'var(--bg-hover)',
            color: cam.isActive ? '#000' : 'var(--text)' }}
        >
          {cam.isActive ? 'Active Camera' : 'Set Active'}
        </button>
        <button
          onClick={() => apply({ ...cam, followEntity: !cam.followEntity })}
          style={{ fontSize:11, padding:'2px 10px', borderRadius:3, border:'1px solid var(--border)', cursor:'pointer',
            background: cam.followEntity ? 'var(--bg-select)' : 'var(--bg-hover)',
            color: 'var(--text)' }}
          title="Follow Entity: camera inherits this entity transform; Independent: uses free camera"
        >
          {cam.followEntity ? 'Follow Entity' : 'Independent'}
        </button>
      </div>
    </PanelSection>
  );
}
