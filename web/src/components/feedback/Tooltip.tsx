import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'content'> {
  content: ReactNode;
  side?: TooltipSide;
  children?: ReactNode;
}

const positions: Record<TooltipSide, CSSProperties> = {
  top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
  bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
  left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
  right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
};

/** Hover explanation for protocol jargon. Dark chip, hairline border, no arrow. */
export function Tooltip({ content, side = 'top', children, style, ...rest }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const pos = positions[side];
  return (
    <span
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      {...rest}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
    >
      {children}
      {open && (
        <span role="tooltip" style={{
          position: 'absolute', zIndex: 200, ...pos,
          maxWidth: 260, width: 'max-content', padding: '6px 9px',
          background: 'var(--bg-raised)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xs)',
          font: 'var(--fw-regular) var(--fs-caption)/1.45 var(--font-body)', color: 'var(--text-secondary)',
          boxShadow: 'var(--shadow-md)', pointerEvents: 'none',
        }}>{content}</span>
      )}
    </span>
  );
}
