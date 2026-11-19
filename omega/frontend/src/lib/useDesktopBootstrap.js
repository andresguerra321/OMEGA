import { useCallback, useEffect, useRef, useState } from 'react';
import { getBootstrapStatus, isDesktopApp, retrySelfHostedBootstrap } from './desktopBridge';

const PENDING_STATES = new Set(['idle', 'checking', 'starting']);

/**
 * Estado del arranque de contenedores de la app de escritorio (Tauri).
 * En web devuelve `null`: ahí el gateway lo sirve el propio despliegue.
 * Al pasar a `ready` emite `omega:backend-ready` para que la UI revalide el gateway
 * sin esperar al siguiente ciclo de telemetría.
 */
export function useDesktopBootstrap({ intervalMs = 2000 } = {}) {
  const [status, setStatus] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const announced = useRef(false);

  const apply = useCallback((next) => {
    if (!next?.state) {
      next = { state: 'error', message: 'No se pudo consultar el inicio de OMEGA. Intenta de nuevo.' };
    }
    setStatus(next);
    if (next.state === 'ready' && !announced.current) {
      announced.current = true;
      window.dispatchEvent(new Event('omega:backend-ready'));
    } else if (next.state !== 'ready') {
      announced.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      let next = null;
      try {
        next = await getBootstrapStatus();
      } catch {
        next = { state: 'error', message: 'No se pudo consultar el inicio de OMEGA. Intenta de nuevo.' };
      }
      if (cancelled) return;
      apply(next);
      // Seguimos consultando: un error puede resolverse al abrir Docker Desktop.
      timer = setTimeout(tick, next?.state === 'ready' ? 15000 : intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apply, intervalMs]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      apply(await retrySelfHostedBootstrap());
    } catch {
      apply({ state: 'error', message: 'No se pudo reiniciar OMEGA. Abre Docker Desktop e intenta de nuevo.' });
    } finally {
      setRetrying(false);
    }
  }, [apply]);

  return {
    status,
    retry,
    retrying,
    blocking: isDesktopApp() && status?.state !== 'ready',
    pending: isDesktopApp() && (!status || PENDING_STATES.has(status.state)),
    failed: status?.state === 'error',
  };
}
