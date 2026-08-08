import type { HTMLAttributes, KeyboardEvent } from 'react';
import { Icon } from '../core/Icon';

export interface CheckboxProps extends Omit<HTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  /** Second line of quieter explanatory text. */
  description?: string;
  disabled?: boolean;
}

/** Square checkbox. Checked state is Midnight blue. */
export function Checkbox({ checked = false, onChange, label, description, disabled = false, style, ...rest }: CheckboxProps) {
  const toggle = () => !disabled && onChange?.(!checked);
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };
  return (
    <label
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'flex-start', gap: 'var(--space-3)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style,
      }}
    >
      <span
        role="checkbox" aria-checked={checked} tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
          width: 16, height: 16, marginTop: 1,
          background: checked ? 'var(--accent)' : 'var(--bg-inset)',
          border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-strong)'),
          borderRadius: 'var(--radius-xs)', transition: 'var(--transition-control)',
        }}
      >
        {checked && <Icon name="check" size={11} color="var(--accent-fg)" />}
      </span>
      {(label || description) && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {label && <span style={{ font: 'var(--fw-regular) var(--fs-body-sm)/1.35 var(--font-body)', color: 'var(--text-primary)' }}>{label}</span>}
          {description && <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.45 var(--font-body)', color: 'var(--text-muted)' }}>{description}</span>}
        </span>
      )}
    </label>
  );
}
