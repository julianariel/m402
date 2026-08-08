export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CliError';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = messageOf(error);

  if (/ECONNREFUSED.*6300|6300.*ECONNREFUSED/i.test(message)) {
    return new CliError(
      'The local proof server is not reachable on 127.0.0.1:6300.',
      3,
      'Start the Midnight proof-server container and keep it bound to loopback.',
      { cause: error },
    );
  }
  if (/underpaid|wrong amount/i.test(message)) {
    return new CliError(
      'The selected credit does not exactly match the service price.',
      3,
      'Sync the wallet and run the call again to fetch a fresh price.',
      { cause: error },
    );
  }
  if (/already spent/i.test(message)) {
    return new CliError(
      'The selected credit has already been spent.',
      3,
      'Sync the wallet and retry. If this persists, inspect the private-state store.',
      { cause: error },
    );
  }
  if (/receipt reused/i.test(message)) {
    return new CliError(
      'A receipt secret was reused; refusing to continue.',
      3,
      'Preserve agent/.state and the Midnight private-state database, then retry.',
      { cause: error },
    );
  }
  if (/unknown service/i.test(message)) {
    return new CliError(
      'This service is not registered in the selected vault.',
      3,
      'Check the gateway URL and M402_VAULT_ADDRESS.',
      { cause: error },
    );
  }
  if (/sync timeout/i.test(message)) {
    return new CliError(
      'Wallet synchronization timed out.',
      4,
      'Retry on a stable connection or increase MIDNIGHT_SYNC_TIMEOUT_MS.',
      { cause: error },
    );
  }
  if (/Another m402 operation is active/i.test(message)) {
    return new CliError(message, 3, 'Wait for the active operation to finish; do not retry in parallel.', {
      cause: error,
    });
  }
  if (/No vault configured|No wallet file configured|Unknown network|expected a 12-24 word mnemonic|private_state_password|^Password must/i.test(message)) {
    return new CliError(message, 2, undefined, { cause: error });
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return new CliError(
      'The gateway or Midnight network is not reachable.',
      4,
      'Check the URL, network selection, and internet connection.',
      { cause: error },
    );
  }

  return new CliError(message, 1, 'Re-run with --debug to print the original stack trace.', {
    cause: error,
  });
}
