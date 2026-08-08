import { useState, type HTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export type HashChipTone = 'neutral' | 'private' | 'public';

export interface HashChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Full value; shown truncated, copied in full. */
  value: string;
  /** Leading characters kept. Default 6. */
  head?: number;
  /** Trailing characters kept. Default 4. */
  tail?: number;
  /** Small uppercase prefix, e.g. "NULLIFIER". */
  label?: string;
  /** private = shielded-derived · public = on-ledger */
  tone?: HashChipTone;
  copyable?: boolean;
}

function truncate(v: string, head: number, tail: number) {
  return v && v.length > head + tail + 1 ? v.slice(0, head) + '…' + v.slice(-tail) : v;
}

/** Truncated monospace hex — nullifiers, service ids, Lace addresses. */
export function HashChip({ value = '', head = 6, tail = 4, label, tone = 'neutral', copyable = true, style, ...rest }: HashChipProps) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  const fg = tone === 'private' ? 'var(--state-private)' : tone === 'public' ? 'var(--state-public)' : 'var(--text-secondary)';
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(value);
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };
  return (
    <span
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={value} {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 4px 0 7px',
        background: hover ? 'var(--bg-hover)' : 'var(--bg-inset)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-chip)',
        transition: 'var(--transition-control)', ...style,
      }}
    >
      {label && <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</span>}
      <span style={{ font: 'var(--text-code)', fontSize: 'var(--fs-mono-sm)', letterSpacing: 'var(--ls-mono)', color: fg }}>{truncate(value, head, tail)}</span>
      {copyable && (
        <span role="button" aria-label="Copy" onClick={copy} style={{ display: 'inline-flex', padding: 3, cursor: 'pointer', color: copied ? 'var(--state-private)' : 'var(--text-faint)' }}>
          <Icon name={copied ? 'check' : 'copy'} size={11} />
        </span>
      )}
    </span>
  );
}
