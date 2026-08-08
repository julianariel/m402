import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../core/Icon';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Lucide icon name. Default "layers". */
  icon?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}

/** Placeholder for an empty list, panel or result set. */
export function EmptyState({ icon = 'layers', title, detail, action, style, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-4)',
      padding: 'var(--space-11) var(--space-7)',
      border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-card)', ...style,
    }}>
      <Icon name={icon} size={22} color="var(--text-faint)" />
      <div style={{ font: 'var(--fw-medium) var(--fs-body)/1.3 var(--font-body)', color: 'var(--text-secondary)' }}>{title}</div>
      {detail && <div style={{ maxWidth: 360, font: 'var(--fw-regular) var(--fs-body-sm)/1.55 var(--font-body)', color: 'var(--text-muted)' }}>{detail}</div>}
      {action && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </div>
  );
}
