import type { HTMLAttributes, KeyboardEvent } from 'react';

export type SwitchTone = 'accent' | 'private';

export interface SwitchProps extends Omit<HTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  /** accent = blue · private = shield green, for privacy-scoped toggles */
  tone?: SwitchTone;
  disabled?: boolean;
}

/** Binary toggle for view-level settings. */
export function Switch({ checked = false, onChange, label, tone = 'accent', disabled = false, style, ...rest }: SwitchProps) {
  const on = tone === 'private' ? 'var(--state-private)' : 'var(--accent)';
  const toggle = () => !disabled && onChange?.(!checked);
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };
  return (
    <label {...rest} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-4)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <span
        role="switch" aria-checked={checked} tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative', flex: '0 0 auto', width: 34, height: 18,
          background: checked ? on : 'var(--ink-700)',
          border: '1px solid ' + (checked ? on : 'var(--border-strong)'),
          borderRadius: 'var(--radius-pill)', transition: 'var(--transition-control)',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2, width: 12, height: 12,
          background: checked ? (tone === 'private' ? 'var(--ink-1000)' : 'var(--m-white)') : 'var(--ink-300)',
          borderRadius: 'var(--radius-pill)', transition: 'left var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard)',
        }} />
      </span>
      {label && <span style={{ font: 'var(--fw-regular) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-secondary)' }}>{label}</span>}
    </label>
  );
}
