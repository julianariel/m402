import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'explorer' }
  | { name: 'service'; slug: string }
  | { name: 'publish' }
  | { name: 'withdraw' };

function parseHash(hash: string): Route {
  const [seg, param] = hash.replace(/^#\/?/, '').split('/');
  switch (seg) {
    case 'explorer': return { name: 'explorer' };
    case 'service': return param ? { name: 'service', slug: param } : { name: 'explorer' };
    case 'publish': return { name: 'publish' };
    case 'withdraw': return { name: 'withdraw' };
    default: return { name: 'home' };
  }
}

/** Minimal hash router — `#/explorer`, `#/service/:slug`, `#/publish`, `#/withdraw`, anything else is home. */
export function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path.startsWith('/') ? path : '/' + path;
  }, []);

  return [route, navigate];
}
