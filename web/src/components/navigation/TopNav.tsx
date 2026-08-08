import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../core/Icon';
import { StatusDot, type StatusDotTone } from '../core/StatusDot';

export interface NavItem { value: string; label: string; icon?: string }

export interface TopNavProps extends HTMLAttributes<HTMLElement> {
  items?: Array<string | NavItem>;
  active?: string;
  onNavigate?: (value: string) => void;
  /** Network label, e.g. "Preview". */
  network?: string;
  networkTone?: StatusDotTone;
  /** Right-hand slot — usually a wallet Button. */
  right?: ReactNode;
}

/** Product header: wordmark, section links, network state, wallet slot. */
export function TopNav({ items = [], active, onNavigate, network = 'Preview', networkTone = 'live', right, style, ...rest }: TopNavProps) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <header
      {...rest}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-8)', height: 56, padding: '0 var(--space-7)',
        background: 'rgba(10,10,10,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)', ...style,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, font: 'var(--fw-bold) 18px/1 var(--font-mono)', letterSpacing: '-0.04em', color: 'var(--text-primary)' }}>
        m<span style={{ color: 'var(--accent)' }}>402</span>
      </span>
      <nav style={{ display: 'flex', gap: 'var(--space-6)', flex: 1 }}>
        {items.map((raw) => {
          const it: NavItem = typeof raw === 'string' ? { value: raw, label: raw } : raw;
          const on = it.value === active;
          return (
            <button
              key={it.value} type="button"
              onClick={() => onNavigate?.(it.value)}
              onMouseEnter={() => setHover(it.value)} onMouseLeave={() => setHover(null)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0,
                font: 'var(--fw-medium) var(--fs-body-sm)/1 var(--font-body)',
                color: on ? 'var(--text-primary)' : hover === it.value ? 'var(--text-secondary)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'var(--transition-control)',
              }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}{it.label}
            </button>
          );
        })}
      </nav>
      <StatusDot tone={networkTone} label={network} />
      {right}
    </header>
  );
}
