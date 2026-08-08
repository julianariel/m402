import { afterEach, describe, expect, it } from 'vitest';
import { claimResource, requestResource } from '../http.js';
import { startMockGateway, type MockGateway } from './mock-gateway.js';

const SERVICE_ID = '11'.repeat(32);
const VAULT_ADDRESS = '22'.repeat(32);
const SECRET = '33'.repeat(32);

describe('gateway HTTP flow', () => {
  let gateway: MockGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
    gateway = undefined;
  });

  it('parses a 402 and retries with the receipt secret', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: SECRET,
    });

    const initial = await requestResource(`${gateway.url}/s/test`);
    expect(initial).toMatchObject({
      kind: 'payment-required',
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
    });

    const claimed = await claimResource(`${gateway.url}/s/test`, SECRET);
    await expect(claimed.response.json()).resolves.toEqual({ value: 42 });
    expect(gateway.paymentHeaders).toEqual([SECRET]);
  });

  it('retries only the claim while the gateway indexer lags', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: SECRET,
      laggedClaims: 2,
    });
    const retries: number[] = [];

    const claimed = await claimResource(`${gateway.url}/s/test`, SECRET, {
      retryDelaysMs: [0, 0],
      sleep: async () => undefined,
      onRetry: (_delay, attempt) => retries.push(attempt),
    });

    expect(claimed.response.status).toBe(200);
    expect(retries).toEqual([1, 2]);
    expect(gateway.paymentHeaders).toEqual([SECRET, SECRET, SECRET]);
  });

  it('reports unknown services without trying to pay', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: SECRET,
    });
    await expect(requestResource(`${gateway.url}/missing`)).rejects.toThrow('Service not found');
    expect(gateway.paymentHeaders).toEqual([]);
  });

  it('never forwards a receipt secret through a redirect', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: SECRET,
    });

    await expect(claimResource(`${gateway.url}/redirect`, SECRET)).rejects.toThrow('HTTP 302');
    expect(gateway.paymentHeaders).toEqual([]);
  });
});
