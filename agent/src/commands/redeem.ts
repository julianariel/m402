import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { redeemCredit } from 'contracts/client';
import {
  requirePrivateStatePassword,
  requireVaultAddress,
  type AgentConfig,
} from '../config.js';
import { CliError } from '../errors.js';
import type { Output } from '../output.js';
import { formatDuration } from '../output.js';
import {
  findUnresolvedRedeem,
  markRedeemSubmitted,
  recordRedeem,
  updateRedeemStatus,
  withOperationLock,
} from '../state.js';
import { parsePositiveAmount, withAgentContext } from './common.js';

async function confirmRedeem(amount: bigint): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await readline.question(
      `Redeem ${amount} credits to this wallet's own unshielded address? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function redeemCommand(
  amountArg: string | undefined,
  config: AgentConfig,
  output: Output,
  yes: boolean,
): Promise<void> {
  const amount = parsePositiveAmount(amountArg, 'Redeem amount');
  const vaultAddress = requireVaultAddress(config);
  requirePrivateStatePassword();

  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new CliError('Redeem requires --yes when stdin is not interactive.', 2);
    }
    if (!(await confirmRedeem(amount))) {
      output.info('Redeem cancelled.');
      return;
    }
  }

  output.info(`Network: ${config.network} | Vault: ${vaultAddress}`);
  const timing = await withOperationLock(config.operationLockFile, async () => {
    const unresolved = await findUnresolvedRedeem(config.stateFile, vaultAddress);
    if (unresolved) {
      throw new CliError(
        `Redeem ${unresolved.txId ?? unresolved.id} has an unresolved submission state.`,
        3,
        'Do not submit another redeem until the earlier transaction is reconciled.',
      );
    }

    const id = randomUUID();
    await recordRedeem(config.stateFile, {
      id,
      vaultAddress,
      amount: amount.toString(),
      status: 'prepared',
      createdAt: new Date().toISOString(),
    });

    try {
      const result = await withAgentContext(config, vaultAddress, output, (context) =>
        redeemCredit(context, amount, {
          onSubmitted: async ({ txId }) => {
            await markRedeemSubmitted(config.stateFile, id, txId);
          },
        }),
      );
      await updateRedeemStatus(config.stateFile, id, 'confirmed');
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'CallTxFailedError') {
        await updateRedeemStatus(config.stateFile, id, 'failed');
      }
      throw error;
    }
  });

  if (output.options.json) {
    output.data({ command: 'redeem', amount: amount.toString(), vaultAddress, ...timing });
    return;
  }
  output.success(
    `Redeemed ${amount} credits to this wallet | proof ${formatDuration(timing.proveMs)} | ` +
      `confirm ${formatDuration(timing.confirmMs)}`,
  );
}
