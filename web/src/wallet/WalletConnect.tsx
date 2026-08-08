import { Button, HashChip } from '../components';
import { useWalletContext } from './WalletContext';

/** Lace connect/disconnect control for the TopNav's right-hand slot. */
export function WalletConnect() {
  const { connected, connecting, address, error, connect, disconnect } = useWalletContext();

  if (connected && address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <HashChip value={address} label="wallet" tone="public" />
        <Button variant="ghost" size="sm" onClick={disconnect}>Disconnect</Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
      <Button variant="secondary" size="sm" iconLeft="wallet" loading={connecting} onClick={() => { connect().catch(() => {}); }}>
        Connect Wallet
      </Button>
      {error && (
        <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)', maxWidth: 220, textAlign: 'right' }}>
          {error}
        </span>
      )}
    </div>
  );
}
