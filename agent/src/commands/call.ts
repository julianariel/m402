import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { PaymentResult } from 'contracts/client';
import type { AgentConfig } from '../config.js';
import { CliError } from '../errors.js';
import { claimResource, requestResource, type ClaimedResource } from '../http.js';
import type { Output } from '../output.js';
import { formatDuration } from '../output.js';
import {
  findUnclaimedPayment,
  markPaymentSubmitted,
  recordPayment,
  updatePaymentStatus,
  withOperationLock,
  type StoredPayment,
} from '../state.js';
import { loadClient } from './client.js';
import { withAgentContext } from './common.js';

export type CallOptions = {
  dryRun: boolean;
  allowOtherVault: boolean;
  fresh: boolean;
  signal?: AbortSignal;
};

function secretHex(secret: Uint8Array): string {
  return Buffer.from(secret).toString('hex');
}

async function printResource(
  claimed: ClaimedResource,
  output: Output,
  payment?: PaymentResult,
): Promise<void> {
  const contentType = claimed.response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await claimed.response.arrayBuffer());

  if (output.options.json) {
    let body: unknown;
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(bytes.toString('utf8'));
      } catch {
        body = bytes.toString('utf8');
      }
    } else if (contentType.startsWith('text/')) {
      body = bytes.toString('utf8');
    } else {
      body = { encoding: 'base64', data: bytes.toString('base64') };
    }
    output.data({
      status: claimed.response.status,
      contentType,
      body,
      gatewayMs: claimed.verifyMs,
      payment,
    });
    return;
  }

  process.stdout.write(bytes);
}

async function claimStoredPayment(
  payment: StoredPayment,
  config: AgentConfig,
  output: Output,
  signal?: AbortSignal,
): Promise<void> {
  output.info(
    `Resuming payment ${payment.txId ?? payment.id}; no new payment will be created.`,
  );
  const claimed = await claimResource(payment.url, payment.receiptSecret, {
    signal,
    onRetry: (delay, attempt) =>
      output.info(`Receipt not indexed yet; retry ${attempt} in ${formatDuration(delay)}.`),
  });
  await updatePaymentStatus(config.stateFile, payment.id, 'claimed');
  output.success(`Gateway accepted receipt in ${formatDuration(claimed.verifyMs)}.`);
  await printResource(claimed, output);
}

export async function callCommand(
  url: string | undefined,
  config: AgentConfig,
  output: Output,
  options: CallOptions,
): Promise<void> {
  if (!url) throw new CliError('call requires a gateway URL.', 2);

  const initial = await requestResource(url, { signal: options.signal });
  if (initial.kind === 'resource') {
    await printResource({ response: initial.response, verifyMs: initial.requestMs }, output);
    return;
  }

  const requirements = initial.requirements;
  output.info(
    `HTTP 402 | price ${requirements.price} STAR | service ${requirements.serviceId.slice(0, 12)}...`,
  );

  if (
    config.vaultAddress &&
    config.vaultAddress.toLowerCase() !== requirements.vaultAddress &&
    !options.allowOtherVault
  ) {
    throw new CliError(
      'The gateway requested payment to a different vault than M402_VAULT_ADDRESS.',
      2,
      `Configured: ${config.vaultAddress}\nRequested:  ${requirements.vaultAddress}\n` +
        'Use --allow-other-vault only after verifying the gateway deployment.',
    );
  }

  if (options.dryRun) {
    if (output.options.json) output.data({ dryRun: true, ...requirements });
    else output.info(`Dry run: would pay ${requirements.price} STAR to ${requirements.vaultAddress}.`);
    return;
  }

  if (!config.vaultAddress && !options.allowOtherVault) {
    throw new CliError(
      'No trusted vault is configured for payment.',
      2,
      'Set M402_VAULT_ADDRESS or pass --vault. Use --allow-other-vault only after verifying the gateway.',
    );
  }
  if (!config.vaultAddress) {
    output.warn(`Trusting gateway-selected vault ${requirements.vaultAddress}.`);
  }

  await withOperationLock(config.operationLockFile, async () => {
    const resumable = options.fresh
      ? undefined
      : await findUnclaimedPayment(config.stateFile, requirements.serviceId, requirements.vaultAddress);
    if (resumable && resumable.status !== 'prepared') {
      await claimStoredPayment(resumable, config, output, options.signal);
      return;
    }

    if (resumable?.status === 'prepared') {
      // Loaded here, not at module scope, so `--dry-run` above never pays for it. The ESM
      // registry caches it, so `withAgentContext` importing it again is free.
      const { hasReceipt } = await loadClient();
      const receiptIsOnChain = await withAgentContext(
        config,
        requirements.vaultAddress,
        output,
        (context) => hasReceipt(context, Buffer.from(resumable.receipt, 'hex')),
      );
      if (receiptIsOnChain) {
        await claimStoredPayment(resumable, config, output, options.signal);
        return;
      }
      throw new CliError(
        `Payment ${resumable.id} was prepared but its submission outcome is unknown.`,
        3,
        'Wait for the indexer and retry. Use --fresh only after confirming the receipt did not land.',
      );
    }

    output.info(`Network: ${config.network} | Vault: ${requirements.vaultAddress}`);
    const { payFor } = await loadClient();
    const paymentId = randomUUID();
    let stored: StoredPayment | undefined;
    let payment: PaymentResult;
    try {
      const result = await withAgentContext(config, requirements.vaultAddress, output, async (context) => {
        const paid = await payFor(
          context,
          Buffer.from(requirements.serviceId, 'hex'),
          BigInt(requirements.price),
          {
          onPrepared: async ({ receiptSecret, receipt }) => {
            stored = {
              id: paymentId,
              serviceId: requirements.serviceId,
              vaultAddress: requirements.vaultAddress,
              url,
              price: requirements.price,
              receiptSecret: secretHex(receiptSecret),
              receipt: secretHex(receipt),
              status: 'prepared',
              createdAt: new Date().toISOString(),
            };
            await recordPayment(config.stateFile, stored);
          },
          onSubmitted: async ({ txId }) => {
            await markPaymentSubmitted(config.stateFile, paymentId, txId);
          },
          },
        );
        return paid;
      });
      payment = result;
      if (!stored) throw new Error('Payment confirmed without a durable receipt record.');
      await updatePaymentStatus(config.stateFile, paymentId, 'confirmed');
    } catch (error) {
      // A timeout or local persistence error may happen after the transaction was
      // accepted. Keep it resumable unless the chain explicitly rejected it.
      if (stored && error instanceof Error && error.name === 'CallTxFailedError') {
        await updatePaymentStatus(config.stateFile, paymentId, 'failed');
      }
      throw error;
    }

    const claimed = await claimResource(url, secretHex(payment.receiptSecret), {
      signal: options.signal,
      onRetry: (delay, attempt) =>
        output.info(`Receipt not indexed yet; retry ${attempt} in ${formatDuration(delay)}.`),
    });
    await updatePaymentStatus(config.stateFile, paymentId, 'claimed');

    output.success(
      `Payment confirmed | proof ${formatDuration(payment.proveMs)} | ` +
        `submit ${formatDuration(payment.submitMs)} | chain ${formatDuration(payment.confirmMs)} | ` +
        `gateway ${formatDuration(claimed.verifyMs)}`,
    );
    await printResource(claimed, output, payment);
  });
}
