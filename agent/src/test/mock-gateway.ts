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
    if (payment === options.receiptSecret) remainingLaggedClaims--;

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
