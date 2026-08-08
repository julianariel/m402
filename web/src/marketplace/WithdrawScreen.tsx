import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, StatusDot } from '../components/core';
import { Field, Input } from '../components/forms';
import { EmptyState } from '../components/feedback';
import { DataTable, StatBlock, type DataColumn } from '../components/data';
import { HashChip, PriceTag } from '../components/protocol';
import { useWalletContext } from '../wallet/WalletContext';
import { fetchVaultLedger, servicesOwnedBy } from '../chain/ledger';
import { withdrawBalance, type TxPhase } from '../chain/circuits';
import { VAULT_ADDRESS } from '../lib/vault';

interface OwnedServiceRow {
  id: string;
}

type LedgerState =
  | { phase: 'loading' }
  | { phase: 'loaded'; ownedServiceIds: Uint8Array[]; balance: bigint }
  | { phase: 'error'; message: string };

type WithdrawPhase = { kind: 'idle' } | { kind: TxPhase } | { kind: 'done'; txId: string } | { kind: 'error'; message: string };

const columns: DataColumn<OwnedServiceRow>[] = [
  { key: 'id', label: 'Service id', render: (r) => <span style={{ font: 'var(--text-code)', color: 'var(--text-primary)' }}>{r.id.slice(0, 16)}…</span> },
  { key: 'amounts', label: 'Amounts paid', render: () => <PriceTag usd="" star="" hidden /> },
  { key: 'state', label: '', render: () => <StatusDot tone="live" label="owned" /> },
];

const pageStyle = { maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '40px var(--page-pad) 80px' } as const;

export function WithdrawScreen() {
  const { connected, connecting, address, ownerBytes, error: walletError, providers, connect } = useWalletContext();
  const [ledgerState, setLedgerState] = useState<LedgerState>({ phase: 'loading' });
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<WithdrawPhase>({ kind: 'idle' });

  const reload = useCallback(() => {
    if (!ownerBytes) return;
    setLedgerState({ phase: 'loading' });
    fetchVaultLedger(VAULT_ADDRESS)
      .then((ledger) => {
        if (!ledger) {
          setLedgerState({ phase: 'loaded', ownedServiceIds: [], balance: 0n });
          return;
        }
        const ownedServiceIds = servicesOwnedBy(ledger, ownerBytes);
        const balance = ledger.merchantBalance.member(ownerBytes) ? ledger.merchantBalance.lookup(ownerBytes) : 0n;
        setLedgerState({ phase: 'loaded', ownedServiceIds, balance });
        setAmount(balance.toString());
      })
      .catch((err) => setLedgerState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to read the vault.' }));
  }, [ownerBytes]);

  useEffect(() => { reload(); }, [reload]);

  async function handleWithdraw() {
    if (ledgerState.phase !== 'loaded' || !providers || ledgerState.ownedServiceIds.length === 0) return;
    const amountStar = BigInt(amount || '0');
    if (amountStar <= 0n || amountStar > ledgerState.balance) {
      setPhase({ kind: 'error', message: `Amount must be between 1 and ${ledgerState.balance} STAR.` });
      return;
    }
    setPhase({ kind: 'proving' });
    try {
      const { txId } = await withdrawBalance(providers, VAULT_ADDRESS, ledgerState.ownedServiceIds[0], amountStar, (p) => setPhase({ kind: p }));
      setPhase({ kind: 'done', txId });
      reload();
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Withdrawal failed.' });
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

  if (ledgerState.phase === 'loading') {
    return (
      <div style={pageStyle}>
        <EmptyState icon="loader" title="Reading the vault…" detail="Fetching merchantBalance from the Preview indexer." />
      </div>
    );
  }

  if (ledgerState.phase === 'error') {
    return (
      <div style={pageStyle}>
        <EmptyState icon="triangle-alert" title="Couldn't read the vault" detail={ledgerState.message} action={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>} />
      </div>
    );
  }

  if (ledgerState.balance === 0n) {
    return (
      <div style={pageStyle}>
        <EmptyState icon="circle-check" title="Nothing to withdraw" detail="This address has no claimable balance right now." />
      </div>
    );
  }

  const rows: OwnedServiceRow[] = ledgerState.ownedServiceIds.map((id) => ({ id: Buffer.from(id).toString('hex') }));

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-6)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card padding="lg">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 'var(--space-7)' }}>
              <StatBlock label="Claimable" value={ledgerState.balance.toLocaleString()} unit="STAR" tone="accent" delta="public — merchantBalance" />
              <StatBlock label="Payers known" value="0" tone="private" delta="none, by construction" />
            </div>
          </Card>

          <DataTable rows={rows} columns={columns} emptyLabel="No owned services found." />
          <p style={{ margin: 0, font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
            Services owned by this address, decoded from serviceOwner on the vault.
          </p>
        </div>

        <Card padding="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>withdraw</div>
            {phase.kind === 'done' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <Badge tone="private" icon="shield-check">confirmed on-chain</Badge>
                <HashChip label="tx" value={phase.txId} tone="public" />
                <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                  withdraw() confirmed. NIGHT was sent to the address recorded at registration.
                </div>
                <Button variant="secondary" size="sm" onClick={() => setPhase({ kind: 'idle' })}>Withdraw more</Button>
              </div>
            ) : (
              <>
                <Field label="Amount" hint="Paid out as unshielded NIGHT. This transfer is public in amount and address.">
                  <Input mono value={amount} onChange={setAmount} suffix="STAR" />
                </Field>
                <Button
                  fullWidth size="lg" iconLeft="arrow-up-from-line"
                  loading={phase.kind === 'proving' || phase.kind === 'confirming'}
                  onClick={handleWithdraw}
                >
                  {phase.kind === 'proving' ? 'Proving withdraw…' : phase.kind === 'confirming' ? 'Confirming on-chain…' : 'Withdraw to Lace'}
                </Button>
                {phase.kind === 'error' && (
                  <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)' }}>{phase.message}</span>
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
