import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findUnclaimedPayment,
  findUnresolvedRedeem,
  loadState,
  recordRedeem,
  recordPayment,
  updatePaymentStatus,
  withOperationLock,
  type StoredPayment,
} from '../state.js';

const payment: StoredPayment = {
  id: 'payment-1',
  txId: 'tx-1',
  serviceId: '11'.repeat(32),
  vaultAddress: '22'.repeat(32),
  url: 'https://gateway.example/s/test',
  price: '500',
  receiptSecret: '33'.repeat(32),
  receipt: '44'.repeat(32),
  status: 'pending',
  createdAt: '2026-08-07T00:00:00.000Z',
};

describe('agent state', () => {
  it('persists bearer secrets atomically with owner-only permissions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm402-state-'));
    const file = path.join(directory, 'preview.json');

    await recordPayment(file, payment);
    expect(await loadState(file)).toEqual({ version: 1, payments: [payment], redeems: [] });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('finds resumable payments and stops returning them after claim', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm402-state-'));
    const file = path.join(directory, 'preview.json');
    await recordPayment(file, payment);

    expect(await findUnclaimedPayment(file, payment.serviceId, payment.vaultAddress)).toEqual(payment);
    await updatePaymentStatus(file, payment.id, 'claimed');
    expect(await findUnclaimedPayment(file, payment.serviceId, payment.vaultAddress)).toBeUndefined();
  });

  it('rejects overlapping operations against the same wallet state', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm402-state-'));
    const file = path.join(directory, 'preview.json');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withOperationLock(file, () => held);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(withOperationLock(file, async () => undefined)).rejects.toThrow(
      'Another m402 operation is active',
    );

    release();
    await first;
  });

  it('keeps an ambiguous submitted redeem from being repeated', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm402-state-'));
    const file = path.join(directory, 'preview.json');
    const redeem = {
      id: 'redeem-1',
      txId: 'tx-redeem-1',
      vaultAddress: payment.vaultAddress,
      amount: '100',
      status: 'pending' as const,
      createdAt: payment.createdAt,
    };

    await recordRedeem(file, redeem);
    expect(await findUnresolvedRedeem(file, payment.vaultAddress)).toEqual(redeem);
  });
});
