import { useState, type HTMLAttributes } from 'react';
import { IconButton } from '../core/IconButton';

export interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  code: string;
  /** Header label — a filename, a shell name, or an HTTP status. */
  title?: string;
  /** Fallback header label when `title` is absent. */
  lang?: string;
  copyable?: boolean;
  /** Wrap long lines instead of scrolling — for hex payloads. */
  wrap?: boolean;
}

/** Inset terminal/code readout with an optional filename bar. */
export function CodeBlock({ code = '', title, lang, copyable = true, wrap = false, style, ...rest }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div {...rest} style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', overflow: 'hidden', ...style }}>
      {(title || copyable) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          height: 30, padding: '0 6px 0 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
        }}>
          <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            {title || lang}
          </span>
          {copyable && (
            <IconButton
              icon={copied ? 'check' : 'copy'} label="Copy" size="sm"
              onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            />
          )}
        </div>
      )}
      <pre style={{
        margin: 0, padding: 'var(--space-4) var(--space-5)', overflowX: 'auto',
        font: 'var(--text-code)', letterSpacing: 'var(--ls-mono)', color: 'var(--ink-100)',
        whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-all' : 'normal',
      }}>{code}</pre>
    </div>
  );
}
