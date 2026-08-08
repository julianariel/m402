import type { ReactNode } from 'react';
import { WaveField } from '../WaveField';
import { Button, TopNav } from '../components';
import { WalletConnect } from '../wallet/WalletConnect';
import { openRepo } from '../lib/links';
import type { Route } from '../router';

const NAV_ITEMS = [
  { value: 'home', label: 'Home' },
  { value: 'explorer', label: 'Explorer', icon: 'globe' },
  { value: 'publish', label: 'Publish', icon: 'plus' },
  { value: 'withdraw', label: 'Withdraw', icon: 'arrow-up-from-line' },
];

const ACTIVE_BY_ROUTE: Record<Route['name'], string> = {
  home: 'home',
  explorer: 'explorer',
  service: 'explorer',
  publish: 'publish',
  withdraw: 'withdraw',
};

export function MarketplaceShell({ route, navigate, children }: { route: Route; navigate: (path: string) => void; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <WaveField />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <TopNav
          items={NAV_ITEMS}
          active={ACTIVE_BY_ROUTE[route.name]}
          onNavigate={(v) => navigate(v === 'home' ? '/' : '/' + v)}
          network="Preview"
          networkTone="live"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
              <WalletConnect />
              <Button variant="secondary" size="sm" iconRight="external-link" onClick={() => openRepo()}>
                Repository
              </Button>
            </div>
          }
        />
        {children}
      </div>
    </div>
  );
}
