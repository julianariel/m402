import { describe, expect, it } from 'vitest';
import { CliError, toCliError } from '../errors.js';

describe('CliError', () => {
  it('defaults code and retryable from exitCode when not given explicitly', () => {
    const configError = new CliError('bad config', 2);
    expect(configError.code).toBe('CONFIG_INVALID');
    expect(configError.retryable).toBe(false);

    const networkError = new CliError('unreachable', 4);
    expect(networkError.code).toBe('NETWORK_UNREACHABLE');
    expect(networkError.retryable).toBe(true);

    const operationError = new CliError('busy', 3);
    expect(operationError.code).toBe('OPERATION_FAILED');
    expect(operationError.retryable).toBe(false);

    const unknownError = new CliError('???', 1);
    expect(unknownError.code).toBe('UNKNOWN');
    expect(unknownError.retryable).toBe(false);
  });

  it('lets a specific code/retryable override the exitCode default', () => {
    const error = new CliError('busy', 3, undefined, { code: 'OPERATION_IN_PROGRESS', retryable: true });
    expect(error.code).toBe('OPERATION_IN_PROGRESS');
    expect(error.retryable).toBe(true);
  });

  it('serializes to the --json error shape', () => {
    const error = new CliError('bad config', 2, 'fix your .env');
    expect(error.toJSON()).toEqual({
      message: 'bad config',
      code: 'CONFIG_INVALID',
      retryable: false,
      hint: 'fix your .env',
    });
  });
});

describe('toCliError', () => {
  it('passes a CliError through unchanged', () => {
    const original = new CliError('already typed', 3, undefined, { code: 'CUSTOM' });
    expect(toCliError(original)).toBe(original);
  });

  it('classifies a proof-server-down error as retryable', () => {
    const error = toCliError(new Error('connect ECONNREFUSED 127.0.0.1:6300'));
    expect(error.code).toBe('PROOF_SERVER_UNREACHABLE');
    expect(error.retryable).toBe(true);
    expect(error.exitCode).toBe(3);
  });

  it('classifies a receipt reuse as non-retryable', () => {
    const error = toCliError(new Error('receipt reused'));
    expect(error.code).toBe('RECEIPT_REUSED');
    expect(error.retryable).toBe(false);
  });

  it('classifies a missing vault as a non-retryable config error', () => {
    const error = toCliError(new Error('No vault configured. Pass --vault or set M402_VAULT_ADDRESS.'));
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.retryable).toBe(false);
    expect(error.exitCode).toBe(2);
  });

  it('classifies a generic fetch failure as retryable network unreachable', () => {
    const error = toCliError(new Error('fetch failed'));
    expect(error.code).toBe('NETWORK_UNREACHABLE');
    expect(error.retryable).toBe(true);
    expect(error.exitCode).toBe(4);
  });

  it('falls back to UNKNOWN for an unrecognized error', () => {
    const error = toCliError(new Error('something bizarre'));
    expect(error.code).toBe('UNKNOWN');
    expect(error.retryable).toBe(false);
    expect(error.exitCode).toBe(1);
  });
});
