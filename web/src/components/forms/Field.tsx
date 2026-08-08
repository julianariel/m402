import type { HTMLAttributes, ReactNode } from 'react';

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  /** Helper text below the control; hidden while `error` is set. */
  hint?: string;
  /** Error message; replaces the hint and turns it red. */
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children?: ReactNode;
}

/** Label + help/error scaffold shared by every form control. */
export function Field({ label, hint, error, required = false, htmlFor, children, style, ...rest }: FieldProps) {
  return (
    <div {...rest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', ...style }}>
      {label && (
        <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'center', gap: 5, font: 'var(--text-label)', color: 'var(--text-secondary)' }}>
          {label}
          {required && <span style={{ color: 'var(--state-public)' }}>*</span>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.45 var(--font-body)', color: error ? 'var(--state-error)' : 'var(--text-muted)' }}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
