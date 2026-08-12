import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import {
  LOCAL_CONFIG,
  PREPROD_CONFIG,
  PREVIEW_CONFIG,
  type NetworkConfig,
} from 'contracts/lib/config';
import type { WalletSecret } from 'contracts/lib/wallet';

const AGENT_DIR = fileURLToPath(new URL('../', import.meta.url));

export type SupportedNetwork = 'local' | 'preview' | 'preprod';

export type ConfigOverrides = {
  envFile?: string;
  network?: string;
  vaultAddress?: string;
  mnemonicFile?: string;
  stateFile?: string;
};

export type AgentConfig = {
  network: SupportedNetwork;
  networkConfig: NetworkConfig;
  vaultAddress?: string;
  mnemonicFile: string;
  stateFile: string;
  operationLockFile: string;
  midnightDbName: string;
  syncCacheDir: string;
  configFile: string;
};

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * `~/.m402` by default, honouring `XDG_STATE_HOME` when set — this is writable state
 * (mnemonic, receipts, sync cache), not config, so `XDG_STATE_HOME` is the applicable var.
 * Installed globally from npm, `AGENT_DIR` sits inside the package directory and is possibly
 * read-only; nothing writable belongs there.
 */
function resolveStateDir(): string {
  const xdgStateHome = optional(process.env['XDG_STATE_HOME']);
  return xdgStateHome ? path.join(xdgStateHome, 'm402') : path.join(os.homedir(), '.m402');
}

/** `~/.m402` by default, honouring `XDG_CONFIG_HOME` when set — `config.json` is configuration,
 * not state, so it uses the other half of the XDG split. Falls back to the same directory as
 * `resolveStateDir` when neither XDG var is set, matching the flat `~/.m402` layout. */
function resolveConfigDir(): string {
  const xdgConfigHome = optional(process.env['XDG_CONFIG_HOME']);
  return xdgConfigHome ? path.join(xdgConfigHome, 'm402') : path.join(os.homedir(), '.m402');
}

type M402ConfigFile = {
  privateStatePassword?: string;
};

function readM402ConfigFile(configFile: string): M402ConfigFile {
  try {
    return JSON.parse(readFileSync(configFile, 'utf8')) as M402ConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

/** Merge-writes so a field this process does not know about (e.g. a gateway URL written by a
 * later command) survives a password write, and vice versa. */
function writeM402ConfigFile(configFile: string, patch: M402ConfigFile): void {
  const next = { ...readM402ConfigFile(configFile), ...patch };
  mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configFile, 0o600);
}

/** 24 random characters from a mixed alphabet, regenerated until it clears `validatePassword`'s
 * policy (length, character classes, no repeated/sequential runs) rather than hand-reimplementing
 * those rules against a moving target. */
export function generatePrivateStatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = Array.from(randomBytes(24), (byte) => alphabet[byte % alphabet.length]).join('');
    try {
      validatePassword(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Could not generate a private-state password meeting the strength policy.');
}

/**
 * Generates and persists a private-state password to `config.json`, then hydrates
 * `process.env['M402_PRIVATE_STATE_PASSWORD']` so the rest of this run picks it up exactly as
 * it would an operator-set override — `contracts/lib/providers.ts` reads that env var directly.
 * A no-op if a password is already available from either source.
 */
export function ensurePrivateStatePassword(config: AgentConfig): { generated: boolean } {
  if (optional(process.env['M402_PRIVATE_STATE_PASSWORD'])) return { generated: false };

  const password = generatePrivateStatePassword();
  writeM402ConfigFile(config.configFile, { privateStatePassword: password });
  process.env['M402_PRIVATE_STATE_PASSWORD'] = password;
  return { generated: true };
}

/** The normalized 12-24 word form `readWalletSecret` and `init --new --import` both parse to. */
export function normalizeMnemonic(raw: string, sourceLabel: string): string {
  const mnemonic = raw
    .replace(/\d+[.)]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const wordCount = mnemonic.split(' ').filter(Boolean).length;
  if (![12, 15, 18, 21, 24].includes(wordCount)) {
    throw new Error(`${sourceLabel}: expected a 12-24 word mnemonic, found ${wordCount}.`);
  }
  return mnemonic;
}

function loadOptionalEnvFile(file: string): void {
  try {
    loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function selectNetwork(value: string): { network: SupportedNetwork; config: NetworkConfig } {
  switch (value) {
    case 'local':
      return { network: value, config: LOCAL_CONFIG };
    case 'preview':
      return { network: value, config: PREVIEW_CONFIG };
    case 'preprod':
      return { network: value, config: PREPROD_CONFIG };
    default:
      throw new Error(`Unknown network '${value}'. Supported: local, preview, preprod.`);
  }
}

function resolveMnemonicFile(
  overrides: ConfigOverrides,
  network: SupportedNetwork,
  upper: string,
  fromEnvFile: (value: string) => string,
  stateDir: string,
): string {
  const flag = optional(overrides.mnemonicFile);
  if (flag) return path.resolve(flag);

  const fromEnv =
    optional(process.env[`MIDNIGHT_${upper}_MNEMONIC_FILE`]) ??
    optional(process.env['MIDNIGHT_MNEMONIC_FILE']);
  if (fromEnv) return fromEnvFile(fromEnv);

  // No override anywhere: the location `m402 init --new` writes to, so a freshly generated
  // wallet is found by every later command with zero configuration.
  return path.join(stateDir, `${network}.mnemonic`);
}

export function loadAgentConfig(overrides: ConfigOverrides = {}): AgentConfig {
  const envFile = path.resolve(overrides.envFile ?? path.join(AGENT_DIR, '.env'));
  loadOptionalEnvFile(envFile);

  // A relative path inside the env file is written relative to that file, not to whatever
  // directory the user happens to run `m402` from. Resolving it against cwd made
  // `MIDNIGHT_PREVIEW_MNEMONIC_FILE=.mnemonic` work from agent/ and fail everywhere else
  // with a bare `ENOENT: open '.mnemonic'`. Flags still resolve against cwd, as a CLI should.
  const fromEnvFile = (value: string) => path.resolve(path.dirname(envFile), value);

  const configFile = path.join(resolveConfigDir(), 'config.json');

  // An operator-set env var always wins; only hydrate from config.json's stash when unset, so
  // a password `init --new` generated on a previous run is found without extra configuration.
  if (!optional(process.env['M402_PRIVATE_STATE_PASSWORD'])) {
    const stashed = optional(readM402ConfigFile(configFile).privateStatePassword);
    if (stashed) process.env['M402_PRIVATE_STATE_PASSWORD'] = stashed;
  }
  const privateStatePassword = process.env['M402_PRIVATE_STATE_PASSWORD'];
  if (privateStatePassword) validatePassword(privateStatePassword);

  const selected = selectNetwork(optional(overrides.network) ?? process.env['MIDNIGHT_NETWORK'] ?? 'preview');
  const upper = selected.network.toUpperCase();
  const stateDir = resolveStateDir();
  const stateFileOverride = optional(overrides.stateFile);
  const stateFileFromEnv = optional(process.env['M402_STATE_FILE']);
  const stateFile = stateFileOverride
    ? path.resolve(stateFileOverride)
    : stateFileFromEnv
      ? fromEnvFile(stateFileFromEnv)
      : path.join(stateDir, `${selected.network}.json`);

  return {
    network: selected.network,
    networkConfig: selected.config,
    vaultAddress: optional(overrides.vaultAddress) ?? optional(process.env['M402_VAULT_ADDRESS']),
    mnemonicFile: resolveMnemonicFile(overrides, selected.network, upper, fromEnvFile, stateDir),
    stateFile,
    // Follows stateFile's directory rather than a fixed location, so a --state-file/
    // M402_STATE_FILE override (tests, a second wallet) moves the lock along with it instead
    // of leaving a stale lock behind in the default directory.
    operationLockFile: path.join(path.dirname(stateFile), `${selected.network}.operation`),
    midnightDbName: path.join(path.dirname(stateFile), 'midnight-level-db-v1'),
    // Sits beside the private-state DB and is a wallet secret in the same way: it holds the
    // wallet's synced view, including its coins.
    syncCacheDir: path.join(path.dirname(stateFile), 'sync-cache'),
    configFile,
  };
}

export function requirePrivateStatePassword(): void {
  const password = process.env['M402_PRIVATE_STATE_PASSWORD'];
  if (!password || password === 'replace-with-a-long-private-password') {
    throw new Error(
      'Set M402_PRIVATE_STATE_PASSWORD in agent/.env, or run m402 init --new to generate one.',
    );
  }
  validatePassword(password);
}

export function requireVaultAddress(config: AgentConfig): string {
  if (config.vaultAddress) return config.vaultAddress;
  throw new Error(
    'No vault configured. Pass --vault <address> or set M402_VAULT_ADDRESS in agent/.env.',
  );
}

export function readWalletSecret(config: AgentConfig): WalletSecret {
  let raw: string;
  try {
    raw = readFileSync(config.mnemonicFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Name the resolved absolute path. The raw ENOENT reports only the configured string,
    // so a relative path in agent/.env produced `open '.mnemonic'` with no hint of where
    // the CLI actually looked.
    throw new Error(
      `No wallet file at ${config.mnemonicFile}. ` +
        `Point MIDNIGHT_${config.network.toUpperCase()}_MNEMONIC_FILE at the file holding the ` +
        'mnemonic; a relative path is taken relative to agent/.env.',
    );
  }

  return { kind: 'mnemonic', value: normalizeMnemonic(raw, config.mnemonicFile) };
}
