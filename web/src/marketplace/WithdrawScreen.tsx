import { useState } from 'react';
import { Badge, Button, Card, StatusDot } from '../components/core';
import { Field, Input } from '../components/forms';
import { EmptyState } from '../components/feedback';
import { DataTable, StatBlock, type DataColumn } from '../components/data';
import { HashChip, PriceTag } from '../components/protocol';
import { useWalletContext } from '../wallet/WalletContext';
import { useNarrow } from '../lib/useNarrow';

interface AccrualRow {
  id: number;
  service: string;
  calls: number;
  accrued: number;
  state: 'claimable';
}

/** Illustrative — decoding real per-owner merchantBalance needs the compiled contract. */
const ROWS: AccrualRow[] = [
  { id: 1, service: 'weather-api', calls: 1284, accrued: 642_000, state: 'claimable' },
  { id: 2, service: 'sec-filings', calls: 312, accrued: 780_000, state: 'claimable' },
  { id: 3, service: 'llm-embeddings', calls: 8940, accrued: 1_788_000, state: 'claimable' },
];
const CLAIMABLE_TOTAL = ROWS.reduce((sum, r) => sum + r.accrued, 0);
const CALLS_TOTAL = ROWS.reduce((sum, r) => sum + r.calls, 0);

const columns: DataColumn<AccrualRow>[] = [
  { key: 'service', label: 'Service', render: (r) => <span style={{ font: 'var(--text-code)', color: 'var(--text-primary)' }}>{r.service}</span> },
  { key: 'calls', label: 'Calls', mono: true, align: 'right', render: (r) => r.calls.toLocaleString() },
  { key: 'accrued', label: 'Accrued', mono: true, align: 'right', render: (r) => <span style={{ color: 'var(--text-primary)' }}>{r.accrued.toLocaleString()} STAR</span> },
  { key: 'amounts', label: 'Amounts paid', render: () => <PriceTag usd="" star="" hidden /> },
  { key: 'state', label: '', render: () => <StatusDot tone="live" label="claimable" /> },
];

const pageStyle = { maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '40px var(--page-pad) 80px' } as const;

export function WithdrawScreen() {
  const narrow = useNarrow();
  const { connected, connecting, address, error: walletError, api, connect } = useWalletContext();
  const [amount, setAmount] = useState(String(CLAIMABLE_TOTAL));
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [result, setResult] = useState<{ signature: string; verifyingKey: string } | null>(null);

  async function handleWithdraw() {
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      const wallet = api ?? (await connect());
      const message = [
        'm402 withdraw request',
        `amount: ${amount} STAR`,
        `destination: ${address ?? '(this wallet\'s registered address)'}`,
      ].join('\n');
      const sig = await wallet.signData(message, { encoding: 'text', keyType: 'unshielded' });
      setResult({ signature: sig.signature, verifyingKey: sig.verifyingKey });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setWithdrawError(code === 'Rejected' ? 'Withdrawal request rejected in Lace.' : err instanceof Error ? err.message : 'Signing failed.');
    } finally {
      setWithdrawing(false);
    }
  }

  if (!connected) {
    return (
      <div style={pageStyle}>
        <EmptyState
          icon="wallet"
          title="Connect Lace to see your claimable balance"
          detail="merchantBalance is tracked per owner on the vault — connect the Lace address you registered services with."
          action={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
              <Button iconLeft="wallet" loading={connecting} onClick={() => connect().catch(() => {})}>Connect Wallet</Button>
              {walletError && <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)' }}>{walletError}</span>}
            </div>
          }
        />
      </div>
    );
  }

  if (CLAIMABLE_TOTAL === 0) {
    return (
      <div style={pageStyle}>
        <EmptyState icon="circle-check" title="Nothing to withdraw" detail="This address has no claimable balance right now." />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 'var(--space-7)', flexWrap: 'wrap', gap: 'var(--space-5)' }}>
        <div>
          <h1 style={{ margin: 0, font: 'var(--text-h1)', letterSpacing: 'var(--ls-heading)' }}>Merchant balance</h1>
          <p style={{ margin: 'var(--space-3) 0 0', maxWidth: '56ch', font: 'var(--text-body)', color: 'var(--text-secondary)' }}>
            Withdrawal pays unshielded NIGHT to the Lace address recorded at registration. Anyone can trigger it; only you can receive it.
          </p>
        </div>
        <HashChip label="connected" value={address ?? ''} tone="public" head={12} tail={6} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '1fr 340px', gap: 'var(--space-6)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card padding="lg">
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(3,1fr)', gap: 'var(--space-7)' }}>
              <StatBlock label="Claimable" value={CLAIMABLE_TOTAL.toLocaleString()} unit="STAR" tone="accent" delta="public — merchantBalance" />
              <StatBlock label="Calls settled" value={CALLS_TOTAL.toLocaleString()} delta="volume is observable" />
              <StatBlock label="Payers known" value="0" tone="private" delta="none, by construction" />
            </div>
          </Card>

          <DataTable rows={ROWS} columns={columns} />
          <p style={{ margin: 0, font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
            Illustrative — decoding your real merchantBalance needs the compiled contract, which this build doesn't ship.
          </p>
        </div>

        <Card padding="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>withdraw</div>
            {result ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <Badge tone="pending" icon="check">signed</Badge>
                <HashChip label="signature" value={result.signature} tone="private" />
                <HashChip label="signer" value={result.verifyingKey} tone="private" />
                <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                  Lace signed this withdrawal request. Submitting it on-chain needs the vault's <code style={{ fontFamily: 'var(--font-mono)' }}>withdraw</code> circuit, which needs the compiled contract — not available in this build.
                </div>
                <Button variant="secondary" size="sm" onClick={() => setResult(null)}>Sign another</Button>
              </div>
            ) : (
              <>
                <Field label="Amount" hint="Paid out as unshielded NIGHT. This transfer is public in amount and address.">
                  <Input mono value={amount} onChange={setAmount} suffix="STAR" />
                </Field>
                <Button fullWidth size="lg" iconLeft="arrow-up-from-line" loading={withdrawing} onClick={handleWithdraw}>Withdraw to Lace</Button>
                {withdrawError && (
                  <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)' }}>{withdrawError}</span>
                )}
                <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                  The circuit reads the destination from <span style={{ fontFamily: 'var(--font-mono)' }}>serviceOwner</span>, so there is no caller to authenticate and nothing to steal.
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
