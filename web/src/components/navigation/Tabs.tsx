import { useState, type HTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export interface TabItem { value: string; label: string; icon?: string; count?: number }

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items?: Array<string | TabItem>;
  value?: string;
  onChange?: (value: string) => void;
}

/** Underlined tab row for switching views within a screen. */
export function Tabs({ items = [], value, onChange, style, ...rest }: TabsProps) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div role="tablist" {...rest} style={{ display: 'flex', gap: 'var(--space-7)', borderBottom: '1px solid var(--border-subtle)', ...style }}>
      {items.map((raw) => {
        const it: TabItem = typeof raw === 'string' ? { value: raw, label: raw } : raw;
        const on = it.value === value;
        return (
          <button
            key={it.value} role="tab" aria-selected={on} type="button"
            onClick={() => onChange?.(it.value)}
            onMouseEnter={() => setHover(it.value)} onMouseLeave={() => setHover(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 0 10px', background: 'none',
              border: 'none', borderBottom: '2px solid ' + (on ? 'var(--accent)' : 'transparent'), marginBottom: -1,
              font: 'var(--fw-medium) var(--fs-body-sm)/1 var(--font-body)',
              color: on ? 'var(--text-primary)' : hover === it.value ? 'var(--text-secondary)' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'var(--transition-control)',
            }}
          >
            {it.icon && <Icon name={it.icon} size={14} />}
            {it.label}
            {it.count != null && (
              <span style={{ font: 'var(--fw-regular) var(--fs-mono-xs)/1 var(--font-mono)', color: 'var(--text-faint)' }}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
