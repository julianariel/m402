import { useState, type SelectHTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export interface SelectOption { value: string; label: string }
export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> {
  /** Plain strings or {value,label} pairs. */
  options?: Array<string | SelectOption>;
  value?: string;
  onChange?: (value: string) => void;
  size?: SelectSize;
}

const heights: Record<SelectSize, string> = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };

/** Native select styled to match Input. */
export function Select({ options = [], value, onChange, size = 'md', disabled = false, style, ...rest }: SelectProps) {
  const [focus, setFocus] = useState(false);
  const h = heights[size];
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', height: h,
      background: 'var(--bg-inset)', border: '1px solid ' + (focus ? 'var(--border-focus)' : 'var(--border-default)'),
      borderRadius: 'var(--radius-control)', opacity: disabled ? 0.5 : 1,
      transition: 'var(--transition-control)', ...style,
    }}>
      <select
        value={value} disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...rest}
        style={{
          appearance: 'none', WebkitAppearance: 'none', width: '100%', height: '100%',
          background: 'transparent', border: 'none', outline: 'none',
          padding: '0 30px 0 10px', color: 'var(--text-primary)',
          font: 'var(--fw-regular) var(--fs-body)/1 var(--font-body)', cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value} style={{ background: 'var(--ink-900)' }}>{opt.label}</option>;
        })}
      </select>
      <Icon name="chevron-down" size={14} color="var(--text-muted)" style={{ position: 'absolute', right: 9, pointerEvents: 'none' }} />
    </div>
  );
}
