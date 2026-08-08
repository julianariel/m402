import type { AgentContext, AgentPhase } from 'contracts/client';
import type { AgentConfig } from '../config.js';
import { readWalletSecret, requirePrivateStatePassword } from '../config.js';
import type { Output } from '../output.js';
import { loadClient } from './client.js';

const phaseLabels: Record<AgentPhase, string> = {
  'starting-wallet': 'starting wallet',
  'syncing-wallet': 'syncing wallet',
  proving: 'generating proof',
  submitting: 'submitting transaction',
  confirming: 'waiting for confirmation',
};

export function parsePositiveAmount(value: string | undefined, label: string): bigint {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive integer in STAR.`);
  }
  return BigInt(value);
}

export async function withAgentContext<T>(
  config: AgentConfig,
  vaultAddress: string,
  output: Output,
  action: (context: AgentContext) => Promise<T>,
): Promise<T> {
  requirePrivateStatePassword();
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
