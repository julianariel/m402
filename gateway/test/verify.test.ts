import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVerifier, type StateSubscribeFn, type ListServiceIds } from '../src/verify.js';
import type { DeriveReceipt } from '../src/receipt.js';
import type { ConsumedReceipts } from '../src/consumed.js';
import type { Ledger } from 'contracts/pure';

// Concatenation: combines secret and serviceId so tests can tell candidates
// for different services apart, unlike a plain identity function.
const combiningDeriveReceipt: DeriveReceipt = (secret, serviceId) =>
  Buffer.concat([Buffer.from(secret), Buffer.from(serviceId)]);

function fakeConsumedReceipts(seed: string[] = []): ConsumedReceipts {
  const set = new Set(seed);
  return {
    isConsumed: (r) => set.has(r),
    markConsumed: (r) => {
      const already = set.has(r);
      set.add(r);
      return already ? 'already-consumed' : 'consumed';
    },
  };
}

function fakeLedger(receiptHexes: string[]): Ledger {
  const receipts = new Set(receiptHexes);
  return {
    receipts: {
      member: (elem: Uint8Array) => receipts.has(Buffer.from(elem).toString('hex')),
    },
  } as unknown as Ledger;
}

function fakeSubscribeState(states: Ledger[] = []): StateSubscribeFn {
  return (_vaultAddress, onState) => {
    for (const state of states) onState(state);
    return () => {};
  };
}

describe('createVerifier', () => {
  it('resolves confirmed when the target receipt is a member of the ledger state', async () => {
    const target = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('01', 'hex'));
    const verify = createVerifier(
      fakeSubscribeState([fakeLedger([Buffer.from(target).toString('hex')])]),
      'vault-address',
      combiningDeriveReceipt,
      fakeConsumedReceipts(),
      () => ['01']
    );
    expect(await verify('aa', '01', 1000)).toBe('confirmed');
  });

  it('resolves replayed immediately, without subscribing, when the receipt is already consumed', async () => {
    const target = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('01', 'hex'));
    let subscribed = false;
    const subscribe: StateSubscribeFn = () => {
      subscribed = true;
      return () => {};
    };
    const verify = createVerifier(
      subscribe,
      'vault-address',
      combiningDeriveReceipt,
      fakeConsumedReceipts([Buffer.from(target).toString('hex')]),
      () => ['01']
    );
    expect(await verify('aa', '01', 1000)).toBe('replayed');
    expect(subscribed).toBe(false);
  });

  it('marks the receipt consumed once confirmed, so a second verify call replays', async () => {
    const target = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('01', 'hex'));
    const consumedReceipts = fakeConsumedReceipts();
    const verify = createVerifier(
      fakeSubscribeState([fakeLedger([Buffer.from(target).toString('hex')])]),
      'vault-address',
      combiningDeriveReceipt,
      consumedReceipts,
      () => ['01']
    );
    expect(await verify('aa', '01', 1000)).toBe('confirmed');
    expect(await verify('aa', '01', 1000)).toBe('replayed');
  });

  it('resolves wrong-service when the secret paid for a different registered service', async () => {
    // 'aa' paid against '02', but this request is checking service '01'.
    const wrongServiceReceipt = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('02', 'hex'));
    const verify = createVerifier(
      fakeSubscribeState([fakeLedger([Buffer.from(wrongServiceReceipt).toString('hex')])]),
      'vault-address',
      combiningDeriveReceipt,
      fakeConsumedReceipts(),
      () => ['01', '02']
    );
    expect(await verify('aa', '01', 1000)).toBe('wrong-service');
  });

  it('ignores unrelated ledger states and times out', async () => {
    vi.useFakeTimers();
    const unrelated = combiningDeriveReceipt(Buffer.from('cc', 'hex'), Buffer.from('01', 'hex'));
    const verify = createVerifier(
      fakeSubscribeState([fakeLedger([Buffer.from(unrelated).toString('hex')])]),
      'vault-address',
      combiningDeriveReceipt,
      fakeConsumedReceipts(),
      () => ['01']
    );
    const pending = verify('aa', '01', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe('timeout');
    vi.useRealTimers();
  });

  it('treats subscribe errors as noise and still resolves on a later matching state', async () => {
    const target = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('01', 'hex'));
    const subscribe: StateSubscribeFn = (_vaultAddress, onState, onError) => {
      onError(new Error('API-WS ... 1006 Abnormal Closure'));
      onState(fakeLedger([Buffer.from(target).toString('hex')]));
      return () => {};
    };
    const verify = createVerifier(subscribe, 'vault-address', combiningDeriveReceipt, fakeConsumedReceipts(), () => [
      '01',
    ]);
    expect(await verify('aa', '01', 1000)).toBe('confirmed');
  });

  it('unsubscribes exactly once after settling', async () => {
    const target = combiningDeriveReceipt(Buffer.from('aa', 'hex'), Buffer.from('01', 'hex'));
    const unsubscribe = vi.fn();
    const state = fakeLedger([Buffer.from(target).toString('hex')]);
    const subscribe: StateSubscribeFn = (_vaultAddress, onState) => {
      onState(state);
      onState(state); // duplicate emission, must not double-settle
      return unsubscribe;
    };
    const verify = createVerifier(subscribe, 'vault-address', combiningDeriveReceipt, fakeConsumedReceipts(), () => [
      '01',
    ]);
    await verify('aa', '01', 1000);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

const contractStateObservableMock = vi.fn();
const queryContractStateMock = vi.fn();
const ledgerMock = vi.fn();

vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: () => ({
    contractStateObservable: contractStateObservableMock,
    queryContractState: queryContractStateMock,
  }),
}));
vi.mock('contracts/pure', () => ({
  ledger: (data: unknown) => ledgerMock(data),
}));
vi.mock('ws', () => ({ WebSocket: class {} }));

describe('createPublicDataSubscribe', () => {
  beforeEach(() => {
    contractStateObservableMock.mockReset();
    ledgerMock.mockReset();
  });

  it('reconnects when the observable errors', async () => {
    const { createPublicDataSubscribe } = await import('../src/verify.js');
    let observer: { error: (err: unknown) => void } | undefined;
    contractStateObservableMock.mockImplementation((_address, _config, ...rest) => ({
      subscribe: (obs: { error: (err: unknown) => void }) => {
        observer = obs;
        return { unsubscribe: vi.fn() };
      },
    }));

    const subscribe = createPublicDataSubscribe('http://indexer', 'ws://indexer');
    subscribe('vault-address', () => {}, () => {});

    expect(contractStateObservableMock).toHaveBeenCalledTimes(1);
    observer?.error(new Error('1006'));
    expect(contractStateObservableMock).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes the underlying rxjs subscription when unsubscribed', async () => {
    const { createPublicDataSubscribe } = await import('../src/verify.js');
    const rxUnsubscribe = vi.fn();
    contractStateObservableMock.mockImplementation(() => ({
      subscribe: () => ({ unsubscribe: rxUnsubscribe }),
    }));

    const subscribe = createPublicDataSubscribe('http://indexer', 'ws://indexer');
    const unsubscribe = subscribe('vault-address', () => {}, () => {});
    unsubscribe();
    expect(rxUnsubscribe).toHaveBeenCalledOnce();
  });
});
