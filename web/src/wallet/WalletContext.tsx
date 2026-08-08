import '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { selectWallet } from './selectWallet';
import { createBrowserProviders, type M402Providers } from '../chain/providers';
import { decodeUnshieldedAddress } from '../chain/address';

export type WalletNetwork = 'preprod' | 'preview' | 'undeployed';

export interface WalletContextValue {
  connected: boolean;
  connecting: boolean;
  address: string | null;
  /** Raw bytes behind `address` — what registerService/withdraw need for owner/recipient. */
  ownerBytes: Uint8Array | null;
  error: string | null;
  /** The live connected wallet API — lets any screen call signData, submitTransaction, etc. */
  api: ConnectedAPI | null;
  /** The 6 providers submitCallTxAsync needs (chain/circuits.ts) — assembled once per connection. */
  providers: M402Providers | null;
  /** Connects if needed and returns { api, providers }, so callers can use them immediately. */
  connect: () => Promise<{ api: ConnectedAPI; providers: M402Providers }>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** m402 runs on Midnight Preview — see the repo README's Status section. */
export function WalletProvider({ children, network = 'preview' }: { children: ReactNode; network?: WalletNetwork }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [ownerBytes, setOwnerBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<M402Providers | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const wallet = selectWallet();
      const connectedApi = await wallet.connect(network);
      const { unshieldedAddress } = await connectedApi.getUnshieldedAddress();
      const status = await connectedApi.getConnectionStatus();
      if (status.status !== 'connected') {
        throw new Error('Wallet did not confirm the connection.');
      }
      const connectedProviders = await createBrowserProviders(connectedApi);
      setAddress(unshieldedAddress);
      setOwnerBytes(decodeUnshieldedAddress(unshieldedAddress));
      setApi(connectedApi);
      setProviders(connectedProviders);
      setConnected(true);
      return { api: connectedApi, providers: connectedProviders };
    } catch (err) {
      setConnected(false);
      setAddress(null);
      setOwnerBytes(null);
      setApi(null);
      setProviders(null);
      const message = err instanceof Error ? err.message : 'Could not connect to wallet.';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setConnecting(false);
    }
  }, [network]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setAddress(null);
    setOwnerBytes(null);
    setApi(null);
    setProviders(null);
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ connected, connecting, address, ownerBytes, error, api, providers, connect, disconnect }),
    [connected, connecting, address, ownerBytes, error, api, providers, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWalletContext must be used inside <WalletProvider>');
  return ctx;
}
