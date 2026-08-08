import type { HTMLAttributes } from 'react';
import { Icon } from '../core/Icon';

export type FlowStepState = 'done' | 'active' | 'pending' | 'failed';

export interface FlowStepProps extends HTMLAttributes<HTMLDivElement> {
  /** Step number, shown while the step is pending. */
  index: number;
  title: string;
  /** Second line of explanatory detail. */
  detail?: string;
  state?: FlowStepState;
  /** Marks whether this step is visible on-chain or stays on the agent's machine. */
  privacy?: 'private' | 'public';
  /** Suppresses the connector rail on the final step. */
  last?: boolean;
}

const states: Record<FlowStepState, { fg: string; bd: string; bg: string; icon: string | null }> = {
  done: { fg: 'var(--state-private)', bd: 'var(--shield-700)', bg: 'var(--state-private-bg)', icon: 'check' },
  active: { fg: 'var(--state-pending)', bd: 'var(--state-pending)', bg: 'var(--state-pending-bg)', icon: 'loader-circle' },
  pending: { fg: 'var(--text-faint)', bd: 'var(--border-default)', bg: 'transparent', icon: null },
  failed: { fg: 'var(--state-error)', bd: 'var(--state-error)', bg: 'var(--state-error-bg)', icon: 'x' },
};

/** One numbered step of the 402-and-retry flow, with a connector rail. */
export function FlowStep({ index, title, detail, state = 'pending', privacy, last = false, style, ...rest }: FlowStepProps) {
  const s = states[state];
  return (
    <div {...rest} style={{ display: 'flex', gap: 'var(--space-4)', ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
          background: s.bg, border: '1px solid ' + s.bd, borderRadius: 'var(--radius-xs)',
          font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', color: s.fg,
        }}>
          {s.icon ? <Icon name={s.icon} size={12} spin={state === 'active'} /> : index}
        </span>
        {!last && <span style={{ flex: 1, width: 1, minHeight: 18, background: 'var(--border-subtle)', marginTop: 4 }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 'var(--space-5)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: 'var(--fw-medium) var(--fs-body-sm)/1.3 var(--font-body)', color: state === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{title}</span>
          {privacy && (
            <span style={{
              font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase',
              color: privacy === 'private' ? 'var(--state-private)' : 'var(--state-public)',
            }}>
              {privacy}
            </span>
          )}
        </div>
        {detail && <div style={{ marginTop: 4, font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-muted)' }}>{detail}</div>}
      </div>
    </div>
  );
}
