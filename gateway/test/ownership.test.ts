import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOwnershipChecker } from '../src/ownership.js';

const queryContractStateMock = vi.fn();
const ledgerMock = vi.fn();

vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: () => ({ queryContractState: queryContractStateMock }),
}));
vi.mock('contracts/pure', () => ({
  ledger: (data: unknown) => ledgerMock(data),
}));

function fakeServiceOwner(entries: Record<string, string>) {
  return {
    member: (idBytes: Uint8Array) =>
      Object.prototype.hasOwnProperty.call(entries, Buffer.from(idBytes).toString('hex')),
    lookup: (idBytes: Uint8Array) => Buffer.from(entries[Buffer.from(idBytes).toString('hex')], 'hex'),
  };
}

describe('createOwnershipChecker', () => {
  beforeEach(() => {
    queryContractStateMock.mockReset();
    ledgerMock.mockReset();
  });

  it('returns unconfirmed when the vault has no state yet', async () => {
    queryContractStateMock.mockResolvedValue(null);
    const check = createOwnershipChecker('http://indexer', 'ws://indexer', 'vault-address');
    expect(await check('aa', 'bb')).toBe('unconfirmed');
  });

  it('returns unconfirmed when the id is not registered on-chain', async () => {
    queryContractStateMock.mockResolvedValue({ data: {} });
    ledgerMock.mockReturnValue({ serviceOwner: fakeServiceOwner({}) });
    const check = createOwnershipChecker('http://indexer', 'ws://indexer', 'vault-address');
    expect(await check('aa', 'bb')).toBe('unconfirmed');
  });

  it('returns match when the claimed owner equals the on-chain owner', async () => {
    queryContractStateMock.mockResolvedValue({ data: {} });
    ledgerMock.mockReturnValue({ serviceOwner: fakeServiceOwner({ aa: 'bb' }) });
    const check = createOwnershipChecker('http://indexer', 'ws://indexer', 'vault-address');
    expect(await check('aa', 'bb')).toBe('match');
  });

  it('is case-insensitive when comparing hex owners', async () => {
    queryContractStateMock.mockResolvedValue({ data: {} });
    ledgerMock.mockReturnValue({ serviceOwner: fakeServiceOwner({ aa: 'bb' }) });
    const check = createOwnershipChecker('http://indexer', 'ws://indexer', 'vault-address');
    expect(await check('aa', 'BB')).toBe('match');
  });

  it('returns mismatch when the claimed owner differs from the on-chain owner', async () => {
    queryContractStateMock.mockResolvedValue({ data: {} });
    ledgerMock.mockReturnValue({ serviceOwner: fakeServiceOwner({ aa: 'bb' }) });
    const check = createOwnershipChecker('http://indexer', 'ws://indexer', 'vault-address');
    expect(await check('aa', 'cc')).toBe('mismatch');
  });
});
