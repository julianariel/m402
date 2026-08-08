import { useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  size?: InputSize;
  /** Render the value in Space Mono — use for URLs, addresses, amounts, hashes. */
  mono?: boolean;
  /** Static text before the value, e.g. "$" or "https://". */
  prefix?: string;
  /** Unit label after the value, e.g. "STAR". */
  suffix?: string;
  /** Leading Lucide icon name. */
  icon?: string;
  invalid?: boolean;
  /** Receives the next string value, then the raw event. */
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
}

const heights: Record<InputSize, string> = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };

/** Single-line text field. Use `mono` for anything the chain reads back. */
export function Input({
  size = 'md', mono = false, prefix, suffix, icon, invalid = false,
  disabled = false, value, onChange, style, ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false);
  const border = invalid ? 'var(--state-error)' : focus ? 'var(--border-focus)' : 'var(--border-default)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, height: heights[size], padding: '0 10px',
      background: 'var(--bg-inset)', border: '1px solid ' + border, borderRadius: 'var(--radius-control)',
      boxShadow: focus ? '0 0 0 3px rgba(0,0,254,.22)' : 'none',
      opacity: disabled ? 0.5 : 1, transition: 'var(--transition-control), box-shadow var(--dur-fast) var(--ease-standard)',
      ...style,
    }}>
      {icon && <Icon name={icon} size={14} color="var(--text-muted)" />}
      {prefix && <span style={{ font: 'var(--text-code)', color: 'var(--text-muted)' }}>{prefix}</span>}
      <input
        value={value} disabled={disabled}
        onChange={(e) => onChange?.(e.target.value, e)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...rest}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', padding: 0,
          color: 'var(--text-primary)',
          font: mono ? 'var(--text-code)' : 'var(--fw-regular) var(--fs-body)/1 var(--font-body)',
          letterSpacing: mono ? 'var(--ls-mono)' : 'var(--ls-body)',
        }}
      />
      {suffix && <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', color: 'var(--text-faint)' }}>{suffix}</span>}
    </div>
  );
}
