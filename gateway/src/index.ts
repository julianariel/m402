import { serve } from '@hono/node-server';
import { createRoutes } from './routes.js';
import { createRegistry } from './registry.js';
import { createConsumedReceipts } from './consumed.js';
import { deriveReceipt } from './receipt.js';
import { createVerifier, createPublicDataSubscribe } from './verify.js';
import { createOwnershipChecker } from './ownership.js';
import { dispatchOrigin, createDispatch, createRelayDispatcher } from './dispatch.js';
import { createHealthProbe } from './health.js';
import { config } from './config.js';

const registry = createRegistry(config.dbPath);
const consumedReceipts = createConsumedReceipts(config.dbPath);
const verify = createVerifier(
  createPublicDataSubscribe(config.indexerUrl, config.indexerWsUrl),
  config.vaultAddress,
  deriveReceipt,
  consumedReceipts,
  () => registry.list().map((s) => s.id)
);
const checkOwnership = createOwnershipChecker(config.indexerUrl, config.indexerWsUrl, config.vaultAddress);
const dispatch = createDispatch(dispatchOrigin, createRelayDispatcher(config.relayerKeyFile));

const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify,
  probeOrigin: createHealthProbe(),
  checkOwnership,
  dispatch,
});

app.get('/healthz', (c) => c.text('ok'));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`gateway listening on http://localhost:${info.port} (vault ${config.vaultAddress})`);
});
