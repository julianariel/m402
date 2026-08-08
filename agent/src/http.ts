import { PAYMENT_HEADER, type PaymentRequired } from '@m402/shared';

export type FetchImplementation = typeof fetch;

export type InitialRequest =
  | { kind: 'resource'; response: Response; requestMs: number }
  | { kind: 'payment-required'; requirements: PaymentRequired; requestMs: number };

export type ClaimedResource = {
  response: Response;
  verifyMs: number;
};

export type ClaimOptions = {
  fetchImpl?: FetchImplementation;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (delayMs: number, attempt: number) => void;
};

const DEFAULT_RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function validateHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Gateway returned an invalid ${field}; expected 32-byte hex.`);
  }
  return value.toLowerCase();
}

async function parsePaymentRequired(response: Response): Promise<PaymentRequired> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Gateway returned HTTP 402 without a valid JSON payment body.');
  }

  if (!body || typeof body !== 'object') {
    throw new Error('Gateway returned an invalid payment body.');
  }
  const candidate = body as Record<string, unknown>;
  const price = candidate['price'];
  if (typeof price !== 'string' || !/^\d+$/.test(price) || BigInt(price) <= 0n) {
    throw new Error('Gateway returned an invalid price; expected a positive integer string.');
  }

  return {
    serviceId: validateHex(candidate['serviceId'], 'serviceId'),
    price,
    vaultAddress: validateHex(candidate['vaultAddress'], 'vaultAddress'),
  };
}

async function describeFailure(response: Response): Promise<Error> {
  const detail = (await response.text()).trim();
  const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
  if (response.status === 404) return new Error(`Service not found (HTTP 404)${suffix}`);
  return new Error(`Gateway request failed with HTTP ${response.status}${suffix}`);
}

export async function requestResource(
  url: string,
  options: Pick<ClaimOptions, 'fetchImpl' | 'signal'> = {},
): Promise<InitialRequest> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = performance.now();
  const response = await fetchImpl(url, { signal: options.signal });
  const requestMs = elapsed(startedAt);

  if (response.status === 402) {
    return {
      kind: 'payment-required',
      requirements: await parsePaymentRequired(response),
      requestMs,
    };
  }
  if (!response.ok) throw await describeFailure(response);
  return { kind: 'resource', response, requestMs };
}

export async function claimResource(
  url: string,
  receiptSecretHex: string,
  options: ClaimOptions = {},
): Promise<ClaimedResource> {
  if (!/^[0-9a-fA-F]{64}$/.test(receiptSecretHex)) {
    throw new Error('Receipt secret must be 32-byte hex.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = performance.now();

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, {
      headers: { [PAYMENT_HEADER]: receiptSecretHex },
      // X-Payment is a bearer credential. Never forward it across a redirect.
      redirect: 'manual',
      signal: options.signal,
    });

    if (response.status !== 402) {
      if (!response.ok) throw await describeFailure(response);
      return { response, verifyMs: elapsed(startedAt) };
    }

    const delay = retryDelays[attempt];
    if (delay === undefined) {
      throw new Error(
        'Payment is confirmed, but the gateway has not observed its receipt within the retry window.',
      );
    }
    options.onRetry?.(delay, attempt + 1);
    await sleep(delay);
  }
}
