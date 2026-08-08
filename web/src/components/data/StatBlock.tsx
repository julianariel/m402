import type { HTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export type StatBlockTone = 'default' | 'accent' | 'private';

export interface StatBlockProps extends HTMLAttributes<HTMLDivElement> {
  /** Uppercase mono caption above the figure. */
  label: string;
  value: string | number;
  /** Unit suffix, e.g. "STAR" or "ms". */
  unit?: string;
  /** Quiet line below, e.g. "public — moves only on deposit". */
  delta?: string;
  icon?: string;
  tone?: StatBlockTone;
}

/** Single headline figure with a mono label. */
export function StatBlock({ label, value, unit, delta, icon, tone = 'default', style, ...rest }: StatBlockProps) {
  const fg = tone === 'private' ? 'var(--state-private)' : tone === 'accent' ? 'var(--state-public)' : 'var(--text-primary)';
  return (
    <div {...rest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', ...style }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
        {icon && <Icon name={icon} size={11} />}{label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ font: 'var(--fw-bold) var(--fs-h1)/1 var(--font-display)', letterSpacing: 'var(--ls-display)', fontVariationSettings: '"wdth" var(--display-wdth)', color: fg }}>{value}</span>
        {unit && <span style={{ font: 'var(--fw-regular) var(--fs-mono-sm)/1 var(--font-mono)', color: 'var(--text-muted)' }}>{unit}</span>}
      </span>
      {delta && <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-body)', color: 'var(--text-muted)' }}>{delta}</span>}
    </div>
  );
}
