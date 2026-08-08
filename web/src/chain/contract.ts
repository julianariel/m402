import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract } from 'contracts/vault-contract';
import { witnesses } from './witnesses';

/**
 * No withCompiledFileAssets() here (contrast contracts/src/contract.ts, which is Node-only
 * and file-path-based) — submitCallTxAsync sources ZK config from `providers.zkConfigProvider`
 * (chain/providers.ts's FetchZkConfigProvider) via makeContractExecutableRuntime, not from the
 * compiled contract's own file-assets path. Confirmed against
 * @midnight-ntwrk/midnight-js-contracts's implementation, not just its types.
 */
export const CompiledM402Vault = CompiledContract.make('M402Vault', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
);
