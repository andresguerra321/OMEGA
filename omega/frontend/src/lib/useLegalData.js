import { useCallback, useEffect, useMemo, useState } from 'react';

// A changed request never exposes the previous case's data while the new request is pending.
export function useLegalData(load) {
  const [revision, setRevision] = useState(0);
  const key = useMemo(() => ({ load, revision }), [load, revision]);
  const [state, setState] = useState({ key: null, data: null, error: '' });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(load).then(data => {
      if (data == null) throw new Error('Respuesta de datos vacía');
      if (active) setState({ key, data, error: '' });
    }).catch(() => {
      if (active) setState({ key, data: null, error: 'No pudimos cargar estos datos. Intenta de nuevo.' });
    });
    return () => { active = false; };
  }, [key, load]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : '', loading: state.key !== key, reload };
}
