import React, { useState } from 'react';
import { bridge } from '../../../engine/engineBridge';
import { useSceneStore } from '../../../store/sceneStore';
import type { EntityId } from '../../../engine/types';

export default function TagField({ entityId }: { entityId: EntityId }) {
  const refresh = useSceneStore(s => s.refresh);
  const [tag, setTag] = useState(() => bridge.getTag(entityId));

  const commit = (value: string) => {
    bridge.setTag(entityId, value);
    setTag(value);
    refresh();
  };

  return (
    <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
      <span style={{ color:'var(--text-dim)', width:35, flexShrink:0 }}>Tag</span>
      <input
        value={tag}
        onChange={e => setTag(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        placeholder="Untagged"
        style={{ flex:1, background:'var(--bg-hover)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:3, padding:'2px 6px', fontSize:11 }}
      />
    </div>
  );
}
