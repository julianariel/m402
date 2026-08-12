import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensurePrivateStatePassword,
  generatePrivateStatePassword,
  loadAgentConfig,
  normalizeMnemonic,
  readWalletSecret,
  requirePrivateStatePassword,
} from '../config.js';

const originalVault = process.env['M402_VAULT_ADDRESS'];
const originalPassword = process.env['M402_PRIVATE_STATE_PASSWORD'];
const originalMnemonicFile = process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'];
const originalXdgStateHome = process.env['XDG_STATE_HOME'];
const originalXdgConfigHome = process.env['XDG_CONFIG_HOME'];
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
  if (originalXdgStateHome === undefined) delete process.env['XDG_STATE_HOME'];
  else process.env['XDG_STATE_HOME'] = originalXdgStateHome;
  if (originalXdgConfigHome === undefined) delete process.env['XDG_CONFIG_HOME'];
  else process.env['XDG_CONFIG_HOME'] = originalXdgConfigHome;
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

  it('defaults writable state under XDG_STATE_HOME/m402, not the package directory', () => {
    const xdgDir = mkdtempSync(path.join(tmpdir(), 'm402-xdg-'));
    tempDirs.push(xdgDir);
    process.env['XDG_STATE_HOME'] = xdgDir;
    delete process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'];

    const config = loadAgentConfig({ envFile: missingEnvFile });

    const expectedStateDir = path.join(xdgDir, 'm402');
    expect(config.stateFile).toBe(path.join(expectedStateDir, 'preview.json'));
    expect(config.operationLockFile).toBe(path.join(expectedStateDir, 'preview.operation'));
    expect(config.mnemonicFile).toBe(path.join(expectedStateDir, 'preview.mnemonic'));
    expect(config.syncCacheDir).toBe(path.join(expectedStateDir, 'sync-cache'));
    expect(config.midnightDbName).toBe(path.join(expectedStateDir, 'midnight-level-db-v1'));
  });

  it('defaults to ~/.m402 when XDG_STATE_HOME is unset', () => {
    delete process.env['XDG_STATE_HOME'];
    delete process.env['MIDNIGHT_PREVIEW_MNEMONIC_FILE'];

    const config = loadAgentConfig({ envFile: missingEnvFile });

    expect(config.stateFile.split(path.sep).slice(-2)).toEqual(['.m402', 'preview.json']);
  });

  it('moves the operation lock alongside a --state-file override', () => {
    // Previously hardcoded to the package directory regardless of --state-file, so a second
    // wallet driven through --state-file still contended on the default wallet's lock.
    const stateDir = mkdtempSync(path.join(tmpdir(), 'm402-state-'));
    tempDirs.push(stateDir);
    const stateFile = path.join(stateDir, 'custom.json');

    const config = loadAgentConfig({ envFile: missingEnvFile, stateFile });

    expect(config.operationLockFile).toBe(path.join(stateDir, 'preview.operation'));
  });

  it('generates a password that clears the strength policy', () => {
    for (let i = 0; i < 20; i++) {
      expect(() => validatePassword(generatePrivateStatePassword())).not.toThrow();
    }
  });

  it('normalizes numbered mnemonic listings to a bare space-separated phrase', () => {
    const numbered =
      '1. alpha 2) beta 3.gamma 4. delta 5) epsilon 6. zeta ' +
      '7. eta 8) theta 9. iota 10. kappa 11) lambda 12. mu';
    expect(normalizeMnemonic(numbered, 'test')).toBe(
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
    );
  });

  it('rejects a mnemonic with the wrong word count, naming the source', () => {
    expect(() => normalizeMnemonic('alpha beta gamma', 'my-source')).toThrow('my-source');
  });

  it('generates and stashes a private-state password, then reuses it on the next call with zero configuration', () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'm402-pw-'));
    tempDirs.push(configDir);
    process.env['XDG_CONFIG_HOME'] = configDir;
    delete process.env['M402_PRIVATE_STATE_PASSWORD'];

    const config = loadAgentConfig({ envFile: missingEnvFile });
    expect(process.env['M402_PRIVATE_STATE_PASSWORD']).toBeUndefined();

    const result = ensurePrivateStatePassword(config);
    expect(result.generated).toBe(true);
    const generated = process.env['M402_PRIVATE_STATE_PASSWORD'];
    expect(generated).toBeTruthy();
    expect(() => validatePassword(generated!)).not.toThrow();

    const stashed = JSON.parse(readFileSync(config.configFile, 'utf8')) as {
      privateStatePassword: string;
    };
    expect(stashed.privateStatePassword).toBe(generated);

    // A second call in the same run must not silently rotate the password.
    const secondResult = ensurePrivateStatePassword(config);
    expect(secondResult.generated).toBe(false);
    expect(process.env['M402_PRIVATE_STATE_PASSWORD']).toBe(generated);

    // Simulate the next `m402` invocation: no env var, same XDG_CONFIG_HOME.
    delete process.env['M402_PRIVATE_STATE_PASSWORD'];
    const nextRunConfig = loadAgentConfig({ envFile: missingEnvFile });
    expect(process.env['M402_PRIVATE_STATE_PASSWORD']).toBe(generated);
    expect(nextRunConfig.configFile).toBe(config.configFile);
  });

  it('never overwrites an operator-set password with a stashed one', () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'm402-pw-'));
    tempDirs.push(configDir);
    process.env['XDG_CONFIG_HOME'] = configDir;
    process.env['M402_PRIVATE_STATE_PASSWORD'] = 'Operator-Chosen-Password-123!';

    const config = loadAgentConfig({ envFile: missingEnvFile });
    const result = ensurePrivateStatePassword(config);

    expect(result.generated).toBe(false);
    expect(process.env['M402_PRIVATE_STATE_PASSWORD']).toBe('Operator-Chosen-Password-123!');
  });

  it('requires a private non-placeholder password for chain operations', () => {
    delete process.env['M402_PRIVATE_STATE_PASSWORD'];
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');

    process.env['M402_PRIVATE_STATE_PASSWORD'] = 'replace-with-a-long-private-password';
    expect(() => requirePrivateStatePassword()).toThrow('Set M402_PRIVATE_STATE_PASSWORD');
  });
});
