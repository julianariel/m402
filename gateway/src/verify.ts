import { WebSocket } from 'ws';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger, type Ledger } from 'contracts/pure';
import type { Verify, VerifyResult } from './routes.js';
import type { DeriveReceipt } from './receipt.js';
import type { ConsumedReceipts } from './consumed.js';

export type Unsubscribe = () => void;
export type StateSubscribeFn = (
  vaultAddress: string,
  onState: (ledgerState: Ledger) => void,
  onError: (err: unknown) => void
) => Unsubscribe;
export type ListServiceIds = () => string[];

export function createVerifier(
  subscribeState: StateSubscribeFn,
  vaultAddress: string,
  deriveReceipt: DeriveReceipt,
  consumedReceipts: ConsumedReceipts,
  listServiceIds: ListServiceIds
): Verify {
  return function verifyReceipt(receiptSecret, serviceId, timeoutMs) {
    const secretBytes = Buffer.from(receiptSecret, 'hex');
    const targetBytes = Buffer.from(deriveReceipt(secretBytes, Buffer.from(serviceId, 'hex')));
    const targetHex = targetBytes.toString('hex');

    // The on-chain receipts set proves this secret paid, once, ever — it does
    // not prove this request hasn't already redeemed it. That's ours to track.
    if (consumedReceipts.isConsumed(targetHex)) {
      return Promise.resolve('replayed');
    }

    // deriveReceipt bakes serviceId into the hash, so a secret that paid for
    // a DIFFERENT service produces a hash that will never match `target` —
    // without this, that case would silently degrade to a timeout instead of
    // a distinguishable "wrong service" result. Precompute every other
    // registered service's candidate hash up front, once, rather than
    // recomputing per incoming state update.
    const otherCandidates = listServiceIds()
      .filter((id) => id !== serviceId)
      .map((id) => Buffer.from(deriveReceipt(secretBytes, Buffer.from(id, 'hex'))));

    return new Promise<VerifyResult>((resolve) => {
      let settled = false;
      let unsubscribe: Unsubscribe | undefined;
      let settledBeforeSubscribed = false;

      const timer = setTimeout(() => finish('timeout'), timeoutMs);

      function finish(result: VerifyResult) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result === 'confirmed') consumedReceipts.markConsumed(targetHex);
        if (unsubscribe) {
          unsubscribe();
        } else {
          // subscribeState() hasn't returned yet — it called onState
          // synchronously from inside its own body. Defer the unsubscribe
          // call until we have the real function, right after it returns.
          settledBeforeSubscribed = true;
        }
        resolve(result);
      }

      unsubscribe = subscribeState(
        vaultAddress,
        (ledgerState) => {
          if (ledgerState.receipts.member(targetBytes)) {
            finish('confirmed');
            return;
          }
          for (const candidate of otherCandidates) {
            if (ledgerState.receipts.member(candidate)) {
              finish('wrong-service');
              return;
            }
          }
        },
        () => {
          // Transient socket errors (including 1006 abnormal closure) are
          // noise during indexer sync, per constraints.md. Ignore them —
          // createPublicDataSubscribe reconnects internally, and this
          // promise is governed by the timeout above, not by socket health.
        }
      );

      if (settledBeforeSubscribed) unsubscribe();
    });
  };
}

// Confirmed shape: contractStateObservable and queryContractState are typed,
// documented SDK entry points (@midnight-ntwrk/midnight-js-types), not a
// hand-rolled GraphQL query against a guessed schema. What's still unverified
// is runtime reconnect behaviour under a real socket drop against live
// Preview — the wrapper below reconnects defensively regardless.
export function createPublicDataSubscribe(indexerUrl: string, indexerWsUrl: string): StateSubscribeFn {
  // Assigned to the global rather than passed as indexerPublicDataProvider's
  // third argument — same pattern as contracts/src/test/deploy.test.ts,
  // which has actually been run against live Preview. The third-argument
  // path expects isomorphic-ws's CJS `export =` shape, which the `ws`
  // package's ESM types don't structurally match without an unsafe cast.
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
  const provider = indexerPublicDataProvider(indexerUrl, indexerWsUrl);

  return (vaultAddress, onState, onError) => {
    let disposed = false;
    let subscription = connect();

    function connect() {
      return provider.contractStateObservable(vaultAddress, { type: 'latest' }).subscribe({
        next: (state) => onState(ledger(state.data)),
        error: (err) => {
          onError(err);
          if (!disposed) subscription = connect();
        },
        complete: () => {
          if (!disposed) subscription = connect();
        },
      });
    }

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  };
}
