import { useState, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { Icon } from './Icon';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'outline';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** Lucide icon name. */
  icon: string;
  /** Accessible name, also shown as the native tooltip. */
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  style?: CSSProperties;
}

const dims: Record<IconButtonSize, number> = { sm: 24, md: 30, lg: 36 };
const glyph: Record<IconButtonSize, number> = { sm: 13, md: 15, lg: 17 };

/** Square icon-only control for toolbars, table rows and dialog dismissal. */
export function IconButton({ icon, label, size = 'md', variant = 'ghost', disabled = false, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const bordered = variant === 'outline';
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: dims[size], height: dims[size], padding: 0,
        background: hover && !disabled ? 'var(--bg-hover)' : 'transparent',
        color: hover && !disabled ? 'var(--text-primary)' : 'var(--text-muted)',
        border: '1px solid ' + (bordered ? 'var(--border-default)' : 'transparent'),
        borderRadius: 'var(--radius-control)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'var(--transition-control)', ...style,
      }}
    >
      <Icon name={icon} size={glyph[size]} />
    </button>
  );
}
