import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
  /** Renders a trailing dismiss affordance. */
  onRemove?: () => void;
  /** Selected state, for filter rows. */
  active?: boolean;
  icon?: string;
  style?: CSSProperties;
}

/** Removable classification chip for filters and service categories. */
export function Tag({ children, onRemove, active = false, icon, style, ...rest }: TagProps) {
  const [hover, setHover] = useState(false);
  const interactive = !!rest.onClick;
  return (
    <span
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 24, padding: onRemove ? '0 4px 0 9px' : '0 9px',
        font: 'var(--fw-medium) var(--fs-caption)/1 var(--font-body)',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'var(--bg-active)' : hover && interactive ? 'var(--bg-hover)' : 'transparent',
        border: '1px solid ' + (active ? 'var(--border-strong)' : 'var(--border-subtle)'),
        borderRadius: 'var(--radius-chip)',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'var(--transition-control)', ...style,
      }}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
      {onRemove && (
        <span
          role="button" aria-label="Remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ display: 'inline-flex', padding: 3, cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          <Icon name="x" size={11} />
        </span>
      )}
    </span>
  );
}
