import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockGateway, type MockGateway } from './mock-gateway.js';

const exec = promisify(execFile);
const AGENT_DIR = fileURLToPath(new URL('../../', import.meta.url));
const TSX = path.resolve(AGENT_DIR, '..', 'node_modules', '.bin', 'tsx');
const CLI = path.resolve(AGENT_DIR, 'src', 'index.ts');
const SERVICE_ID = '11'.repeat(32);
const VAULT_ADDRESS = '22'.repeat(32);

describe('CLI', () => {
  let gateway: MockGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
    gateway = undefined;
  });

  it('performs a JSON dry-run without starting a wallet', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: '33'.repeat(32),
    });

    const { stdout, stderr } = await exec(
      TSX,
      [CLI, 'call', `${gateway.url}/s/test`, '--dry-run', '--vault', VAULT_ADDRESS, '--json'],
      { cwd: AGENT_DIR },
    );

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      dryRun: true,
      serviceId: SERVICE_ID,
      price: '500',
      vaultAddress: VAULT_ADDRESS,
    });
  });

  it('refuses a mismatched configured vault by default', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: '33'.repeat(32),
    });

    await expect(
      exec(
        TSX,
        [CLI, 'call', `${gateway.url}/s/test`, '--dry-run', '--vault', '44'.repeat(32)],
        { cwd: AGENT_DIR },
      ),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('different vault'),
    });
  });

  it('requires an explicit trusted vault before paying', async () => {
    gateway = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: '500', vaultAddress: VAULT_ADDRESS },
      receiptSecret: '33'.repeat(32),
    });

    await expect(
      exec(TSX, [CLI, 'call', `${gateway.url}/s/test`], {
        cwd: AGENT_DIR,
        env: { ...process.env, M402_VAULT_ADDRESS: '' },
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('No trusted vault'),
    });
  });
});
