import { useCallback, useEffect, useState } from 'react';
import { listServices, type GatewayServiceRow } from '../lib/gateway';

export type ServicesState =
  | { phase: 'loading' }
  | { phase: 'loaded'; services: GatewayServiceRow[] }
  | { phase: 'error'; message: string };

/** GET /services from the gateway — see web/src/lib/gateway.ts. Every registered service, real. */
export function useServices(): { state: ServicesState; reload: () => void } {
  const [state, setState] = useState<ServicesState>({ phase: 'loading' });

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    listServices()
      .then((services) => setState({ phase: 'loaded', services }))
      .catch((err) =>
        setState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to load services.' }),
      );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { state, reload };
}
