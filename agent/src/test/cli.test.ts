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

describe('CLI startup', () => {
  // Regression guard for the lazy `contracts/client` import (see src/commands/client.ts).
  //
  // That module costs ~5.2s to load, nearly all of it @midnight-ntwrk/testkit-js. It used to
  // be imported at module scope, so `m402 --version` took 8.5-9.1s under tsx and a mistyped
  // command took 6s to say so. Loading it at the point of use brought this to ~0.7-1.1s.
  //
  // The budget is deliberately loose: tsx alone costs ~0.4-0.65s before any of our code runs,
  // and this must not become the flaky test it replaced. 4s is ~4x the measured time while
  // still failing loudly if a top-level `import ... from 'contracts/client'` comes back
  // anywhere in the startup graph, which would put this back over 8s.
  const STARTUP_BUDGET_MS = 4_000;

  it('answers --version without loading the wallet libraries', async () => {
    const startedAt = performance.now();
    const { stdout } = await exec(TSX, [CLI, '--version'], { cwd: AGENT_DIR });
    const elapsed = performance.now() - startedAt;

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(elapsed).toBeLessThan(STARTUP_BUDGET_MS);
  });

  it('accepts init as a command rather than rejecting it', async () => {
    // `init` needs a wallet, so it cannot be run to completion here. What this pins down is
    // that it reaches configuration handling at all: before it was wired into the allow-list
    // in index.ts, it died as "Unknown command", which is the regression to catch.
    await expect(
      exec(TSX, [CLI, 'init'], {
        cwd: AGENT_DIR,
        env: { ...process.env, M402_VAULT_ADDRESS: '', M402_ENV_FILE: '/nonexistent' },
      }),
    ).rejects.toMatchObject({
      stderr: expect.not.stringContaining('Unknown command'),
    });
  });

  it('rejects arguments to init, which takes none', async () => {
    await expect(exec(TSX, [CLI, 'init', '500'], { cwd: AGENT_DIR })).rejects.toMatchObject({
      stderr: expect.stringContaining('init takes no arguments'),
    });
  });

  it('rejects an unknown command without loading the wallet libraries', async () => {
    const startedAt = performance.now();
    await expect(exec(TSX, [CLI, 'badcommand'], { cwd: AGENT_DIR })).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown command 'badcommand'"),
    });

    expect(performance.now() - startedAt).toBeLessThan(STARTUP_BUDGET_MS);
  });

  // deposit's amount is native NIGHT converted to credit 1:1 (STAR); redeem's amount is a
  // credit balance already held, entered as an exact atomic count (mSTAR). See
  // docs/design.md#4 and commands/common.ts's parsePositiveAmount.
  it('labels the deposit amount STAR and the redeem amount mSTAR', async () => {
    const { stdout } = await exec(TSX, [CLI, '--help'], { cwd: AGENT_DIR });

    expect(stdout).toContain('m402 deposit <amount-star>');
    expect(stdout).toContain('m402 redeem <amount-mstar>');
  });
});

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
