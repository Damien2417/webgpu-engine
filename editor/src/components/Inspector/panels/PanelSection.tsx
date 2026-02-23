import React from 'react';

interface Props {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}

export default function PanelSection({ title, onRemove, children }: Props) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        background: 'var(--bg-header)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text)',
      }}>
        <span>{title}</span>
        <button
          onClick={onRemove}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 10,
            padding: '0 2px',
          }}
          title="Remove component"
        >
          ✕
        </button>
      </div>
      <div style={{ padding: '6px 8px' }}>
        {children}
      </div>
    </div>
  );
}
