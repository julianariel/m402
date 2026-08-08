import { useState } from 'react';
import { Badge, Button, Card, StatusDot, Tag } from '../components/core';
import { Input } from '../components/forms';
import { Tabs } from '../components/navigation';
import { EmptyState, Tooltip } from '../components/feedback';
import { DataTable, StatBlock, type DataColumn } from '../components/data';
import { PriceTag } from '../components/protocol';
import { SERVICES, type Service } from './data';
import { VaultStatus } from './VaultStatus';

export interface ExplorerScreenProps {
  onOpenService: (slug: string) => void;
  onPublish: () => void;
}

const TYPE_LABEL: Record<Service['type'], string> = { origin: 'origin', relay: 'relay' };

export function ExplorerScreen({ onOpenService, onPublish }: ExplorerScreenProps) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const rows = SERVICES.filter((s) => (tab === 'all' || s.type === tab) && (s.name + s.slug).toLowerCase().includes(q.toLowerCase()));

  const columns: DataColumn<Service>[] = [
    {
      key: 'name', label: 'Service', render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ font: 'var(--fw-medium) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-primary)' }}>{r.name}</span>
          <span style={{ font: 'var(--fw-regular) var(--fs-mono-xs)/1 var(--font-mono)', color: 'var(--text-faint)' }}>/s/{r.slug}</span>
        </div>
      ),
    },
    {
      key: 'type', label: 'Fulfilment', render: (r) => r.type === 'relay' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Badge tone="public" icon="globe">relay</Badge>
          <Tag icon="hash">{r.chain}</Tag>
        </div>
      ) : <Badge icon="server">{TYPE_LABEL.origin}</Badge>,
    },
    { key: 'price', label: 'Price', render: (r) => <PriceTag usd={r.usd} star={r.star} /> },
    {
      key: 'paid', label: 'Amount paid', render: () => (
        <Tooltip content="Payment amounts are witnesses. Nothing on the ledger reveals them.">
          <span><PriceTag usd="" star="" hidden /></span>
        </Tooltip>
      ),
    },
    { key: 'calls', label: 'Calls', mono: true, align: 'right' },
    { key: 'state', label: '', render: (r) => <StatusDot tone={r.state === 'live' ? 'live' : 'confirming'} label={r.state === 'live' ? 'live' : 'confirming…'} /> },
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--space-7)' }}>
          <StatBlock label="Pooled reserve" value="48,200" unit="STAR" delta="public — moves only on deposit" />
          <StatBlock label="Calls settled" value="10,673" tone="accent" delta="volume public, payers not" />
          <StatBlock label="Amounts revealed" value="0" tone="private" delta="by construction" />
          <StatBlock label="Median proof" value="19.2" unit="s" icon="clock" delta="on the agent's machine" />
        </div>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'all', label: 'All services', count: SERVICES.length },
            { value: 'origin', label: 'Origin', icon: 'server', count: SERVICES.filter((s) => s.type === 'origin').length },
            { value: 'relay', label: 'Relayed', icon: 'globe', count: SERVICES.filter((s) => s.type === 'relay').length },
          ]}
        />
        <Input size="sm" icon="search" placeholder="Search services" value={q} onChange={setQ} style={{ width: 220 }} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="search" title="No services match" detail="Try clearing the search or the type filter."
          action={<Button variant="secondary" size="sm" onClick={() => { setQ(''); setTab('all'); }}>Clear filters</Button>}
        />
      ) : (
        <DataTable rows={rows} columns={columns} onRowClick={(r) => onOpenService(r.slug)} />
      )}
      <p style={{ marginTop: 'var(--space-5)', font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-faint)' }}>
        Public: service name, price, call volume. Hidden: every payer and every amount.
      </p>
    </div>
  );
}
