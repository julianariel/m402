/**
 * A stand-in merchant API for the `origin` fulfilment path.
 *
 * The registered origin service targets http://127.0.0.1:9099, and the gateway
 * health-checks that target with a HEAD before it will issue a 402 (health.ts) —
 * so with nothing listening, GET /s/<id> answers 503 origin-down and the agent
 * never gets a price. This is the smallest thing that satisfies both.
 *
 * No dependencies, so it needs no build step:
 *
 *   node --experimental-strip-types gateway/scripts/origin-mock.ts
 *   PORT=9099 npx tsx gateway/scripts/origin-mock.ts
 */
import { createServer } from 'node:http';

const PORT = Number(process.env['PORT'] ?? 9099);
// Loopback only. This is a demo stand-in with no auth; it should not be
// reachable from the network, and the gateway runs on the same host.
const HOST = process.env['HOST'] ?? '127.0.0.1';

const server = createServer((req, res) => {
  // HEAD must answer < 500 or the gateway reports the origin as down. Any path
  // counts: the probe asks "is something listening", not "does this route exist".
  if (req.method === 'HEAD') {
    res.writeHead(200).end();
    return;
  }

  const body = JSON.stringify({
    data: { message: 'hello from the origin API' },
    meta: {
      service: 'origin-mock',
      method: req.method,
      path: req.url,
      generated_at: new Date().toISOString(),
    },
  });

  // Echoing method and path makes it visible that dispatchOrigin forwards the
  // suffix after /s/:id and the query string unchanged.
  res.writeHead(200, { 'content-type': 'application/json' }).end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`origin mock listening on http://${HOST}:${PORT}`);
});
