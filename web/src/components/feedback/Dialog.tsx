import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { IconButton } from '../core/IconButton';

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  title?: string;
  subtitle?: string;
  /** Omit to make the dialog non-dismissible (e.g. while a proof is generating). */
  onClose?: () => void;
  /** Right-aligned action row under a hairline. */
  footer?: ReactNode;
  /** Max width in px. Default 480. */
  width?: number;
  children?: ReactNode;
}

/** Centred modal over a dimmed canvas. */
export function Dialog({ open = false, title, subtitle, onClose, footer, width = 480, children, style, ...rest }: DialogProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-7)', background: 'var(--bg-scrim)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
      }}
    >
      <div
        role="dialog" aria-modal="true" onClick={(e: MouseEvent) => e.stopPropagation()} {...rest}
        style={{
          width: '100%', maxWidth: width, background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-surface)',
          boxShadow: 'var(--shadow-lg)', ...style,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-6) var(--space-6) var(--space-5)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h2 style={{ margin: 0, font: 'var(--text-h3)', letterSpacing: 'var(--ls-heading)', color: 'var(--text-primary)' }}>{title}</h2>}
            {subtitle && <p style={{ margin: '6px 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/1.5 var(--font-body)', color: 'var(--text-muted)' }}>{subtitle}</p>}
          </div>
          {onClose && <IconButton icon="x" label="Close" onClick={onClose} />}
        </div>
        <div style={{ padding: '0 var(--space-6) var(--space-6)' }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-5) var(--space-6)', borderTop: '1px solid var(--border-subtle)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
