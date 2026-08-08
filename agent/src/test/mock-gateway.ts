import { createServer, type Server } from 'node:http';
import { PAYMENT_HEADER, type PaymentRequired } from '@m402/shared';

export type MockGateway = {
  url: string;
  close: () => Promise<void>;
  paymentHeaders: string[];
};

export async function startMockGateway(options: {
  requirements: PaymentRequired;
  receiptSecret: string;
  laggedClaims?: number;
}): Promise<MockGateway> {
  const paymentHeaders: string[] = [];
  let remainingLaggedClaims = options.laggedClaims ?? 0;

  const server: Server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/s/test' }).end();
      return;
    }
    if (request.url === '/missing') {
      response.writeHead(404).end('unknown service');
      return;
    }
    if (request.url !== '/s/test') {
      response.writeHead(404).end();
      return;
    }

    const payment = request.headers[PAYMENT_HEADER.toLowerCase()];
    if (typeof payment === 'string') paymentHeaders.push(payment);
    if (payment === options.receiptSecret && remainingLaggedClaims <= 0) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ value: 42 }));
      return;
    }

    // A valid secret whose receipt the gateway has not observed yet. The real gateway
    // answers 503 + `payment-pending` + Retry-After here, NOT 402 — this used to return
    // 402, which is the one status the CLI retried, so the CLI looked correct against
    // this mock while failing against the real thing. See #23.
    if (payment === options.receiptSecret) {
      remainingLaggedClaims--;
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '5' });
      response.end(JSON.stringify({ reason: 'payment-pending' }));
      return;
    }

    // No secret, or one this gateway does not recognise: the opening 402.
    response.writeHead(402, { 'content-type': 'application/json' });
    response.end(JSON.stringify(options.requirements));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock gateway did not bind a TCP port.');

  return {
    url: `http://127.0.0.1:${address.port}`,
    paymentHeaders,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
