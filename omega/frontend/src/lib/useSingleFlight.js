import { useCallback, useRef } from 'react';

/**
 * Bloqueo síncrono anti doble-clic / doble-Enter.
 * A diferencia de `disabled={loading}` (que depende de un re-render), el ref
 * se marca en el mismo tick y descarta cualquier invocación concurrente.
 */
export function useSingleFlight() {
  const busyRef = useRef(false);
  return useCallback(async (fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    try {
      return await fn();
    } finally {
      busyRef.current = false;
    }
  }, []);
}
