import { useMemo, useState } from 'react';
import { Badge, Button, Card, Tag } from '../components/core';
import { Input } from '../components/forms';
import { Tabs } from '../components/navigation';
import { EmptyState, Tooltip } from '../components/feedback';
import { DataTable, StatBlock, type DataColumn } from '../components/data';
import { PriceTag } from '../components/protocol';
import type { GatewayServiceRow } from '../lib/gateway';
import { approxUsdOf, labelOf, safeHostname, shortHex } from './serviceDisplay';
import { useServices } from './useServices';
import { VaultStatus } from './VaultStatus';
import { useNarrow } from '../lib/useNarrow';

export interface ExplorerScreenProps {
  onOpenService: (id: string) => void;
  onPublish: () => void;
}

export function ExplorerScreen({ onOpenService, onPublish }: ExplorerScreenProps) {
  const { state, reload } = useServices();
  const narrow = useNarrow();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  const services = state.phase === 'loaded' ? state.services : [];
  const rows = useMemo(
    () =>
      services.filter(
        (s) => (tab === 'all' || s.type === tab) && (labelOf(s) + s.id).toLowerCase().includes(q.toLowerCase()),
      ),
    [services, tab, q],
  );

  const columns: DataColumn<GatewayServiceRow>[] = [
    {
      key: 'name', label: 'Service', render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ font: 'var(--fw-medium) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-primary)' }}>{labelOf(r)}</span>
          <span style={{ font: 'var(--fw-regular) var(--fs-mono-xs)/1 var(--font-mono)', color: 'var(--text-faint)' }}>
            {r.description ? `${safeHostname(r.target)} · ` : ''}/s/{shortHex(r.id)}
          </span>
        </div>
      ),
    },
    {
      key: 'type', label: 'Fulfilment', render: (r) => r.type === 'relay' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Badge tone="public" icon="globe">relay</Badge>
          <Tag icon="hash">{r.chain}</Tag>
        </div>
      ) : <Badge icon="server">origin</Badge>,
    },
    { key: 'price', label: 'Price', render: (r) => <PriceTag usd={approxUsdOf(r)} star={r.price.toString()} /> },
    {
      key: 'paid', label: 'Amount paid', render: () => (
        <Tooltip content="Payment amounts are witnesses. Nothing on the ledger reveals them.">
          <span><PriceTag usd="" star="" hidden /></span>
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '40px var(--page-pad) 80px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 36, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, font: 'var(--fw-light) var(--fs-display-2)/1.05 var(--font-display)', letterSpacing: 'var(--ls-display)' }}>
            Pay without publishing
          </h1>
          <p style={{ margin: 'var(--space-4) 0 0', maxWidth: '52ch', font: 'var(--fw-regular) var(--fs-body-lg)/1.55 var(--font-body)', color: 'var(--text-secondary)' }}>
            Every service below speaks the x402 flow. The chain records that someone paid at least the asking price — not the amount, not the payer.
          </p>
        </div>
        <Button iconRight="arrow-right" size="lg" onClick={onPublish}>Publish a service</Button>
      </div>

      <VaultStatus />

      <Card padding="lg" style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(2,1fr)', gap: 'var(--space-7)' }}>
          <StatBlock label="Services listed" value={String(services.length)} delta="gateway registry — GET /services" />
          <StatBlock label="Amounts revealed" value="0" tone="private" delta="by construction" />
        </div>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'all', label: 'All services', count: services.length },
            { value: 'origin', label: 'Origin', icon: 'server', count: services.filter((s) => s.type === 'origin').length },
            { value: 'relay', label: 'Relayed', icon: 'globe', count: services.filter((s) => s.type === 'relay').length },
          ]}
        />
        <Input size="sm" icon="search" placeholder="Search services" value={q} onChange={setQ} style={{ width: 220 }} />
      </div>

      {state.phase === 'error' ? (
        <EmptyState
          icon="triangle-alert" title="Couldn't reach the gateway" detail={state.message}
          action={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="search" title={state.phase === 'loading' ? 'Loading services…' : 'No services match'}
          detail={state.phase === 'loading' ? 'Fetching the gateway registry.' : 'Try clearing the search or the type filter.'}
          action={state.phase === 'loading' ? undefined : <Button variant="secondary" size="sm" onClick={() => { setQ(''); setTab('all'); }}>Clear filters</Button>}
        />
      ) : (
        <DataTable rows={rows} columns={columns} onRowClick={(r) => onOpenService(r.id)} />
      )}
      <p style={{ marginTop: 'var(--space-5)', font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        Public: service id, price, target host. Hidden: every payer and every amount.
      </p>
    </div>
  );
}
