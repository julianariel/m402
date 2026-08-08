import { depositCredit } from 'contracts/client';
import { requireVaultAddress, type AgentConfig } from '../config.js';
import type { Output } from '../output.js';
import { formatDuration } from '../output.js';
import { withOperationLock } from '../state.js';
import { parsePositiveAmount, withAgentContext } from './common.js';

export async function depositCommand(
  amountArg: string | undefined,
  config: AgentConfig,
  output: Output,
): Promise<void> {
  const amount = parsePositiveAmount(amountArg, 'Deposit amount');
  const vaultAddress = requireVaultAddress(config);
  output.info(`Network: ${config.network} | Vault: ${vaultAddress}`);

  const timing = await withOperationLock(config.operationLockFile, () =>
    withAgentContext(config, vaultAddress, output, (context) => depositCredit(context, amount)),
  );

  if (output.options.json) {
    output.data({ command: 'deposit', amount: amount.toString(), vaultAddress, ...timing });
    return;
  }
  output.success(
    `Deposited ${amount} credits (one-off) | proof ${formatDuration(timing.proveMs)} | ` +
      `confirm ${formatDuration(timing.confirmMs)}`,
  );
  output.info('Next: m402 call <gateway-url>');
}
