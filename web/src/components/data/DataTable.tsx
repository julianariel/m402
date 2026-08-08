import { useState, type HTMLAttributes, type ReactNode } from 'react';

export interface DataColumn<T = any> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Render this column in Space Mono — prices, hashes, counts. */
  mono?: boolean;
  width?: string | number;
  /** Custom cell renderer; receives the whole row. */
  render?: (row: T) => ReactNode;
}

export interface DataTableProps<T = any> extends HTMLAttributes<HTMLDivElement> {
  columns?: DataColumn<T>[];
  rows?: T[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
}

/** Hairline table for the explorer, ledger views and withdrawal history. */
export function DataTable<T extends { id?: string | number } = any>({
  columns = [], rows = [], onRowClick, emptyLabel = 'No rows', style, ...rest
}: DataTableProps<T>) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div {...rest} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', overflow: 'hidden', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: c.align || 'left', padding: '9px var(--space-5)',
                background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)',
                font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)',
                textTransform: 'uppercase', color: 'var(--text-faint)', whiteSpace: 'nowrap', width: c.width,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 'var(--space-9)', textAlign: 'center', font: 'var(--fw-regular) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-faint)' }}>{emptyLabel}</td></tr>
          )}
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={() => onRowClick?.(row)}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              style={{
                background: hover === i && onRowClick ? 'var(--bg-hover)' : 'transparent',
                cursor: onRowClick ? 'pointer' : 'default', transition: 'background var(--dur-fast) var(--ease-standard)',
              }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{
                  textAlign: c.align || 'left', padding: 'var(--space-4) var(--space-5)',
                  borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                  font: c.mono ? 'var(--text-code)' : 'var(--fw-regular) var(--fs-body-sm)/1.4 var(--font-body)',
                  color: 'var(--text-secondary)', verticalAlign: 'middle',
                }}>
                  {c.render ? c.render(row) : (row as any)[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
