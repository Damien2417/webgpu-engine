import React from 'react';

interface Vec3InputProps {
  label:    string;
  value:    [number, number, number];
  onChange: (x: number, y: number, z: number) => void;
  step?:    number;
}

const BORDER = ['#e74c3c', '#2ecc71', '#3498db'];

export default function Vec3Input({ label, value, onChange, step = 0.1 }: Vec3InputProps) {
  const handle = (axis: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value) || 0;
    const next = [...value] as [number, number, number];
    next[axis] = v;
    onChange(next[0], next[1], next[2]);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
      <span style={{ width: 64, color: 'var(--text-dim)', flexShrink: 0, fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {[0, 1, 2].map(i => (
          <input
            key={i}
            type="number"
            step={step}
            value={parseFloat(value[i].toFixed(3))}
            onChange={handle(i)}
            style={{
              flex: 1, width: 0,
              background: 'var(--bg-deep)',
              border: `1px solid ${BORDER[i]}`,
              color: 'var(--text)',
              padding: '2px 4px',
              borderRadius: 2,
              fontSize: 11,
            }}
          />
        ))}
      </div>
    </div>
  );
}
