import { useEffect, useState } from 'react';
import {
  Building2,
  FlaskConical,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  getAuthConfig,
  loginOrCreateSandboxDemo,
  loginWithPassword,
  registerTenant,
} from '../lib/api';

export function AuthModal({ isOpen, onClose, onAuthenticated, reasonMessage = '' }) {
  const [tab, setTab] = useState('login');
  const [authConfig, setAuthConfig] = useState({
    tenantSelfRegistrationEnabled: true,
    bootstrapSecretRequired: false,
  });
  const [loading, setLoading] = useState(false);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [loginForm, setLoginForm] = useState({
    tenantSlug: '',
    email: '',
    password: '',
  });

  const [regForm, setRegForm] = useState({
    tenantSlug: '',
    tenantName: '',
    adminEmail: '',
    adminPassword: '',
    adminFullName: '',
    bootstrapSecret: '',
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (!cancelled) {
          setErrorMsg('');
          if (cfg) setAuthConfig(cfg);
        }
      })
      .catch(() => {
        // fallback defaults
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const session = await loginWithPassword(loginForm);
      onAuthenticated?.(session);
      onClose?.();
    } catch (err) {
      setErrorMsg(err?.message || 'Credenciales o tenant inválidos.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const session = await registerTenant(regForm);
      onAuthenticated?.(session);
      onClose?.();
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo registrar la organización.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSandboxClick() {
    setSandboxLoading(true);
    setErrorMsg('');
    try {
      const session = await loginOrCreateSandboxDemo();
      onAuthenticated?.(session);
      onClose?.();
    } catch (err) {
      setErrorMsg(err?.message || 'El servidor no permite registro automático en este modo.');
    } finally {
      setSandboxLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/74 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Autenticación multi-tenant OMEGA"
    >
      <div className="omega-glass-panel w-full max-w-[460px] rounded-[18px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-[9px] bg-[#2F6FED]/15 border border-[#2F6FED]/45 flex items-center justify-center text-[#2F6FED]">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#F2F2F4] tracking-[-0.015em]">
                Sesión Multi-Tenant OMEGA
              </h2>
              <p className="text-[11.5px] text-[#9A9AA2]">
                Aislamiento criptográfico JWT HS256 y Zero-Retention
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="h-7 w-7 rounded-[8px] flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {reasonMessage && (
            <div className="rounded-[10px] border border-[#2F6FED]/40 bg-[#2F6FED]/12 px-3.5 py-2.5 text-[12.5px] text-[#F2F2F4]">
              {reasonMessage}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-[10px] border border-[#FF453A]/35 bg-[#FF453A]/12 px-3.5 py-2.5 text-[12.5px] text-[#FFDAD6]">
              {errorMsg}
            </div>
          )}

          {authConfig.tenantSelfRegistrationEnabled && (
            <div className="rounded-[12px] border border-[#2F6FED]/35 bg-[rgba(28,36,56,0.5)] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-[#F2F2F4] flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" />
                  Sandbox Local (1 clic)
                </div>
                <p className="text-[11.5px] text-[#9A9AA2]">
                  Crea o reanuda tu organización de prueba al instante.
                </p>
              </div>
              <button
                type="button"
                disabled={sandboxLoading || loading}
                onClick={handleSandboxClick}
                className="shrink-0 h-8 px-3 rounded-[9px] bg-[#2F6FED] hover:brightness-110 hover:shadow-[0_0_24px_rgba(47,111,237,0.28)] disabled:opacity-50 text-[12px] font-medium text-white transition-all cursor-pointer"
              >
                {sandboxLoading ? 'Creando...' : 'Entrar ahora'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-white/[0.04] border border-white/[0.08]">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setErrorMsg('');
              }}
              className={`h-8 rounded-[7px] text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'login'
                  ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] border border-[#2F6FED]/40'
                  : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setErrorMsg('');
              }}
              className={`h-8 rounded-[7px] text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'register'
                  ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] border border-[#2F6FED]/40'
                  : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Nuevo Tenant
            </button>
          </div>

          {tab === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Slug de organización (Tenant)
                </label>
                <div className="relative flex items-center">
                  <Building2 className="h-3.5 w-3.5 text-[#9A9AA2] absolute left-3" />
                  <input
                    type="text"
                    required
                    value={loginForm.tenantSlug}
                    onChange={(e) => setLoginForm((p) => ({ ...p, tenantSlug: e.target.value }))}
                    placeholder="ej. redaccion-sur"
                    className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="analista@organizacion.org"
                  className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                />
              </div>

              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Contraseña
                </label>
                <div className="relative flex items-center">
                  <Lock className="h-3.5 w-3.5 text-[#9A9AA2] absolute left-3" />
                  <input
                    type="password"
                    required
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="••••••••••••"
                    className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-9.5 mt-1 rounded-[10px] bg-[#2F6FED] hover:brightness-110 hover:shadow-[0_0_24px_rgba(47,111,237,0.28)] disabled:opacity-50 text-[13px] font-medium text-white transition-all cursor-pointer"
              >
                {loading ? 'Autenticando...' : 'Conectar al Gateway OMEGA'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                    Slug único
                  </label>
                  <input
                    type="text"
                    required
                    pattern="^[a-z0-9-]{3,80}$"
                    value={regForm.tenantSlug}
                    onChange={(e) => setRegForm((p) => ({ ...p, tenantSlug: e.target.value }))}
                    placeholder="mi-equipo"
                    className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                    Nombre organización
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={regForm.tenantName}
                    onChange={(e) => setRegForm((p) => ({ ...p, tenantName: e.target.value }))}
                    placeholder="Redacción Sur"
                    className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Nombre completo administrador
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={regForm.adminFullName}
                  onChange={(e) => setRegForm((p) => ({ ...p, adminFullName: e.target.value }))}
                  placeholder="Dra. Sofía Martínez"
                  className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                />
              </div>

              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Correo administrador
                </label>
                <input
                  type="email"
                  required
                  value={regForm.adminEmail}
                  onChange={(e) => setRegForm((p) => ({ ...p, adminEmail: e.target.value }))}
                  placeholder="admin@mi-equipo.org"
                  className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                />
              </div>

              <div>
                <label className="block text-[11.5px] text-[#9A9AA2] mb-1">
                  Contraseña (mín. 12 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={12}
                  value={regForm.adminPassword}
                  onChange={(e) => setRegForm((p) => ({ ...p, adminPassword: e.target.value }))}
                  placeholder="Al menos 12 caracteres"
                  className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-white/[0.08] text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]"
                />
              </div>

              {authConfig.bootstrapSecretRequired && (
                <div>
                  <label className="block text-[11.5px] text-[#9A9AA2] mb-1 flex items-center gap-1">
                    <KeyRound className="h-3 w-3 text-[#FF9F0A]" />
                    Bootstrap Secret de despliegue
                  </label>
                  <input
                    type="password"
                    required
                    value={regForm.bootstrapSecret}
                    onChange={(e) => setRegForm((p) => ({ ...p, bootstrapSecret: e.target.value }))}
                    placeholder="X-Omega-Bootstrap-Secret"
                    className="w-full h-9 px-3 rounded-[9px] bg-[#0A0A0C]/70 border border-[#FF9F0A]/35 text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2]/70 focus:outline-none focus:border-[#FF9F0A]/60"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-9.5 mt-1 rounded-[10px] bg-[#2F6FED] hover:brightness-110 hover:shadow-[0_0_24px_rgba(47,111,237,0.28)] disabled:opacity-50 text-[13px] font-medium text-white transition-all cursor-pointer"
              >
                {loading ? 'Provisionando Tenant...' : 'Crear Tenant y Entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
