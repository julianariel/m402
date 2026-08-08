import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHealthProbe } from '../src/health.js';

describe('createHealthProbe', () => {
  let server: Server;
  let baseUrl: string;
  let status = 200;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(status);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : '';
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns true for a healthy origin', async () => {
    status = 200;
    const probe = createHealthProbe(5000);
    expect(await probe(baseUrl)).toBe(true);
  });

  it('returns false for a 5xx origin', async () => {
    status = 503;
    const probe = createHealthProbe(5000);
    expect(await probe(baseUrl)).toBe(false);
  });

  it('returns false for an unreachable origin', async () => {
    const probe = createHealthProbe(5000);
    expect(await probe('http://127.0.0.1:1')).toBe(false);
  });

  it('caches a result within the TTL — only one real probe for two calls', async () => {
    status = 200;
    hits = 0;
    const probe = createHealthProbe(5000);
    await probe(baseUrl);
    await probe(baseUrl);
    expect(hits).toBe(1);
  });

  it('re-probes once the TTL has expired', async () => {
    status = 200;
    hits = 0;
    const probe = createHealthProbe(50);
    await probe(baseUrl);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await probe(baseUrl);
    expect(hits).toBe(2);
  });
});
