import type { CSSProperties, HTMLAttributes } from 'react';

export type StatusDotTone = 'live' | 'confirming' | 'offline' | 'error' | 'chain';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  /** live = green · confirming = amber, pulsing · chain = blue · offline = grey · error = red */
  tone?: StatusDotTone;
  /** Optional text rendered beside the dot. */
  label?: string;
  /** Diameter in px. Default 6. */
  size?: number;
  style?: CSSProperties;
}

const tones: Record<StatusDotTone, string> = {
  live: 'var(--state-private)',
  confirming: 'var(--state-pending)',
  offline: 'var(--text-faint)',
  error: 'var(--state-error)',
  chain: 'var(--state-public)',
};

/** 6px state indicator. Pulses while pending. */
export function StatusDot({ tone = 'live', label, size = 6, style, ...rest }: StatusDotProps) {
  const c = tones[tone];
  const dot = (
    <span
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: 'var(--radius-pill)',
        background: c, boxShadow: '0 0 8px -1px ' + c,
        animation: tone === 'confirming' ? 'm402-pulse 1.2s var(--ease-standard) infinite' : undefined,
      }}
    />
  );
  if (!label) return <span {...rest} style={{ display: 'inline-flex', ...style }}>{dot}</span>;
  return (
    <span {...rest} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: 'var(--fw-regular) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-secondary)', ...style }}>
      {dot}{label}
    </span>
  );
}
