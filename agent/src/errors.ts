export type CliErrorOptions = ErrorOptions & {
  /** Stable machine identifier for --json error output. Defaults from exitCode when omitted,
   * so every existing `new CliError(message, exitCode, hint)` call site still gets one. */
  code?: string;
  /** Whether retrying the same command, unmodified, could plausibly succeed. Defaults from
   * exitCode: only exit 4 (network/timeout) defaults to true. */
  retryable?: boolean;
};

function defaultCodeForExitCode(exitCode: number): string {
  switch (exitCode) {
    case 2:
      return 'CONFIG_INVALID';
    case 3:
      return 'OPERATION_FAILED';
    case 4:
      return 'NETWORK_UNREACHABLE';
    default:
      return 'UNKNOWN';
  }
}

export class CliError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly exitCode: number,
    readonly hint?: string,
    options?: CliErrorOptions,
  ) {
    super(message, options);
    this.name = 'CliError';
    this.code = options?.code ?? defaultCodeForExitCode(exitCode);
    this.retryable = options?.retryable ?? exitCode === 4;
  }

  /** `--json` error shape: `{"error": {...}}` on stdout, so an agent parsing stdout as JSON
   * never has to fall back to scraping stderr text. */
  toJSON(): { message: string; code: string; retryable: boolean; hint?: string } {
    return { message: this.message, code: this.code, retryable: this.retryable, hint: this.hint };
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
      { cause: error, code: 'PROOF_SERVER_UNREACHABLE', retryable: true },
    );
  }
  if (/underpaid|wrong amount/i.test(message)) {
    return new CliError(
      'The selected credit does not exactly match the service price.',
      3,
      'Sync the wallet and run the call again to fetch a fresh price.',
      { cause: error, code: 'PRICE_MISMATCH', retryable: true },
    );
  }
  if (/already spent/i.test(message)) {
    return new CliError(
      'The selected credit has already been spent.',
      3,
      'Sync the wallet and retry. If this persists, inspect the private-state store.',
      { cause: error, code: 'CREDIT_ALREADY_SPENT', retryable: false },
    );
  }
  if (/receipt reused/i.test(message)) {
    return new CliError(
      'A receipt secret was reused; refusing to continue.',
      3,
      'Preserve agent/.state and the Midnight private-state database, then retry.',
      { cause: error, code: 'RECEIPT_REUSED', retryable: false },
    );
  }
  if (/unknown service/i.test(message)) {
    return new CliError(
      'This service is not registered in the selected vault.',
      3,
      'Check the gateway URL and M402_VAULT_ADDRESS.',
      { cause: error, code: 'UNKNOWN_SERVICE', retryable: false },
    );
  }
  if (/sync timeout/i.test(message)) {
    return new CliError(
      'Wallet synchronization timed out.',
      4,
      'Retry on a stable connection or increase MIDNIGHT_SYNC_TIMEOUT_MS.',
      { cause: error, code: 'SYNC_TIMEOUT', retryable: true },
    );
  }
  if (/Another m402 operation is active/i.test(message)) {
    return new CliError(message, 3, 'Wait for the active operation to finish; do not retry in parallel.', {
      cause: error,
      code: 'OPERATION_IN_PROGRESS',
      retryable: true,
    });
  }
  // `No wallet file` covers both "…configured" (nothing set) and "…at <path>" (set but
  // missing). Both are configuration errors and must exit 2, not 1.
  if (/No vault configured|No wallet file|Unknown network|expected a 12-24 word mnemonic|private_state_password|^Password must/i.test(message)) {
    return new CliError(message, 2, undefined, { cause: error, code: 'CONFIG_INVALID', retryable: false });
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return new CliError(
      'The gateway or Midnight network is not reachable.',
      4,
      'Check the URL, network selection, and internet connection.',
      { cause: error, code: 'NETWORK_UNREACHABLE', retryable: true },
    );
  }

  return new CliError(message, 1, 'Re-run with --debug to print the original stack trace.', {
    cause: error,
    code: 'UNKNOWN',
    retryable: false,
  });
}
