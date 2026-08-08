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

/** The gateway reports why it refused in a JSON `reason` field. Absent on a bare body. */
function reasonFrom(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const reason = (parsed as Record<string, unknown>)['reason'];
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The body is consumed here rather than inside this function: a Response body can only be
 * read once, and the retry decision needs to inspect `reason` before deciding whether this
 * is a failure at all.
 */
function describeFailure(response: Response, bodyText: string, reason?: string): Error {
  const suffix = bodyText ? `: ${bodyText.slice(0, 300)}` : '';

  if (response.status === 404) return new Error(`Service not found (HTTP 404)${suffix}`);

  // A 402 answering a request that CARRIED a receipt secret is terminal. Retrying cannot
  // make a spent secret unspent, nor make a secret pay for a service it did not pay for.
  if (reason === 'receipt-already-used') {
    return new Error(
      'This receipt has already been used. The resource was delivered for this payment; ' +
        'a new call needs a new payment.',
    );
  }
  if (reason === 'wrong-service') {
    return new Error(
      'This payment was made for a different service than the one being claimed. ' +
        'Check that the URL matches the service that was paid for.',
    );
  }

  return new Error(`Gateway request failed with HTTP ${response.status}${suffix}`);
}

/** `Retry-After` in seconds. Capped, so a hostile or mistaken gateway cannot stall the CLI. */
const MAX_RETRY_AFTER_MS = 30_000;

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
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
  if (!response.ok) {
    const bodyText = (await response.text()).trim();
    throw describeFailure(response, bodyText, reasonFrom(bodyText));
  }
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

    if (response.ok) return { response, verifyMs: elapsed(startedAt) };

    // Read once. A Response body cannot be consumed twice, and both the retry decision
    // and the error message need it.
    const bodyText = (await response.text()).trim();
    const reason = reasonFrom(bodyText);

    // The ONE retryable case: the payment has landed but the gateway has not yet seen its
    // receipt on chain. The gateway says so with 503 + `payment-pending` and a Retry-After.
    //
    // Matching on the reason and not on 503 alone matters: `dispatch` proxies the origin's
    // own response, so a genuinely broken origin also arrives as a 503. Retrying that would
    // hammer a service the agent has already paid for, and the resource is not coming.
    const isPending = response.status === 503 && reason === 'payment-pending';
    if (!isPending) throw describeFailure(response, bodyText, reason);

    const ladderDelay = retryDelays[attempt];
    if (ladderDelay === undefined) {
      throw new Error(
        'Payment is confirmed, but the gateway has not observed its receipt within the retry ' +
          'window. The payment is recorded locally — running the same call again resumes it ' +
          'rather than paying twice.',
      );
    }

    // The gateway's own estimate wins when it offers one; the ladder is the fallback.
    const delay = retryAfterMs(response) ?? ladderDelay;
    options.onRetry?.(delay, attempt + 1);
    await sleep(delay);
  }
}
