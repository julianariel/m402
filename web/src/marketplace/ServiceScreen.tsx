import { useState } from 'react';
import { Badge, Button, Card, IconButton, StatusDot } from '../components/core';
import { Dialog, Toast, Tooltip } from '../components/feedback';
import { CodeBlock, FlowStep, HashChip, PriceTag } from '../components/protocol';
import { SERVICES, type Service } from './data';

/**
 * Illustrative — the real `receipts` set is on-chain but decoding it into this shape
 * needs the compiled contract wired into this screen (see contracts/src/pure.ts, added
 * upstream). The contract has no nullifier — Zswap already prevents double-spending a
 * coin, so an earlier nullifier set was removed as redundant. What's real here is the
 * UX claim: a receipt hash proves a payment happened; amount and payer never appear,
 * in mock data or in the real thing.
 */
const RECENT_RECEIPTS = [
  '7f3a9c1e5b8d2046af7c3e91b5d8a042f6c9e1b7a3d5f8092c4e6a1b9d3f7082',
  '2c8e5a91d4f7b036e9a1c5d8f2b4076a3e9c1f5b8d206479a3c5e8b1d4f7902c',
  '9b4d7f1a3c8e502691b5d9f3a7c108e4b6d9a1c3f5e802b7d4a9c1e6f3b80572',
];

export interface ServiceScreenProps {
  slug: string;
  onBack: () => void;
}

type PayStep = 0 | 1 | 2 | 3; // idle · proving · watching · done

export function ServiceScreen({ slug, onBack }: ServiceScreenProps) {
  const s: Service = SERVICES.find((x) => x.slug === slug) ?? SERVICES[0];
  const [step, setStep] = useState<PayStep>(0);
  const [open, setOpen] = useState(false);

  const run = () => {
    setOpen(false);
    setStep(1);
    setTimeout(() => setStep(2), 1600);
    setTimeout(() => setStep(3), 3200);
  };
  const stateFor = (i: number): 'done' | 'active' | 'pending' => (step > i ? 'done' : step === i ? 'active' : 'pending');

  return (
    <div style={{ maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '28px var(--page-pad) 80px' }}>
      <button
        onClick={onBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, marginBottom: 'var(--space-6)', cursor: 'pointer', font: 'var(--fw-medium) var(--fs-body-sm)/1 var(--font-body)', color: 'var(--text-muted)' }}
      >
        ← All services
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 'var(--space-7)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-3)' }}>
              {s.type === 'relay' ? <Badge tone="public" icon="globe">relay</Badge> : <Badge icon="server">origin</Badge>}
              {s.chain && <Badge uppercase={false}>{s.chain}</Badge>}
              <StatusDot tone={s.state === 'live' ? 'live' : 'confirming'} label={s.state === 'live' ? 'live' : 'confirming…'} />
            </div>
            <h1 style={{ margin: 0, font: 'var(--text-h1)', letterSpacing: 'var(--ls-heading)' }}>{s.name}</h1>
            <p style={{ margin: 'var(--space-3) 0 0', maxWidth: '56ch', font: 'var(--text-body)', color: 'var(--text-secondary)' }}>{s.desc}</p>
          </div>

          <Card padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>m402 url</span>
                <IconButton icon="copy" label="Copy URL" onClick={() => navigator.clipboard?.writeText(`https://gw.m402.dev/s/${s.slug}`)} />
              </div>
              <div style={{ font: 'var(--text-code)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                https://gw.m402.dev/s/{s.slug}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
                <HashChip label="serviceid" value={s.id} tone="public" />
                <HashChip label="vault" value="mn_shield-addr1qxy8p3k2v9j7t4" head={12} tail={4} />
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-4)' }}>
              recent activity
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {RECENT_RECEIPTS.map((n) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <HashChip label="receipt" value={n} tone="public" head={8} tail={4} copyable={false} />
                  <Tooltip content="Payer and amount are witnesses. A receipt hash proves a payment happened — never who made it or for how much.">
                    <span><PriceTag usd="" star="" hidden /></span>
                  </Tooltip>
                </div>
              ))}
            </div>
            <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
              Illustrative — the real <code style={{ fontFamily: 'var(--font-mono)' }}>receipts</code> set is on-chain, but decoding it needs the compiled contract wired into this screen.
            </p>
          </Card>

          <CodeBlock
            title="402 Payment Required"
            code={`HTTP/1.1 402 Payment Required\n\n{\n  "serviceId": "${s.id.slice(0, 10)}…",\n  "price": "${s.star}",\n  "vaultAddress": "mn_shield-addr1qxy8p3k2v9…"\n}`}
          />
          <CodeBlock title="agent cli" code={`$ m402 call https://gw.m402.dev/s/${s.slug}`} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card padding="lg" accent={step === 3 ? 'private' : 'accent'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div>
                <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-3)' }}>asking price</div>
                <PriceTag usd={s.usd} star={s.star} size="lg" />
              </div>
              <div style={{ height: 1, background: 'var(--border-subtle)' }} />
              <div>
                <FlowStep index={1} title="402 with requirements" detail="serviceId, price, vault address." state="done" privacy="public" />
                <FlowStep index={2} title="Prove pay() locally" detail="coin.value never leaves this machine." state={stateFor(1)} privacy="private" />
                <FlowStep index={3} title="Receipt on the indexer" detail="Verification ~3.4ms." state={stateFor(2)} privacy="public" />
                <FlowStep index={4} title="Resource returned" state={step === 3 ? 'done' : 'pending'} last />
              </div>
              <Button
                variant="shield" fullWidth iconLeft={step === 3 ? 'circle-check' : 'shield-check'}
                loading={step === 1 || step === 2}
                onClick={() => (step === 3 ? setStep(0) : setOpen(true))}
              >
                {step === 1 ? 'Proving…' : step === 2 ? 'Watching indexer…' : step === 3 ? 'Paid — run again' : 'Pay privately'}
              </Button>
            </div>
          </Card>

          <Card padding="md" tone="inset">
            <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              The gateway only reads the chain. It holds no funds, signs nothing, and cannot fabricate a payment.
            </div>
          </Card>
        </div>
      </div>

      {step === 3 && (
        <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 50 }}>
          <Toast tone="success" title="Resource delivered" detail={`Paid at least ${s.star} STAR. The ledger shows nothing more.`} onDismiss={() => setStep(0)} />
        </div>
      )}

      <Dialog
        open={open} width={440} title="Approve payment"
        subtitle="You are proving that your credit is worth at least the asking price. The amount itself stays on this machine."
        onClose={() => setOpen(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="shield" iconLeft="shield-check" onClick={run}>Prove &amp; pay</Button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Service</span><span>{s.name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Asking price</span><PriceTag usd={s.usd} star={s.star} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Your credit spends</span><PriceTag usd="" star="" hidden />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
