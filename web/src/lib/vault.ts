import { INDEXER_URL, VAULT_ADDRESS } from '../chain/config';

export { VAULT_ADDRESS };

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
