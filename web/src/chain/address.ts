import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * `owner`/`recipient` in the vault circuits are raw Bytes<32>, but the DApp Connector only
 * ever hands back Bech32m-encoded addresses (getUnshieldedAddress()). Decodes and validates
 * against the network the wallet is actually connected to — getNetworkId() throws if
 * chain/providers.ts's createBrowserProviders() (which calls setNetworkId) hasn't run yet.
 */
export function decodeUnshieldedAddress(bech32Address: string): Uint8Array {
  const parsed = MidnightBech32m.parse(bech32Address);
  const decoded = UnshieldedAddress.codec.decode(getNetworkId(), parsed);
  return new Uint8Array(decoded.data);
}
