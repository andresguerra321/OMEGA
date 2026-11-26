import { apiFetch, getAuthSession } from './api.js';
import { isDesktopApp, openGoogleAuthorization } from './desktopBridge.js';

const callbackPath = '/google/callback';
const intentKey = 'omega.google.intent';

export const googleAuthConfig = () => apiFetch('/auth/google/config', { skipAuth: true });
export const googleConnection = () => apiFetch('/auth/google/connection');

export async function startGoogleAuth(action, fields = {}, terms, signal) {
  const desktop = isDesktopApp();
  const token = desktop && action === 'LINK' ? getAuthSession()?.accessToken : null;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const { url, proof } = await apiFetch(desktop ? '/auth/google/desktop/start' : '/auth/google/start', {
    method: 'POST', skipAuth: true, body: { action, ...fields },
    headers: terms ? { ...authHeaders, 'X-Omega-Commercial-Version': terms } : authHeaders,
  });
  const provider = new URL(url);
  if (provider.origin !== 'https://accounts.google.com') throw new Error('La dirección de Google no es válida.');
  if (desktop) {
    const state = provider.searchParams.get('state');
    if (!/^D_[A-Za-z0-9_-]{41}$/.test(state || '') || !/^[A-Za-z0-9_-]{43}$/.test(proof || '')) {
      throw new Error('OMEGA no pudo preparar el acceso desde Desktop.');
    }
    signal?.throwIfAborted();
    await openGoogleAuthorization(provider.href);
    return waitForDesktopGoogle(state, proof, authHeaders, signal);
  }
  window.sessionStorage.setItem(intentKey, action);
  const link = document.createElement('a');
  link.href = provider.href;
  link.rel = 'noreferrer';
  link.click();
}

async function waitForDesktopGoogle(state, proof, headers, signal) {
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const result = await apiFetch('/auth/google/desktop/finish', {
      method: 'POST', skipAuth: true, body: { state, proof }, headers,
    });
    signal?.throwIfAborted();
    if (result) return result;
    await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, 2500);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }
  throw new Error('La autorización de Google venció. Vuelve a intentarlo.');
}

export function relayDesktopGoogleReturn() {
  if (window.location.pathname !== callbackPath) return null;
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (!/^D_[A-Za-z0-9_-]{41}$/.test(state || '')) return null;
  window.history.replaceState(window.history.state, '', '/');
  const code = params.has('error') ? null : params.get('code');
  return apiFetch('/auth/google/desktop/relay', { method: 'POST', skipAuth: true, body: { state, code } });
}

export function pendingGoogleAction() {
  return window.location.pathname === callbackPath ? window.sessionStorage.getItem(intentKey) : null;
}

export async function finishGoogleAuth() {
  const params = new URLSearchParams(window.location.search);
  window.history.replaceState(window.history.state, '', '/');
  window.sessionStorage.removeItem(intentKey);
  const state = params.get('state');
  const code = params.get('code');
  if (params.has('error') || !state || !code) throw new Error('Google no completó la autorización. Inténtalo de nuevo.');
  return apiFetch('/auth/google/finish', { method: 'POST', skipAuth: true, body: { state, code } });
}
