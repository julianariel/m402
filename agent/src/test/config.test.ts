import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAgentConfig, readWalletSecret, requirePrivateStatePassword } from '../config.js';

const originalVault = process.env['M402_VAULT_ADDRESS'];
const originalPassword = process.env['M402_PRIVATE_STATE_PASSWORD'];
const originalMnemonicFile = process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'];
const missingEnvFile = path.join(process.cwd(), `.missing-env-${process.pid}`);

const tempDirs: string[] = [];

/** An env file in a directory of its own, so "relative to the env file" is observable. */
function envFileWith(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'm402-cfg-'));
  tempDirs.push(dir);
  const file = path.join(dir, '.env');
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  if (originalVault === undefined) delete process.env['M402_VAULT_ADDRESS'];
  else process.env['M402_VAULT_ADDRESS'] = originalVault;
  if (originalPassword === undefined) delete process.env['M402_PRIVATE_STATE_PASSWORD'];
  else process.env['M402_PRIVATE_STATE_PASSWORD'] = originalPassword;
  if (originalMnemonicFile === undefined) delete process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'];
  else process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'] = originalMnemonicFile;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
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

  it('resolves a relative mnemonic path against the env file, not the working directory', () => {
    // The env file's directory is a temp dir, and the test process runs in agent/, so a path
    // resolved against cwd cannot accidentally pass. Previously `.mnemonic` was used verbatim,
    // so `m402 deposit` worked from agent/ and failed everywhere else.
    const envFile = envFileWith('MIDNIGHT_PREVIEW_MNEMONIC_FILE=.mnemonic\n');

    const config = loadAgentConfig({ envFile });

    expect(config.mnemonicFile).toBe(path.join(path.dirname(envFile), '.mnemonic'));
    expect(path.isAbsolute(config.mnemonicFile!)).toBe(true);
  });

  it('resolves --mnemonic-file against the working directory, as a flag should', () => {
    const envFile = envFileWith('MIDNIGHT_PREVIEW_MNEMONIC_FILE=.mnemonic\n');

    const config = loadAgentConfig({ envFile, mnemonicFile: 'flag.mnemonic' });

    expect(config.mnemonicFile).toBe(path.resolve('flag.mnemonic'));
  });

  it('names the resolved path when the wallet file is missing', () => {
    // The bare ENOENT reported only the configured string — `open '.mnemonic'` — which named
    // neither the file it wanted nor where it looked.
    const envFile = envFileWith('MIDNIGHT_PREVIEW_MNEMONIC_FILE=.mnemonic\n');
    const config = loadAgentConfig({ envFile });

    expect(() => readWalletSecret(config)).toThrow(path.dirname(envFile));
  });

  it('requires a private non-placeholder password for chain operations', () => {
    delete process.env['M402_PRIVATE_STATE_PASSWORD'];
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');

    process.env['M402_PRIVATE_STATE_PASSWORD'] = 'replace-with-a-long-private-password';
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');
  });
});
