import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Route handlers land in #6 (resolve /s/:id) and #7 (nullifier verification).
const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
