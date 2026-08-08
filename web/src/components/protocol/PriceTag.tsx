import type { HTMLAttributes } from 'react';

export type PriceTagSize = 'md' | 'lg';

export interface PriceTagProps extends HTMLAttributes<HTMLSpanElement> {
  /** USD figure as a string, e.g. "0.01". */
  usd: string;
  /** STAR figure as a string, e.g. "500". */
  star: string;
  size?: PriceTagSize;
  /** Replaces the value with the shielded placeholder — for amounts the viewer cannot see. */
  hidden?: boolean;
}

/** Dual-denomination price: USD display, STAR settlement. */
export function PriceTag({ usd, star, size = 'md', hidden = false, style, ...rest }: PriceTagProps) {
  const big = size === 'lg';
  if (hidden) {
    return (
      <span {...rest} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: 'var(--text-code)', color: 'var(--state-private)', ...style }}>
        <span style={{ letterSpacing: '.12em' }}>••••</span>
        <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--state-private)' }}>shielded</span>
      </span>
    );
  }
  return (
    <span {...rest} style={{ display: 'inline-flex', alignItems: 'baseline', gap: big ? 10 : 7, ...style }}>
      <span style={{ font: 'var(--fw-medium) ' + (big ? 'var(--fs-h3)' : 'var(--fs-mono)') + '/1 var(--font-mono)', letterSpacing: 'var(--ls-mono)', color: 'var(--text-primary)' }}>
        {usd} <span style={{ color: 'var(--text-muted)' }}>USD</span>
      </span>
      <span style={{ color: 'var(--border-strong)' }}>·</span>
      <span style={{ font: 'var(--fw-regular) ' + (big ? 'var(--fs-mono)' : 'var(--fs-mono-sm)') + '/1 var(--font-mono)', letterSpacing: 'var(--ls-mono)', color: 'var(--text-muted)' }}>
        {star} STAR
      </span>
    </span>
  );
}
