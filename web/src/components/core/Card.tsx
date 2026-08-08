import { useState, type HTMLAttributes, type ReactNode } from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardTone = 'surface' | 'raised' | 'inset';
export type CardAccent = 'accent' | 'private' | 'pending';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  /** surface = default · raised = one step lighter · inset = darker than canvas */
  tone?: CardTone;
  /** Border brightens on hover; use for whole-card links. */
  interactive?: boolean;
  /** 2px rule on the top edge, for state emphasis. */
  accent?: CardAccent;
  children?: ReactNode;
}

const pads: Record<CardPadding, string | number> = { none: 0, sm: 'var(--space-4)', md: 'var(--space-6)', lg: 'var(--space-8)' };

/** Hairline container. Elevation on black comes from border and tint, not shadow. */
export function Card({ padding = 'md', tone = 'surface', interactive = false, accent, children, style, ...rest }: CardProps) {
  const [hover, setHover] = useState(false);
  const bg = tone === 'inset' ? 'var(--bg-inset)' : tone === 'raised' ? 'var(--bg-raised)' : 'var(--bg-surface)';
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      {...rest}
      style={{
        background: bg,
        border: '1px solid ' + (interactive && hover ? 'var(--border-strong)' : 'var(--border-subtle)'),
        borderTop: accent ? '2px solid ' + (accent === 'private' ? 'var(--state-private)' : accent === 'pending' ? 'var(--state-pending)' : 'var(--accent)') : undefined,
        borderRadius: 'var(--radius-card)',
        padding: pads[padding],
        cursor: interactive ? 'pointer' : undefined,
        transition: 'var(--transition-control)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
