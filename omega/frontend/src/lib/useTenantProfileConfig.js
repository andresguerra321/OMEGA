import { useCallback, useEffect, useState } from 'react';
import { fetchProfileConfig, updateTenantProfile } from './api.js';

export const DEFAULT_PROFILE_CONFIG = Object.freeze({
  profile: 'GENERAL',
  version: '1.1.0',
  visibleModules: ['inicio', 'equipo', 'exposicion', 'amenazas', 'preguntar', 'cuenta'],
  moduleLabels: {},
  ragCorpusScope: 'general_cti',
  copilotTone: 'balanced_defensive',
  copilotInstructions: '',
  defaultView: 'inicio',
});

/**
 * Filtra los elementos de navegación según `visibleModules` del perfil activo
 * y aplica las etiquetas declaradas en `moduleLabels` sin condicionales por perfil.
 * Nunca oculta `cuenta` ni impide mostrar alertas críticas de seguridad.
 */
export function resolveVisibleNavItems(navItems, profileConfig) {
  if (!Array.isArray(navItems)) return [];
  const allowed = Array.isArray(profileConfig?.visibleModules) && profileConfig.visibleModules.length > 0
    ? new Set(profileConfig.visibleModules)
    : new Set(DEFAULT_PROFILE_CONFIG.visibleModules);
  allowed.add('cuenta');
  const labels = profileConfig?.moduleLabels && typeof profileConfig.moduleLabels === 'object'
    ? profileConfig.moduleLabels
    : null;
  return navItems
    .filter((item) => allowed.has(item.id))
    .map((item) => {
      const customLabel = labels?.[item.id];
      if (!customLabel || typeof customLabel !== 'string') return item;
      return {
        ...item,
        label: customLabel,
        ariaLabel: customLabel,
      };
    });
}

const NICHE_LABELS = Object.freeze({
  GENERAL: 'General',
  DEVELOPER: 'Desarrollador',
  LEGAL: 'Legal',
});

/**
 * Formatea la etiqueta visible de rol y nicho para evitar ambigüedad entre
 * administrador de organización y el perfil/nicho del espacio de trabajo.
 */
export function resolveRoleNicheLabel(role, profile) {
  const normalizedProfile = String(profile || 'GENERAL').trim().toUpperCase();
  const niche = NICHE_LABELS[normalizedProfile] || NICHE_LABELS.GENERAL;
  if (role === 'ADMIN') return `Admin · ${niche}`;
  if (role === 'CLIENT') return `Cliente · ${niche}`;
  return niche;
}

export function useTenantProfileConfig(authSession) {
  const sessionProfile = ['GENERAL', 'DEVELOPER', 'LEGAL'].includes(String(authSession?.profile || '').toUpperCase())
    ? String(authSession.profile).toUpperCase()
    : 'GENERAL';
  const [profileConfig, setProfileConfig] = useState(() => ({
    ...DEFAULT_PROFILE_CONFIG,
    profile: sessionProfile,
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAuthenticated = Boolean(authSession && (authSession.accessToken || authSession.cookieBacked));

  const refresh = useCallback(async () => {
    const fallbackConfig = { ...DEFAULT_PROFILE_CONFIG, profile: sessionProfile };
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
        const normalized =
          data.profile === 'DEVELOPER' && !data.visibleModules.includes('equipo')
            ? {
                ...data,
                visibleModules: [
                  'repo_scanner',
                  'inicio',
                  'equipo',
                  ...data.visibleModules.filter((m) => m !== 'repo_scanner' && m !== 'inicio'),
                ],
                moduleLabels: {
                  equipo: 'Mi estación',
                  ...(data.moduleLabels || {}),
                },
              }
            : data;
        setProfileConfig(normalized);
        return normalized;
      }
      setProfileConfig(fallbackConfig);
      return fallbackConfig;
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la configuración del perfil del espacio.');
      setProfileConfig(fallbackConfig);
      return fallbackConfig;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, sessionProfile]);

  useEffect(() => {
    void refresh();
  }, [refresh, authSession?.tenantId, authSession?.userId, authSession?.profile]);

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
