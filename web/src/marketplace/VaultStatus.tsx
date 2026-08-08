import { useCallback, useEffect, useState } from 'react';
import { Card, IconButton, StatusDot } from '../components/core';
import { HashChip } from '../components/protocol';
import { VAULT_ADDRESS, fetchVaultStatus, type VaultStatus as VaultStatusResult } from '../lib/vault';

type CheckState =
  | { phase: 'checking' }
  | { phase: 'found'; result: VaultStatusResult }
  | { phase: 'error'; message: string };

/** Live reachability check against the deployed m402Vault — real data, not a mock. */
export function VaultStatus() {
  const [state, setState] = useState<CheckState>({ phase: 'checking' });

  const check = useCallback(() => {
    setState({ phase: 'checking' });
    fetchVaultStatus()
      .then((result) => setState({ phase: 'found', result }))
      .catch((err) => setState({ phase: 'error', message: err instanceof Error ? err.message : 'Check failed.' }));
  }, []);

  useEffect(() => { check(); }, [check]);

  const dotTone = state.phase === 'checking' ? 'confirming' : state.phase === 'found' && state.result.found ? 'live' : 'error';
  const label =
    state.phase === 'checking' ? 'checking Preview indexer…'
    : state.phase === 'error' ? `check failed — ${state.message}`
    : state.result.found ? `found on-chain · ${state.result.stateBytes.toLocaleString()} bytes of ledger state`
    : 'no state found at this address';

  return (
    <Card padding="md" tone="inset" style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <HashChip label="vault" value={VAULT_ADDRESS} tone="public" head={10} tail={6} />
          <StatusDot tone={dotTone} label={label} />
        </div>
        <IconButton icon="refresh-cw" label="Re-check" onClick={check} />
      </div>
      <p style={{ margin: 'var(--space-3) 0 0', font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-body)', color: 'var(--text-faint)' }}>
        Checked live against the Midnight Preview indexer. The service list below is illustrative — decoding real registrations needs the compiled contract, which this build doesn't ship.
      </p>
    </Card>
  );
}
