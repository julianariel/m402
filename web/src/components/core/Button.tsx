import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'shield' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** primary = blue fill · secondary = hairline · ghost = bare · shield = private action · danger = destructive */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon name shown before the label. */
  iconLeft?: string;
  /** Lucide icon name shown after the label. */
  iconRight?: string;
  /** Swaps the leading icon for a spinner and blocks interaction. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

const sizes: Record<ButtonSize, { h: string; pad: string; fs: string; gap: number; icon: number }> = {
  sm: { h: 'var(--control-h-sm)', pad: '0 10px', fs: 'var(--fs-body-sm)', gap: 6, icon: 13 },
  md: { h: 'var(--control-h-md)', pad: '0 14px', fs: 'var(--fs-body-sm)', gap: 7, icon: 15 },
  lg: { h: 'var(--control-h-lg)', pad: '0 20px', fs: 'var(--fs-body)', gap: 8, icon: 16 },
};

const variants: Record<ButtonVariant, { rest: CSSProperties; hover: CSSProperties }> = {
  primary: {
    rest: { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' },
    hover: { background: 'var(--accent-hover)', borderColor: 'var(--accent-hover)' },
  },
  secondary: {
    rest: { background: 'transparent', color: 'var(--text-primary)', borderColor: 'var(--border-default)' },
    hover: { background: 'var(--bg-hover)', borderColor: 'var(--border-strong)' },
  },
  ghost: {
    rest: { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'transparent' },
    hover: { background: 'var(--bg-hover)', color: 'var(--text-primary)' },
  },
  shield: {
    rest: { background: 'var(--state-private-bg)', color: 'var(--state-private)', borderColor: 'var(--shield-700)' },
    hover: { background: 'var(--shield-tint)', borderColor: 'var(--state-private)' },
  },
  danger: {
    rest: { background: 'transparent', color: 'var(--state-error)', borderColor: 'var(--red-tint)' },
    hover: { background: 'var(--state-error-bg)', borderColor: 'var(--state-error)' },
  },
};

/** The m402 action control: hairline box, 3px radius, no gradient. */
export function Button({
  variant = 'primary', size = 'md', iconLeft, iconRight, loading = false,
  disabled = false, fullWidth = false, children, style, ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const s = sizes[size];
  const v = variants[variant];
  const off = disabled || loading;

  return (
    <button
      type="button"
      disabled={off}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setDown(false); }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      {...rest}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined,
        alignItems: 'center', justifyContent: 'center', gap: s.gap,
        height: s.h, padding: s.pad,
        font: 'var(--fw-medium) ' + s.fs + '/1 var(--font-body)',
        borderRadius: 'var(--radius-control)', borderStyle: 'solid', borderWidth: 'var(--border-w)',
        cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.42 : 1,
        transform: down && !off ? 'translateY(1px)' : 'none',
        transition: 'var(--transition-control), transform var(--dur-instant) var(--ease-standard)',
        whiteSpace: 'nowrap',
        ...v.rest, ...(hover && !off ? v.hover : null), ...style,
      }}
    >
      {loading && <Icon name="loader-circle" size={s.icon} spin />}
      {!loading && iconLeft && <Icon name={iconLeft} size={s.icon} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.icon} />}
    </button>
  );
}
