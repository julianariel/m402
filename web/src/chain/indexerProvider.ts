import { indexerPublicDataProvider as indexerPublicDataProviderRaw } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';

/**
 * indexerPublicDataProvider's `webSocketImpl` parameter defaults to `isomorphic-ws`'s
 * `WebSocket` named export — but isomorphic-ws/browser.js only has a default export (bare
 * `export default ws`), so that default silently resolves to `undefined` in a Vite/browser
 * build (confirmed: `import * as ws from 'isomorphic-ws'; ... webSocketImpl = ws.WebSocket`
 * in the package's own dist). Any live subscription — contractStateObservable,
 * watchForTxData — would construct `new undefined(...)` and throw. gateway/src/verify.ts
 * sidesteps the same isomorphic-ws gap in Node by assigning globalThis.WebSocket from `ws`;
 * here we just pass the browser's real global WebSocket explicitly instead of relying on the
 * broken default.
 */
export function indexerPublicDataProvider(queryURL: string, subscriptionURL: string): PublicDataProvider {
  return indexerPublicDataProviderRaw(queryURL, subscriptionURL, globalThis.WebSocket as never);
}
