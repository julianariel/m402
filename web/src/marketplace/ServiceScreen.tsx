import { useEffect, useState } from 'react';
import type { PaymentRequired } from '@m402/shared';
import { Badge, Button, Card, IconButton, StatusDot } from '../components/core';
import { Dialog, Toast, Tooltip } from '../components/feedback';
import { CodeBlock, FlowStep, HashChip, PriceTag } from '../components/protocol';
import { claimService, listServices, requestService, type GatewayServiceRow } from '../lib/gateway';
import { fetchVaultLedger } from '../chain/ledger';
import { payForService } from '../chain/circuits';
import { useWalletContext } from '../wallet/WalletContext';
import { GATEWAY_URL } from '../chain/config';
import { approxUsdOf, safeHostname, shortHex } from './serviceDisplay';

export interface ServiceScreenProps {
  id: string;
  onBack: () => void;
}

type PayPhase =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'proving' }
  | { kind: 'confirming' }
  | { kind: 'claiming'; attempt: number }
  | { kind: 'done'; status: number; contentType: string; bytes: number }
  | { kind: 'error'; message: string };

export function ServiceScreen({ id, onBack }: ServiceScreenProps) {
  const wallet = useWalletContext();
  const [row, setRow] = useState<GatewayServiceRow | null>(null);
  const [requirements, setRequirements] = useState<PaymentRequired | null>(null);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PayPhase>({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listServices()
      .then((rows) => { if (!cancelled) setRow(rows.find((r) => r.id === id) ?? null); })
      .catch(() => {});
    requestService(id)
      .then((res) => { if (!cancelled && res.kind === 'payment-required') setRequirements(res.requirements); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load this service.'); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!requirements) return;
    let cancelled = false;
    fetchVaultLedger(requirements.vaultAddress)
      .catch(() => null)
      .then((ledger) => {
        if (cancelled || !ledger) return;
        const hashes: string[] = [];
        for (const r of ledger.receipts) {
          hashes.push(Buffer.from(r).toString('hex'));
          if (hashes.length >= 5) break;
        }
        setReceipts(hashes);
      });
    return () => { cancelled = true; };
  }, [requirements]);

  const stateFor = (i: number): 'done' | 'active' | 'pending' => {
    const order = ['idle', 'connecting', 'proving', 'confirming', 'claiming', 'done'];
    const current = order.indexOf(phase.kind);
    const target = [0, 1, 2, 3][i] ?? 3;
    if (phase.kind === 'error') return 'pending';
    if (current > target) return 'done';
    if (current === target) return 'active';
    return 'pending';
  };

  async function run() {
    setOpen(false);
    setPhase({ kind: 'connecting' });
    try {
      const { providers } = wallet.connected && wallet.providers ? { providers: wallet.providers } : await wallet.connect();
      if (!requirements) throw new Error('Payment requirements not loaded yet.');

      const serviceIdBytes = Buffer.from(requirements.serviceId, 'hex');
      const { receiptSecret } = await payForService(providers, requirements.vaultAddress, serviceIdBytes, (p) =>
        setPhase(p === 'proving' ? { kind: 'proving' } : { kind: 'confirming' }),
      );

      setPhase({ kind: 'claiming', attempt: 0 });
      const response = await claimService(id, Buffer.from(receiptSecret).toString('hex'), (_delay, attempt) =>
        setPhase({ kind: 'claiming', attempt }),
      );
      setPhase({
        kind: 'done',
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        bytes: Number(response.headers.get('content-length') ?? '0'),
      });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Payment failed.' });
    }
  }

  const busy = phase.kind === 'connecting' || phase.kind === 'proving' || phase.kind === 'confirming' || phase.kind === 'claiming';
  const buttonLabel =
    phase.kind === 'connecting' ? 'Connecting wallet…'
    : phase.kind === 'proving' ? 'Proving…'
    : phase.kind === 'confirming' ? 'Confirming on-chain…'
    : phase.kind === 'claiming' ? `Waiting on gateway (retry ${phase.attempt})…`
    : phase.kind === 'done' ? 'Paid — run again'
    : 'Pay privately';

  if (loadError) {
    return (
      <div style={{ maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '28px var(--page-pad) 80px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>← All services</button>
        <p style={{ color: 'var(--state-error)' }}>{loadError}</p>
      </div>
    );
  }

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
              {row?.type === 'relay' ? <Badge tone="public" icon="globe">relay</Badge> : <Badge icon="server">origin</Badge>}
              {row?.chain && <Badge uppercase={false}>{row.chain}</Badge>}
              <StatusDot tone="live" label="live" />
            </div>
            <h1 style={{ margin: 0, font: 'var(--text-h1)', letterSpacing: 'var(--ls-heading)' }}>{row ? safeHostname(row.target) : shortHex(id)}</h1>
            <p style={{ margin: 'var(--space-3) 0 0', maxWidth: '56ch', font: 'var(--text-body)', color: 'var(--text-secondary)' }}>
              {row ? row.target : 'Loading service details from the gateway…'}
            </p>
          </div>

          <Card padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>m402 url</span>
                <IconButton icon="copy" label="Copy URL" onClick={() => navigator.clipboard?.writeText(`${GATEWAY_URL}/s/${id}`)} />
              </div>
              <div style={{ font: 'var(--text-code)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {GATEWAY_URL}/s/{id}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
                <HashChip label="serviceid" value={id} tone="public" />
                {requirements && <HashChip label="vault" value={requirements.vaultAddress} tone="public" head={12} tail={4} />}
              </div>
            </div>
          </Card>

          <Card padding="md">
            <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-4)' }}>
              on-chain receipts
            </div>
            {receipts.length === 0 ? (
              <p style={{ margin: 0, font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
                No receipts on the vault yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {receipts.map((r) => (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <HashChip label="receipt" value={r} tone="public" head={8} tail={4} copyable={false} />
                    <Tooltip content="Payer and amount are witnesses. A receipt hash proves a payment happened — never who made it or for how much.">
                      <span><PriceTag usd="" star="" hidden /></span>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
            <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
              The vault's `receipts` set isn't scoped per service (m402Vault.compact has no such index) — these are the most recent entries on the whole vault.
            </p>
          </Card>

          {requirements && (
            <CodeBlock
              title="402 Payment Required"
              code={`HTTP/1.1 402 Payment Required\n\n${JSON.stringify(requirements, null, 2)}`}
            />
          )}
          <CodeBlock title="agent cli" code={`$ m402 call ${GATEWAY_URL}/s/${id}`} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card padding="lg" accent={phase.kind === 'done' ? 'private' : 'accent'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div>
                <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-3)' }}>asking price</div>
                {requirements ? <PriceTag usd={approxUsdOf({ price: BigInt(requirements.price) })} star={requirements.price} size="lg" /> : <span>Loading…</span>}
              </div>
              <div style={{ height: 1, background: 'var(--border-subtle)' }} />
              <div>
                <FlowStep index={1} title="402 with requirements" detail="serviceId, price, vault address." state="done" privacy="public" />
                <FlowStep index={2} title="Prove pay() with Lace" detail="coin.value never leaves this machine." state={stateFor(1)} privacy="private" />
                <FlowStep index={3} title="Receipt on the indexer" detail="Gateway retries GET /s/:id with X-Payment." state={stateFor(2)} privacy="public" />
                <FlowStep index={4} title="Resource returned" state={phase.kind === 'done' ? 'done' : stateFor(3)} last />
              </div>
              <Button
                variant="shield" fullWidth iconLeft={phase.kind === 'done' ? 'circle-check' : 'shield-check'}
                loading={busy} disabled={!requirements}
                onClick={() => (phase.kind === 'done' ? setPhase({ kind: 'idle' }) : setOpen(true))}
              >
                {buttonLabel}
              </Button>
              {phase.kind === 'error' && (
                <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.4 var(--font-body)', color: 'var(--state-error)' }}>{phase.message}</span>
              )}
            </div>
          </Card>

          <Card padding="md" tone="inset">
            <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              The gateway only reads the chain. It holds no funds, signs nothing, and cannot fabricate a payment. Paying needs a wallet already holding m402 credit (`m402 deposit` via the agent CLI) and a proof server on :6300.
            </div>
          </Card>
        </div>
      </div>

      {phase.kind === 'done' && (
        <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 50 }}>
          <Toast
            tone="success" title="Resource delivered"
            detail={`HTTP ${phase.status} · ${phase.contentType || 'unknown content-type'}${phase.bytes ? ` · ${phase.bytes} bytes` : ''}`}
            onDismiss={() => setPhase({ kind: 'idle' })}
          />
        </div>
      )}

      <Dialog
        open={open} width={440} title="Approve payment"
        subtitle="Lace will prove pay() locally and submit it. The amount itself stays on this machine."
        onClose={() => setOpen(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="shield" iconLeft="shield-check" onClick={run}>Prove &amp; pay</Button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Service</span><span>{row ? safeHostname(row.target) : shortHex(id)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Asking price</span>
            {requirements && <PriceTag usd={approxUsdOf({ price: BigInt(requirements.price) })} star={requirements.price} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Your credit spends</span><PriceTag usd="" star="" hidden />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
