import { useEffect, useState } from 'react';

/**
 * True below `breakpoint`. Uses documentElement.clientWidth rather than
 * window.innerWidth — some mobile viewports report the two inconsistently.
 */
export function useNarrow(breakpoint = 720): boolean {
  const [narrow, setNarrow] = useState(() => document.documentElement.clientWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(document.documentElement.clientWidth < breakpoint);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return narrow;
}
