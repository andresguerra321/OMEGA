import { useCallback, useEffect, useState } from 'react';
import { fetchProfileConfig, updateTenantProfile } from './api.js';

export const DEFAULT_PROFILE_CONFIG = Object.freeze({
  profile: 'GENERAL',
  version: '1.1.0',
  visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
  ragCorpusScope: 'general_cti',
  copilotTone: 'balanced_defensive',
  copilotInstructions: '',
  defaultView: 'inicio',
});

/**
 * Filtra los elementos de navegación según `visibleModules` del perfil activo.
 * Nunca oculta `cuenta` ni impide mostrar alertas críticas de seguridad.
 */
export function resolveVisibleNavItems(navItems, profileConfig) {
  if (!Array.isArray(navItems)) return [];
  const allowed = Array.isArray(profileConfig?.visibleModules) && profileConfig.visibleModules.length > 0
    ? new Set(profileConfig.visibleModules)
    : new Set(DEFAULT_PROFILE_CONFIG.visibleModules);
  allowed.add('cuenta');
  return navItems.filter((item) => allowed.has(item.id));
}

export function useTenantProfileConfig(authSession) {
  const [profileConfig, setProfileConfig] = useState(DEFAULT_PROFILE_CONFIG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAuthenticated = Boolean(authSession && (authSession.accessToken || authSession.cookieBacked));

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setProfileConfig(DEFAULT_PROFILE_CONFIG);
      setError('');
      return DEFAULT_PROFILE_CONFIG;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchProfileConfig();
      if (data && typeof data === 'object' && Array.isArray(data.visibleModules)) {
        setProfileConfig(data);
        return data;
      }
      setProfileConfig(DEFAULT_PROFILE_CONFIG);
      return DEFAULT_PROFILE_CONFIG;
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la configuración del perfil del espacio.');
      return DEFAULT_PROFILE_CONFIG;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh, authSession?.tenantId, authSession?.userId]);

  const switchProfile = useCallback(async (nextProfile, confirmed = false) => {
    const updated = await updateTenantProfile(nextProfile, confirmed);
    if (updated && typeof updated === 'object') {
      setProfileConfig(updated);
    }
    return updated;
  }, []);

  return {
    profileConfig,
    profile: profileConfig?.profile || 'GENERAL',
    visibleModules: profileConfig?.visibleModules || DEFAULT_PROFILE_CONFIG.visibleModules,
    defaultView: profileConfig?.defaultView || 'inicio',
    loading,
    error,
    refresh,
    switchProfile,
  };
}
