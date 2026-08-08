function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy web/.env.example to web/.env, fill it in, and restart the dev server.`);
  }
  return value;
}

export const VAULT_ADDRESS: string = requireEnv('VITE_M402_VAULT_ADDRESS');
export const INDEXER_URL: string = requireEnv('VITE_M402_INDEXER_URL');
export const INDEXER_WS_URL: string = requireEnv('VITE_M402_INDEXER_WS_URL');

/** The gateway this marketplace talks to — GET/POST /services, GET /s/:id. */
export const GATEWAY_URL: string = requireEnv('VITE_M402_GATEWAY_URL').replace(/\/$/, '');

/** Not required — the proof server URI is normally derived from the connected wallet's
 * substrateNodeUri (chain/providers.ts). Only set VITE_M402_PROOF_SERVER if yours runs
 * somewhere else. */
export const PROOF_SERVER_OVERRIDE: string | undefined = import.meta.env['VITE_M402_PROOF_SERVER'] || undefined;
