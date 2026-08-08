import { readFileSync } from 'node:fs';
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
  mnemonicFile?: string;
  stateFile: string;
  operationLockFile: string;
  midnightDbName: string;
};

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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

export function loadAgentConfig(overrides: ConfigOverrides = {}): AgentConfig {
  loadOptionalEnvFile(path.resolve(overrides.envFile ?? path.join(AGENT_DIR, '.env')));

  const privateStatePassword = process.env['M402_PRIVATE_STATE_PASSWORD'];
  if (privateStatePassword) validatePassword(privateStatePassword);

  const selected = selectNetwork(optional(overrides.network) ?? process.env['MIDNIGHT_NETWORK'] ?? 'preview');
  const upper = selected.network.toUpperCase();
  const stateFile = path.resolve(
    optional(overrides.stateFile) ??
      process.env['M402_STATE_FILE'] ??
      path.join(AGENT_DIR, '.state', `${selected.network}.json`),
  );

  return {
    network: selected.network,
    networkConfig: selected.config,
    vaultAddress: optional(overrides.vaultAddress) ?? optional(process.env['M402_VAULT_ADDRESS']),
    mnemonicFile:
      optional(overrides.mnemonicFile) ??
      optional(process.env[`MIDNIGHT_${upper}_MNEMONIC_FILE`]) ??
      optional(process.env['MIDNIGHT_MNEMONIC_FILE']),
    stateFile,
    operationLockFile: path.join(AGENT_DIR, '.state', `${selected.network}.operation`),
    midnightDbName: path.join(path.dirname(stateFile), 'midnight-level-db-v1'),
  };
}

export function requirePrivateStatePassword(): void {
  const password = process.env['M402_PRIVATE_STATE_PASSWORD'];
  if (!password || password === 'replace-with-a-long-private-password') {
    throw new Error(
      'Set M402_PRIVATE_STATE_PASSWORD in agent/.env to a private value of at least 16 characters.',
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
  if (!config.mnemonicFile) {
    throw new Error(
      `No wallet file configured. Set MIDNIGHT_${config.network.toUpperCase()}_MNEMONIC_FILE ` +
        'to a path containing the mnemonic. Never put the words themselves in an environment variable.',
    );
  }

  const raw = readFileSync(config.mnemonicFile, 'utf8');
  const mnemonic = raw
    .replace(/\d+[.)]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const wordCount = mnemonic.split(' ').filter(Boolean).length;
  if (![12, 15, 18, 21, 24].includes(wordCount)) {
    throw new Error(`${config.mnemonicFile}: expected a 12-24 word mnemonic, found ${wordCount}.`);
  }
  return { kind: 'mnemonic', value: mnemonic };
}
