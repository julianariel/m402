import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAgentConfig, requirePrivateStatePassword } from '../config.js';

const originalVault = process.env['M402_VAULT_ADDRESS'];
const originalPassword = process.env['M402_PRIVATE_STATE_PASSWORD'];
const missingEnvFile = path.join(process.cwd(), `.missing-env-${process.pid}`);

afterEach(() => {
  if (originalVault === undefined) delete process.env['M402_VAULT_ADDRESS'];
  else process.env['M402_VAULT_ADDRESS'] = originalVault;
  if (originalPassword === undefined) delete process.env['M402_PRIVATE_STATE_PASSWORD'];
  else process.env['M402_PRIVATE_STATE_PASSWORD'] = originalPassword;
});

describe('agent config', () => {
  it('prefers a command-line vault override over the environment', () => {
    process.env['M402_VAULT_ADDRESS'] = '11'.repeat(32);
    const config = loadAgentConfig({
      envFile: missingEnvFile,
      vaultAddress: '22'.repeat(32),
    });
    expect(config.network).toBe('preview');
    expect(config.vaultAddress).toBe('22'.repeat(32));
  });

  it('rejects a short private-state password before wallet startup', () => {
    process.env['M402_PRIVATE_STATE_PASSWORD'] = 'too-short';
    expect(() => loadAgentConfig({ envFile: missingEnvFile })).toThrow('16 characters');
  });

  it('requires a private non-placeholder password for chain operations', () => {
    delete process.env['M402_PRIVATE_STATE_PASSWORD'];
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');

    process.env['M402_PRIVATE_STATE_PASSWORD'] = 'replace-with-a-long-private-password';
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');
  });
});
