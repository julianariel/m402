import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { PAYMENT_HEADER, type Service, type PaymentRequired } from '@m402/shared';
import type { Registry } from './registry.js';
import type { CheckOwnership } from './ownership.js';

const SUPPORTED_RELAY_CHAINS = new Set(['eip155:8453', 'eip155:84532']);

export type VerifyResult = 'confirmed' | 'timeout' | 'replayed' | 'wrong-service';
export type Verify = (receiptSecret: string, serviceId: string, timeoutMs: number) => Promise<VerifyResult>;
export type Dispatch = (service: Service, req: Request) => Promise<Response>;
export type ProbeOrigin = (target: string) => Promise<boolean>;

export type RouteDeps = {
  registry: Registry;
  verify: Verify;
  dispatch: Dispatch;
  probeOrigin: ProbeOrigin;
  checkOwnership: CheckOwnership;
  relayTargetAllowlist: ReadonlySet<string>;
  vaultAddress: string;
  verifyTimeoutMs: number;
};

function paymentRequiredBody(service: Service, vaultAddress: string): PaymentRequired {
  return { serviceId: service.id, price: service.price.toString(), vaultAddress };
}

export function createRoutes(deps: RouteDeps): Hono {
  const app = new Hono();

  // Any browser-based agent or merchant UI on a different origin needs to reach this API
  // directly (POST /services from the web app, GET/X-Payment /s/:id from arbitrary agents) —
  // there's no session/cookie auth here to protect, so a permissive origin is the right default
  // for a public payment gateway. PAYMENT_HEADER is custom, so it must be explicitly allowed.
  app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', PAYMENT_HEADER], allowMethods: ['GET', 'POST', 'OPTIONS'] }));

  const handleService = async (c: Context) => {
    const service = deps.registry.get(c.req.param('id') ?? '');
    if (!service) return c.body(null, 404);

    const secret = c.req.header(PAYMENT_HEADER);

    if (!secret) {
      if (service.type === 'origin') {
        const healthy = await deps.probeOrigin(service.target);
        if (!healthy) return c.json({ reason: 'origin-down' }, 503);
      }
      return c.json(paymentRequiredBody(service, deps.vaultAddress), 402);
    }

    const result = await deps.verify(secret, service.id, deps.verifyTimeoutMs);

    if (result === 'timeout') {
      c.header('Retry-After', '5');
      return c.json({ reason: 'payment-pending' }, 503);
    }
    if (result === 'replayed') {
      return c.json({ reason: 'receipt-already-used' }, 402);
    }
    if (result === 'wrong-service') {
      // Carries the payment requirements AND a reason. Without the reason this is
      // byte-identical to the initial 402, so a caller cannot tell "you have not paid"
      // from "you paid, but for a different service" — and the second is terminal while
      // the first is the normal opening move. Adding a field is backward compatible.
      return c.json({ ...paymentRequiredBody(service, deps.vaultAddress), reason: 'wrong-service' }, 402);
    }

    return deps.dispatch(service, c.req.raw);
  };

  app.all('/s/:id', handleService);
  app.all('/s/:id/*', handleService);

  app.get('/services', (c) => {
    const body = deps.registry.list().map((s) => ({ ...s, price: s.price.toString() }));
    return c.json(body);
  });

  app.post('/services', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validType = body && (body.type === 'origin' || body.type === 'relay');
    const valid =
      body &&
      typeof body.id === 'string' &&
      typeof body.price === 'string' &&
      typeof body.owner === 'string' &&
      validType &&
      typeof body.target === 'string' &&
      (body.type !== 'relay' || typeof body.chain === 'string');

    if (!valid) return c.body(null, 400);
    if (body.type === 'relay' && !SUPPORTED_RELAY_CHAINS.has(body.chain)) {
      return c.json({ reason: 'unsupported-relay-chain' }, 400);
    }
    if (body.type === 'relay' && !deps.relayTargetAllowlist.has(body.target)) {
      return c.json({ reason: 'relay-target-not-allowed' }, 403);
    }

    // Catches a front-run: someone POSTing a serviceId + owner that doesn't
    // match what's actually on-chain, either because the real registerService
    // tx hasn't landed yet (unconfirmed) or because they're lying (mismatch).
    const ownership = await deps.checkOwnership(body.id, body.owner);
    if (ownership === 'unconfirmed') {
      return c.json({ reason: 'registration-not-yet-confirmed' }, 503);
    }
    if (ownership === 'mismatch') {
      return c.json({ reason: 'owner-mismatch' }, 403);
    }

    const service: Service = {
      id: body.id,
      price: BigInt(body.price),
      owner: body.owner,
      type: body.type,
      target: body.target,
      chain: body.chain,
    };

    const result = deps.registry.insert(service);
    return c.body(null, result === 'conflict' ? 409 : 201);
  });

  return app;
}
