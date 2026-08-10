import { CallTxFailedError, submitCallTxAsync } from '@midnight-ntwrk/midnight-js-contracts';
import { asContractAddress, SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { pureCircuits } from 'contracts/pure';
import { CompiledM402Vault } from './contract';
import { M402_PRIVATE_STATE_ID, type M402Providers } from './providers';
import { emptyPrivateState } from './witnesses';

export type VaultCircuits = 'registerService' | 'deposit' | 'pay' | 'redeem' | 'withdraw';
export type TxPhase = 'proving' | 'confirming';

async function ensurePrivateState(providers: M402Providers, contractAddress: string): Promise<void> {
  const address = asContractAddress(contractAddress);
  providers.privateStateProvider.setContractAddress(address);
  if (!(await providers.privateStateProvider.get(M402_PRIVATE_STATE_ID))) {
    await providers.privateStateProvider.set(M402_PRIVATE_STATE_ID, emptyPrivateState());
  }
}

async function submit<PCK extends VaultCircuits>(
  providers: M402Providers,
  contractAddress: string,
  circuitId: PCK,
  args: unknown[],
  onPhase?: (phase: TxPhase) => void,
): Promise<{ txId: string }> {
  await ensurePrivateState(providers, contractAddress);

  onPhase?.('proving');
  const submitted = await submitCallTxAsync(providers, {
    compiledContract: CompiledM402Vault,
    contractAddress: asContractAddress(contractAddress),
    privateStateId: M402_PRIVATE_STATE_ID,
    circuitId,
    args,
  } as never);

  onPhase?.('confirming');
  const finalized = await providers.publicDataProvider.watchForTxData(submitted.txId);
  if (finalized.status !== SucceedEntirely) {
    throw new CallTxFailedError(finalized, circuitId);
  }
  await providers.privateStateProvider.set(M402_PRIVATE_STATE_ID, submitted.callTxData.private.nextPrivateState);
  return { txId: submitted.txId };
}

export type RegisterServiceArgs = { salt: Uint8Array; price: bigint; owner: Uint8Array };

/** Submits registerService(salt, price, owner). serviceId is derived locally — the same pure
 * computation the contract itself does, needing no proof and no wallet — so it's known and
 * handed to `onServiceId` before proving even starts. This lets the caller show the resulting
 * m402 URL immediately, badged "confirming", rather than waiting the ~22-28s that proving,
 * submitting and confirming take (docs/constraints.md#proving-cost). */
export async function registerServiceOnChain(
  providers: M402Providers,
  contractAddress: string,
  args: RegisterServiceArgs,
  onPhase?: (phase: TxPhase) => void,
  onServiceId?: (serviceId: Uint8Array) => void,
): Promise<{ txId: string; serviceId: Uint8Array }> {
  const serviceId = pureCircuits.deriveServiceId(args.owner, args.salt, args.price);
  onServiceId?.(serviceId);
  const { txId } = await submit(providers, contractAddress, 'registerService', [args.salt, args.price, args.owner], onPhase);
  return { txId, serviceId };
}

/** Submits pay(serviceId). Generates a fresh receipt secret and stashes it in private state
 * *before* submitting (chain/witnesses.ts's receiptSecret witness consumes it), so the caller
 * has it in hand to send as X-Payment the moment the transaction confirms. */
export async function payForService(
  providers: M402Providers,
  contractAddress: string,
  serviceId: Uint8Array,
  onPhase?: (phase: TxPhase) => void,
): Promise<{ txId: string; receiptSecret: Uint8Array }> {
  await ensurePrivateState(providers, contractAddress);
  const receiptSecret = crypto.getRandomValues(new Uint8Array(32));
  const current = await providers.privateStateProvider.get(M402_PRIVATE_STATE_ID);
  await providers.privateStateProvider.set(M402_PRIVATE_STATE_ID, {
    ...(current ?? emptyPrivateState()),
    pendingReceiptSecret: receiptSecret,
  });

  const { txId } = await submit(providers, contractAddress, 'pay', [serviceId], onPhase);
  return { txId, receiptSecret };
}

/** Submits withdraw(serviceId, amount). serviceId only needs to be ANY service owned by the
 * caller — merchantBalance is keyed by owner, not by service, see m402Vault.compact. */
export async function withdrawBalance(
  providers: M402Providers,
  contractAddress: string,
  serviceId: Uint8Array,
  amount: bigint,
  onPhase?: (phase: TxPhase) => void,
): Promise<{ txId: string }> {
  return submit(providers, contractAddress, 'withdraw', [serviceId, amount], onPhase);
}
