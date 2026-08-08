import {
  buildAgentContext,
  stopAgentContext,
  type AgentContext,
  type AgentPhase,
} from 'contracts/client';
import type { AgentConfig } from '../config.js';
import { readWalletSecret, requirePrivateStatePassword } from '../config.js';
import type { Output } from '../output.js';

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
  const spinner = output.spinner('starting wallet');
  let context: AgentContext | undefined;
  try {
    context = await buildAgentContext({
      config: config.networkConfig,
      contractAddress: vaultAddress,
      secret: readWalletSecret(config),
      syncTimeoutMs: Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? 60 * 60_000),
      privateStateStoreName: `m402-agent-${config.network}-${vaultAddress.slice(0, 12)}`,
      midnightDbName: config.midnightDbName,
      onPhase: (phase) => spinner.update(phaseLabels[phase]),
    });
    return await action(context);
  } finally {
    spinner.stop();
    if (context) await stopAgentContext(context);
  }
}
