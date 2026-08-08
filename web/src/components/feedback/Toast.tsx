import type { HTMLAttributes } from 'react';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';

export type ToastTone = 'info' | 'success' | 'pending' | 'error';

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  /** pending spins its icon — use it for indexer waits and proof generation. */
  tone?: ToastTone;
  title: string;
  detail?: string;
  onDismiss?: () => void;
}

const tones: Record<ToastTone, { fg: string; bd: string; icon: string }> = {
  info: { fg: 'var(--text-primary)', bd: 'var(--border-strong)', icon: 'info' },
  success: { fg: 'var(--state-private)', bd: 'var(--shield-700)', icon: 'circle-check' },
  pending: { fg: 'var(--state-pending)', bd: '#5C4207', icon: 'loader-circle' },
  error: { fg: 'var(--state-error)', bd: '#5C1414', icon: 'triangle-alert' },
};

/** Transient notification. Anchor a stack of these bottom-right. */
export function Toast({ tone = 'info', title, detail, onDismiss, style, ...rest }: ToastProps) {
  const t = tones[tone];
  return (
    <div
      role="status" {...rest}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', width: 340, padding: 'var(--space-4) var(--space-4) var(--space-4) var(--space-5)',
        background: 'var(--bg-raised)', border: '1px solid ' + t.bd, borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-md)', ...style,
      }}
    >
      <Icon name={t.icon} size={15} color={t.fg} spin={tone === 'pending'} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: 'var(--fw-medium) var(--fs-body-sm)/1.35 var(--font-body)', color: 'var(--text-primary)' }}>{title}</div>
        {detail && <div style={{ marginTop: 3, font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-muted)' }}>{detail}</div>}
      </div>
      {onDismiss && <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  );
}
