import type {
  ExportPrivateStatesOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

/**
 * Browser private state is never persisted across page loads — there's nothing durable to
 * back it with (no LevelDB in a tab), and the one witness that reads it (`creditCoin`) only
 * needs the coin's colour and price, not a stored coin (see chain/witnesses.ts). A plain Map
 * scoped to the tab's lifetime is enough.
 */
export function createInMemoryPrivateStateProvider<PSI extends PrivateStateId, PS>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<PSI, PS>();
  const signingKeys = new Map<ContractAddress, SigningKey>();

  return {
    setContractAddress: () => {},
    set: async (id, state) => {
      states.set(id, state);
    },
    get: async (id) => states.get(id) ?? null,
    remove: async (id) => {
      states.delete(id);
    },
    clear: async () => {
      states.clear();
    },
    setSigningKey: async (address, key) => {
      signingKeys.set(address, key);
    },
    getSigningKey: async (address) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },
    exportPrivateStates: async (_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> => {
      throw new Error('exportPrivateStates is not supported by the in-memory browser provider.');
    },
    importPrivateStates: async (
      _exportData: PrivateStateExport,
      _options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> => {
      throw new Error('importPrivateStates is not supported by the in-memory browser provider.');
    },
    exportSigningKeys: async (_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> => {
      throw new Error('exportSigningKeys is not supported by the in-memory browser provider.');
    },
    importSigningKeys: async (
      _exportData: SigningKeyExport,
      _options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> => {
      throw new Error('importSigningKeys is not supported by the in-memory browser provider.');
    },
  };
}
