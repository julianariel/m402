import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

export type BadgeTone = 'neutral' | 'private' | 'public' | 'pending' | 'error';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** private = shielded/verified · public = on-chain/visible · pending = confirming · error = rejected */
  tone?: BadgeTone;
  /** Lucide icon name shown before the text. */
  icon?: string;
  /** Set false to keep the label's own casing (e.g. "eip155:8453"). */
  uppercase?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

const tones: Record<BadgeTone, { fg: string; bg: string; bd: string }> = {
  neutral: { fg: 'var(--text-secondary)', bg: 'transparent', bd: 'var(--border-default)' },
  private: { fg: 'var(--state-private)', bg: 'var(--state-private-bg)', bd: 'var(--shield-700)' },
  public: { fg: 'var(--state-public)', bg: 'var(--state-public-bg)', bd: 'var(--blue-800)' },
  pending: { fg: 'var(--state-pending)', bg: 'var(--state-pending-bg)', bd: '#5C4207' },
  error: { fg: 'var(--state-error)', bg: 'var(--state-error-bg)', bd: '#5C1414' },
};

/** Monospace status label. Reads as machine output, not decoration. */
export function Badge({ tone = 'neutral', icon, uppercase = true, children, style, ...rest }: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 20, padding: '0 7px',
        font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)',
        letterSpacing: 'var(--ls-label)',
        textTransform: uppercase ? 'uppercase' : 'none',
        color: t.fg, background: t.bg,
        border: '1px solid ' + t.bd, borderRadius: 'var(--radius-chip)',
        whiteSpace: 'nowrap', ...style,
      }}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}
