/** m402Vault deployed on Midnight Preview. Public data, safe to override via env. */
export const DEFAULT_VAULT_ADDRESS = '17b4cf15ad768fa0e5090da960e86eaf7cc885f86eb5a6b241e2fd28d98546ae';
export const VAULT_ADDRESS: string = import.meta.env['VITE_M402_VAULT_ADDRESS'] ?? DEFAULT_VAULT_ADDRESS;

const INDEXER_URL = 'https://indexer.preview.midnight.network/api/v4/graphql';

const CONTRACT_STATE_QUERY = `
  query CONTRACT_STATE_QUERY($address: HexEncoded!) {
    contractAction(address: $address) { state }
  }
`;

export interface VaultStatus {
  found: boolean;
  /** Size of the raw ledger state, in bytes — a liveness signal, not registered-service data. */
  stateBytes: number;
}

/**
 * Checks the vault is actually reachable on-chain, straight from the browser to the
 * Preview indexer's public GraphQL API. No wallet needed — deposits/withdrawals/service
 * registrations are all public ledger fields.
 *
 * This only confirms presence. Decoding the typed fields (servicePrice, merchantBalance,
 * etc.) needs the compiled contract bindings from `compact compile`, which this app does
 * not ship — see contracts/README.md.
 */
export async function fetchVaultStatus(address: string = VAULT_ADDRESS): Promise<VaultStatus> {
  const res = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CONTRACT_STATE_QUERY, variables: { address } }),
  });
  if (!res.ok) throw new Error(`Indexer returned HTTP ${res.status}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);

  const state: string | null = json.data?.contractAction?.state ?? null;
  return { found: state !== null, stateBytes: state ? state.length / 2 : 0 };
}
