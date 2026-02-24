import React from 'react';

interface Props {
  title: string;
  onRemove?: () => void;
  children: React.ReactNode;
  enabled?: boolean;
  onToggle?: () => void;
}

export default function PanelSection({ title, onRemove, children, enabled = true, onToggle }: Props) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onToggle && (
            <input
              type="checkbox"
              checked={enabled}
              onChange={onToggle}
              style={{ cursor: 'pointer', marginRight: 4 }}
              onClick={e => e.stopPropagation()}
            />
          )}
          <span>{title}</span>
        </div>
        {onRemove && (
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
        )}
      </div>
      {enabled && <div style={{ padding: '6px 8px' }}>{children}</div>}
    </div>
  );
}
