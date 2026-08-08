import type { AgentContext, AgentPhase } from 'contracts/client';
import type { AgentConfig } from '../config.js';
import { readWalletSecret, requirePrivateStatePassword } from '../config.js';
import { CliError } from '../errors.js';
import type { Output } from '../output.js';
import { loadClient } from './client.js';

const phaseLabels: Record<AgentPhase, string> = {
  'starting-wallet': 'starting wallet',
  'syncing-wallet': 'syncing wallet',
  proving: 'generating proof',
  submitting: 'submitting transaction',
  confirming: 'waiting for confirmation',
};

export function parsePositiveAmount(value: string | undefined, label: string, unit = 'STAR'): bigint {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive integer in ${unit}.`);
  }
  return BigInt(value);
}

/**
 * Checks, before the ~5s client import and long before the multi-minute wallet sync, the two
 * things that can be checked without a wallet. A wrong vault address or a stopped proof
 * server used to surface eleven minutes in, after a full chain replay, which reads as a hang
 * rather than as a configuration mistake.
 *
 * Deliberately only these two. Balance and DUST registration need the synced wallet, and a
 * guess there would be worse than the honest failure.
 */
async function preflight(config: AgentConfig, vaultAddress: string): Promise<void> {
  const proofServer = config.networkConfig.proofServer;
  try {
    await fetch(proofServer, { signal: AbortSignal.timeout(3_000) });
  } catch {
    throw new CliError(
      `The proof server is not reachable at ${proofServer}.`,
      3,
      'Start the Midnight proof-server container and keep it bound to loopback.',
    );
  }

  // contracts/inspect-vault reads through the indexer only: no wallet, no proof server.
  const { readVaultState } = await import('contracts/inspect-vault');
  const state = await readVaultState(vaultAddress, config.networkConfig);
  if (!state) {
    throw new CliError(
      `No vault found at ${vaultAddress} on ${config.network}.`,
      2,
      'Check M402_VAULT_ADDRESS and --network. A freshly deployed vault may not be indexed yet.',
    );
  }
}

export async function withAgentContext<T>(
  config: AgentConfig,
  vaultAddress: string,
  output: Output,
  action: (context: AgentContext) => Promise<T>,
): Promise<T> {
  requirePrivateStatePassword();
  await preflight(config, vaultAddress);

  const spinner = output.spinner('loading wallet libraries');
  // Deliberately inside the spinner: this import takes ~5s on its own (see ./client.ts), and
  // it is the first thing the user waits on. Silence here reads as a hung CLI.
  const { buildAgentContext, stopAgentContext } = await loadClient();

  spinner.update('starting wallet');
  let context: AgentContext | undefined;
  try {
    context = await buildAgentContext({
      config: config.networkConfig,
      contractAddress: vaultAddress,
      secret: readWalletSecret(config),
      // Left unset so buildAgentContext can pick per case: minutes for a cold replay, a short
      // budget for a cached resume. MIDNIGHT_SYNC_TIMEOUT_MS overrides both.
      ...(process.env['MIDNIGHT_SYNC_TIMEOUT_MS']
        ? { syncTimeoutMs: Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS']) }
        : {}),
      privateStateStoreName: `m402-agent-${config.network}-${vaultAddress.slice(0, 12)}`,
      midnightDbName: config.midnightDbName,
      syncCacheDir: config.syncCacheDir,
      onSyncProgress: (summary) => spinner.update(summary),
      onPhase: (phase) => spinner.update(phaseLabels[phase]),
    });
    return await action(context);
  } finally {
    spinner.stop();
    if (context) await stopAgentContext(context);
  }
}
