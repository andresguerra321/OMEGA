import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Sparkles,
  Upload,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  getAuthConfig,
  loginWithPassword,
  registerAccount,
} from '../lib/api';
import {
  validateAuthLoginForm,
  validateAuthRegisterForm,
} from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { OmegaLogo } from './OmegaLogo';

function shortHash(value) {
  const s = String(value || '').trim();
  if (!s) return '—';
  return s.length > 14 ? `${s.slice(0, 12)}…` : s;
}

/**
 * Formulario unificado de Inicio de Sesión y Registro estándar (Correo + Contraseña).
 * Reutilizado entre la pantalla principal de acceso y el modal de cambio de cuenta.
 */
export function AuthAccessForm({
  defaultTab = 'login',
  activeTab,
  onTabChange,
  onAuthenticated,
  reasonMessage = '',
  compact = false,
  minimalChrome = false,
}) {
  const uid = useId().replace(/:/g, '');
  const [internalTab, setInternalTab] = useState(
    defaultTab === 'register' ? 'register' : 'login',
  );
  const tab = activeTab ?? internalTab;

  const [authConfig, setAuthConfig] = useState({
    tenantSelfRegistrationEnabled: true,
    bootstrapSecretRequired: false,
  });
  const [loading, setLoading] = useState(false);
  const [shakeTick, setShakeTick] = useState(0);
  const guard = useSingleFlight();
  const [errorState, setErrorState] = useState({ tab, message: '' });
  const [fieldErrorState, setFieldErrorState] = useState({ tab, errors: {} });
  const [showOrgSlug, setShowOrgSlug] = useState(false);
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const errorMsg = errorState.tab === tab ? errorState.message : '';
  const fieldErrors = fieldErrorState.tab === tab ? fieldErrorState.errors : {};

  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    tenantSlug: '',
  });

  const [regForm, setRegForm] = useState({
    fullName: '',
    email: '',
    organizationName: '',
    password: '',
    bootstrapSecret: '',
  });

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (!cancelled && cfg) {
          setAuthConfig(cfg);
        }
      })
      .catch(() => {
        // Fallback silencioso cuando el gateway aún inicia
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectTab(next) {
    setErrorState({ tab: next, message: '' });
    setFieldErrorState({ tab: next, errors: {} });
    if (onTabChange) {
      onTabChange(next);
    } else {
      setInternalTab(next);
    }
  }

  function clearFieldError(targetTab, field) {
    setFieldErrorState((prev) => {
      if (prev.tab !== targetTab || !prev.errors[field]) return prev;
      const nextErrors = { ...prev.errors };
      delete nextErrors[field];
      return { tab: targetTab, errors: nextErrors };
    });
    setErrorState((prev) => (prev.tab === targetTab && prev.message ? { tab: targetTab, message: '' } : prev));
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    const validation = validateAuthLoginForm(loginForm, { includeTenantSlug: showOrgSlug });
    if (!validation.valid) {
      setFieldErrorState({ tab: 'login', errors: validation.fieldErrors });
      setErrorState({ tab: 'login', message: validation.firstError });
      setShakeTick((n) => n + 1);
      return;
    }

    setLoading(true);
    setErrorState({ tab: 'login', message: '' });
    setFieldErrorState({ tab: 'login', errors: {} });
    try {
      const session = await loginWithPassword({
        email: validation.sanitized.email,
        password: validation.sanitized.password,
        tenantSlug: showOrgSlug ? validation.sanitized.tenantSlug : '',
      });
      onAuthenticated?.(session, { isNewAccount: false });
    } catch (err) {
      const serverFields = err?.problem?.fieldErrors;
      if (serverFields && typeof serverFields === 'object') {
        setFieldErrorState({ tab: 'login', errors: serverFields });
      }
      setErrorState({
        tab: 'login',
        message: err?.message || 'Correo o contraseña incorrectos.',
      });
      setShakeTick((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    const validation = validateAuthRegisterForm(regForm, {
      bootstrapSecretRequired: authConfig.bootstrapSecretRequired,
    });
    if (!validation.valid) {
      setFieldErrorState({ tab: 'register', errors: validation.fieldErrors });
      setErrorState({ tab: 'register', message: validation.firstError });
      setShakeTick((n) => n + 1);
      return;
    }

    setLoading(true);
    setErrorState({ tab: 'register', message: '' });
    setFieldErrorState({ tab: 'register', errors: {} });
    try {
      const session = await registerAccount(validation.sanitized);
      onAuthenticated?.(session, { isNewAccount: true });
    } catch (err) {
      const serverFields = err?.problem?.fieldErrors;
      if (serverFields && typeof serverFields === 'object') {
        setFieldErrorState({ tab: 'register', errors: serverFields });
      }
      setErrorState({
        tab: 'register',
        message: err?.message || 'No se pudo completar el registro de la cuenta.',
      });
      setShakeTick((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  const pwdLength = regForm.password.length;
  const pwdReady = pwdLength >= 12;

  const labelTone = minimalChrome ? 'text-[#D4D8E4]' : 'text-[#9A9AA2]';
  const inputSurface = minimalChrome
    ? 'bg-[#0A0A0C]/72 border-white/[0.14] placeholder:text-[#9FA6B8] focus:bg-[#0A0A0C]/86 focus:border-[#2F6FED] focus:shadow-[0_0_22px_rgba(47,111,237,0.28)]'
    : 'bg-[#0A0A0C]/75 border-white/[0.09] placeholder:text-[#9A9AA2]/65 focus:border-[#2F6FED] focus:shadow-[0_0_20px_rgba(47,111,237,0.22)]';
  const inputClass = (field) =>
    `${inputSurface} ${fieldErrors[field] ? '!border-[#FF453A]/75 focus:!border-[#FF453A]' : ''}`;

  return (
    <div className={compact ? 'space-y-3.5' : 'space-y-4'}>
      {reasonMessage && (
        <div className="motion-safe:animate-fade-up rounded-[10px] border border-[#2F6FED]/45 bg-[#2F6FED]/14 px-3.5 py-2.5 text-[12.5px] text-[#F2F2F4]">
          {reasonMessage}
        </div>
      )}

      {errorMsg && (
        <div
          key={`${tab}-${shakeTick}-${errorMsg}`}
          role="alert"
          className="motion-safe:animate-shake-subtle rounded-[10px] border border-[#FF453A]/40 bg-[#FF453A]/14 px-3.5 py-2.5 text-[12.5px] text-[#FFDAD6]"
        >
          {errorMsg}
        </div>
      )}

      {!minimalChrome && (
        <div
          role="tablist"
          aria-label="Modo de acceso"
          className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-white/[0.04] border border-white/[0.08]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => selectTab('login')}
            className={`h-8.5 rounded-[7px] text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-[0.98] cursor-pointer ${
              tab === 'login'
                ? 'bg-[rgba(28,36,56,0.68)] text-[#F2F2F4] border border-[#2F6FED]/45 shadow-[0_0_16px_rgba(47,111,237,0.16)]'
                : 'text-[#9A9AA2] hover:text-[#F2F2F4] border border-transparent'
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            Iniciar sesión
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => selectTab('register')}
            className={`h-8.5 rounded-[7px] text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-[0.98] cursor-pointer ${
              tab === 'register'
                ? 'bg-[rgba(28,36,56,0.68)] text-[#F2F2F4] border border-[#2F6FED]/45 shadow-[0_0_16px_rgba(47,111,237,0.16)]'
                : 'text-[#9A9AA2] hover:text-[#F2F2F4] border border-transparent'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Registrarse
          </button>
        </div>
      )}

      {tab === 'login' ? (
        <form
          key="form-login"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void guard(() => handleLoginSubmit(e)); }}
          className={`motion-safe:animate-panel-switch ${minimalChrome ? 'space-y-3.5' : 'space-y-3'}`}
        >
          <div>
            <label
              htmlFor={`${uid}-login-email`}
              className={`block text-[11.5px] font-medium mb-1.5 ${labelTone}`}
            >
              Correo electrónico
            </label>
            <div className="group relative flex items-center">
              <Mail className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-login-email`}
                type="email"
                required
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                value={loginForm.email}
                onChange={(e) => {
                  setLoginForm((p) => ({ ...p, email: e.target.value }));
                  clearFieldError('login', 'email');
                }}
                placeholder="nombre@organizacion.org"
                className={`w-full h-10 pl-9.5 pr-3.5 rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('email')}`}
              />
            </div>
            {fieldErrors.email && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={`${uid}-login-password`}
              className={`block text-[11.5px] font-medium mb-1.5 ${labelTone}`}
            >
              Contraseña
            </label>
            <div className="group relative flex items-center">
              <Lock className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-login-password`}
                type={showLoginPwd ? 'text' : 'password'}
                required
                autoComplete="current-password"
                aria-invalid={Boolean(fieldErrors.password)}
                value={loginForm.password}
                onChange={(e) => {
                  setLoginForm((p) => ({ ...p, password: e.target.value }));
                  clearFieldError('login', 'password');
                }}
                placeholder="••••••••••••"
                className={`w-full h-10 pl-9.5 ${minimalChrome ? 'pr-16' : 'pr-9.5'} rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('password')}`}
              />
              <button
                type="button"
                aria-pressed={showLoginPwd}
                aria-label={showLoginPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowLoginPwd((v) => !v)}
                className="absolute right-3 text-[11.5px] font-medium text-[#B8C0D0] hover:text-white active:scale-95 transition-all duration-150 cursor-pointer"
              >
                {minimalChrome
                  ? showLoginPwd
                    ? 'Ocultar'
                    : 'Mostrar'
                  : showLoginPwd
                    ? <EyeOff className="h-3.5 w-3.5" />
                    : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowOrgSlug((v) => !v)}
              className={`text-[11.5px] transition-colors duration-150 cursor-pointer ${
                minimalChrome
                  ? 'text-[#C2C7D6] hover:text-white'
                  : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
              }`}
            >
              {showOrgSlug
                ? 'Ocultar identificador de organización'
                : '¿Tu correo pertenece a más de una organización?'}
            </button>

            {showOrgSlug && (
              <div className="motion-safe:animate-fade-up mt-2">
                <label
                  htmlFor={`${uid}-login-org`}
                  className={`block text-[11px] mb-1 ${labelTone}`}
                >
                  Identificador de organización (opcional)
                </label>
                <div className="group relative flex items-center">
                  <Building2 className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
                  <input
                    id={`${uid}-login-org`}
                    type="text"
                    aria-invalid={Boolean(fieldErrors.tenantSlug)}
                    value={loginForm.tenantSlug}
                    onChange={(e) => {
                      setLoginForm((p) => ({ ...p, tenantSlug: e.target.value }));
                      clearFieldError('login', 'tenantSlug');
                    }}
                    placeholder="ej. redaccion-sur"
                    className={`w-full h-9.5 pl-9.5 pr-3.5 rounded-[10px] border text-[12.5px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('tenantSlug')}`}
                  />
                </div>
                {fieldErrors.tenantSlug && (
                  <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                    {fieldErrors.tenantSlug}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group w-full h-10.5 mt-1 rounded-[10px] bg-[#2F6FED] border border-white/15 hover:-translate-y-[1px] hover:brightness-110 hover:shadow-[0_6px_26px_rgba(47,111,237,0.38)] active:translate-y-0 active:scale-[0.985] disabled:opacity-50 disabled:hover:translate-y-0 text-[13px] font-medium text-white inline-flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
          >
            {loading ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                />
                <span>Verificando acceso...</span>
              </>
            ) : (
              <>
                <span>Iniciar sesión</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>
      ) : !authConfig.tenantSelfRegistrationEnabled ? (
        <div
          key="form-register-disabled"
          className="motion-safe:animate-panel-switch rounded-[11px] border border-white/[0.12] bg-[#0A0A0C]/70 p-4 text-[12.5px] text-[#C2C7D6] space-y-2"
        >
          <p className="text-[#F2F2F4] font-medium">
            El autorregistro está restringido en este nodo.
          </p>
          <p>
            Solicita al administrador de tu organización que cree tu acceso desde el panel de Administración o inicia sesión con una cuenta existente.
          </p>
        </div>
      ) : (
        <form
          key="form-register"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void guard(() => handleRegisterSubmit(e)); }}
          className="motion-safe:animate-panel-switch space-y-3"
        >
          <div>
            <label
              htmlFor={`${uid}-reg-name`}
              className={`block text-[11.5px] font-medium mb-1 ${labelTone}`}
            >
              Nombre completo
            </label>
            <div className="group relative flex items-center">
              <User className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-reg-name`}
                type="text"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                aria-invalid={Boolean(fieldErrors.fullName)}
                value={regForm.fullName}
                onChange={(e) => {
                  setRegForm((p) => ({ ...p, fullName: e.target.value }));
                  clearFieldError('register', 'fullName');
                }}
                placeholder="Sofía Martínez"
                className={`w-full h-9.5 pl-9.5 pr-3.5 rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('fullName')}`}
              />
            </div>
            {fieldErrors.fullName && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.fullName}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={`${uid}-reg-email`}
              className={`block text-[11.5px] font-medium mb-1 ${labelTone}`}
            >
              Correo electrónico
            </label>
            <div className="group relative flex items-center">
              <Mail className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-reg-email`}
                type="email"
                required
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                value={regForm.email}
                onChange={(e) => {
                  setRegForm((p) => ({ ...p, email: e.target.value }));
                  clearFieldError('register', 'email');
                }}
                placeholder="sofia@redaccion.org"
                className={`w-full h-9.5 pl-9.5 pr-3.5 rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('email')}`}
              />
            </div>
            {fieldErrors.email && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={`${uid}-reg-org`}
              className={`block text-[11.5px] font-medium mb-1 ${labelTone}`}
            >
              Organización o medio <span className="text-[#9FA6B8]">(opcional)</span>
            </label>
            <div className="group relative flex items-center">
              <Building2 className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-reg-org`}
                type="text"
                maxLength={140}
                aria-invalid={Boolean(fieldErrors.organizationName)}
                value={regForm.organizationName}
                onChange={(e) => {
                  setRegForm((p) => ({ ...p, organizationName: e.target.value }));
                  clearFieldError('register', 'organizationName');
                }}
                placeholder="Redacción Independiente / Investigador"
                className={`w-full h-9.5 pl-9.5 pr-3.5 rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('organizationName')}`}
              />
            </div>
            {fieldErrors.organizationName && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.organizationName}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor={`${uid}-reg-password`}
                className={`text-[11.5px] font-medium ${labelTone}`}
              >
                Contraseña (mín. 12 caracteres)
              </label>
              <span
                className={`font-tech text-[10.5px] transition-colors duration-200 ${
                  pwdLength === 0
                    ? 'text-[#9FA6B8]'
                    : pwdReady
                      ? 'text-[#30D158]'
                      : 'text-[#FF9F0A]'
                }`}
              >
                {pwdLength}/12+
              </span>
            </div>
            <div className="group relative flex items-center">
              <Lock className="h-3.5 w-3.5 text-[#9FA6B8] group-focus-within:text-[#6EA0FF] group-focus-within:scale-110 transition-all duration-150 absolute left-3.5 pointer-events-none" />
              <input
                id={`${uid}-reg-password`}
                type={showRegPwd ? 'text' : 'password'}
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.password)}
                value={regForm.password}
                onChange={(e) => {
                  setRegForm((p) => ({ ...p, password: e.target.value }));
                  clearFieldError('register', 'password');
                }}
                placeholder="Al menos 12 caracteres"
                className={`w-full h-9.5 pl-9.5 ${minimalChrome ? 'pr-16' : 'pr-9.5'} rounded-[10px] border text-[13px] text-[#F2F2F4] focus:outline-none transition-all duration-200 ${inputClass('password')}`}
              />
              <button
                type="button"
                aria-pressed={showRegPwd}
                aria-label={showRegPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowRegPwd((v) => !v)}
                className="absolute right-3 text-[11.5px] font-medium text-[#B8C0D0] hover:text-white active:scale-95 transition-all duration-150 cursor-pointer"
              >
                {minimalChrome
                  ? showRegPwd
                    ? 'Ocultar'
                    : 'Mostrar'
                  : showRegPwd
                    ? <EyeOff className="h-3.5 w-3.5" />
                    : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  pwdLength === 0
                    ? 'w-0 bg-transparent'
                    : pwdReady
                      ? 'bg-[#30D158]'
                      : 'bg-[#FF9F0A]'
                }`}
                style={{ width: `${Math.min(100, Math.round((pwdLength / 12) * 100))}%` }}
              />
            </div>
            {fieldErrors.password && (
              <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {authConfig.bootstrapSecretRequired && (
            <div className="motion-safe:animate-fade-up">
              <label
                htmlFor={`${uid}-reg-secret`}
                className={`block text-[11.5px] font-medium mb-1 flex items-center gap-1 ${labelTone}`}
              >
                <KeyRound className="h-3 w-3 text-[#FF9F0A]" />
                Código de invitación
              </label>
              <input
                id={`${uid}-reg-secret`}
                type="password"
                required
                aria-invalid={Boolean(fieldErrors.bootstrapSecret)}
                value={regForm.bootstrapSecret}
                onChange={(e) => {
                  setRegForm((p) => ({ ...p, bootstrapSecret: e.target.value }));
                  clearFieldError('register', 'bootstrapSecret');
                }}
                placeholder="Ingresa tu código de acceso"
                className={`w-full h-9.5 px-3.5 rounded-[10px] bg-[#0A0A0C]/75 border text-[13px] text-[#F2F2F4] placeholder:text-[#9FA6B8] focus:outline-none transition-all duration-200 ${
                  fieldErrors.bootstrapSecret
                    ? 'border-[#FF453A]/75 focus:border-[#FF453A]'
                    : 'border-[#FF9F0A]/40 focus:border-[#FF9F0A]/75'
                }`}
              />
              {fieldErrors.bootstrapSecret && (
                <p className="motion-safe:animate-fade-up mt-1 text-[11px] text-[#FFB4AE]">
                  {fieldErrors.bootstrapSecret}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="group w-full h-10.5 mt-1 rounded-[10px] bg-[#2F6FED] border border-white/15 hover:-translate-y-[1px] hover:brightness-110 hover:shadow-[0_6px_26px_rgba(47,111,237,0.38)] active:translate-y-0 active:scale-[0.985] disabled:opacity-50 disabled:hover:translate-y-0 text-[13px] font-medium text-white inline-flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
          >
            {loading ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                />
                <span>Creando cuenta...</span>
              </>
            ) : (
              <>
                <span>Crear cuenta y entrar</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Módulo dedicado de Registro, Inicio de Sesión y Biblioteca Privada Zero-Retention.
 */
export function AuthModulePanel({
  authSession,
  onAuthenticated,
  onLogout,
  govStats,
  privateDocs = [],
  loadingDocs = false,
  uploadingPdf = false,
  docNotice = '',
  docError = '',
  onDismissDocBanner,
  onUploadPdf,
  onRefreshDocs,
  onOpenChat,
  onOpenSettings,
  onOpenAuth,
  reasonMessage = '',
  gateMode = false,
  apiOnline = true,
}) {
  const fileInputRef = useRef(null);
  const [gateTab, setGateTab] = useState('login');
  const tenantStats = govStats?.tenant_usage || null;
  const indexedCount = privateDocs.filter((d) => d.status === 'INDEXED').length;

  return (
    <div
      className={
        gateMode
          ? 'relative flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-8 flex flex-col justify-between'
          : 'relative flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 pb-28 sm:pb-12'
      }
    >
      {gateMode && <div className="h-4 shrink-0" aria-hidden="true" />}

      <div
        className={
          !authSession
            ? `relative z-10 mx-auto my-auto w-full transition-[max-width] duration-300 ease-out ${
                gateTab === 'register' ? 'max-w-[424px]' : 'max-w-[396px]'
              }`
            : 'relative z-10 mx-auto w-full max-w-5xl space-y-6'
        }
      >
        {!authSession ? (
          <div>
            {/* Tarjeta única glassmórfica refractando el limbo orbital OMEGA */}
            <section
              aria-label={gateTab === 'register' ? 'Crear cuenta en OMEGA' : 'Iniciar sesión en OMEGA'}
              className="omega-login-glass motion-safe:animate-card-enter overflow-hidden rounded-[20px] p-6 sm:p-7"
            >
              {/* Destello diagonal transitorio sobre vidrio al presentar la puerta */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-y-12 -left-1/3 w-2/3 motion-safe:animate-sheen-sweep"
                style={{
                  background:
                    'linear-gradient(105deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(47, 111, 237, 0) 100%)',
                }}
              />

              {/* Reflejo especular contenido en esquina superior derecha donde incide el arco orbital */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full motion-safe:animate-glow-pulse"
                style={{
                  background:
                    'radial-gradient(circle, rgba(242, 242, 244, 0.14) 0%, rgba(47, 111, 237, 0.18) 38%, rgba(47, 111, 237, 0) 74%)',
                }}
              />

              <div className="relative space-y-5">
                <div className="flex items-center gap-3.5 motion-safe:animate-fade-up motion-safe:[animation-delay:70ms]">
                  <OmegaLogo size={40} />
                  <div key={gateTab} className="min-w-0 motion-safe:animate-fade-in">
                    <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#F2F2F4] leading-tight">
                      {gateTab === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}
                    </h1>
                    <p className="mt-0.5 text-[12.5px] text-[#C2C7D6]">
                      {gateTab === 'register'
                        ? 'Crea tu espacio privado para investigar documentos y alertas'
                        : 'Accede a tu espacio de análisis'}
                    </p>
                  </div>
                </div>

                {!apiOnline && (
                  <div
                    role="status"
                    className="motion-safe:animate-fade-up rounded-[10px] border border-[#FF9F0A]/40 bg-[#FF9F0A]/12 px-3 py-2 text-[12px] text-[#FFE2B8]"
                  >
                    Sin conexión con el gateway OMEGA. Verifica Docker o el servidor Java antes de entrar.
                  </div>
                )}

                <AuthAccessForm
                  minimalChrome
                  activeTab={gateTab}
                  onTabChange={setGateTab}
                  onAuthenticated={onAuthenticated}
                  reasonMessage={reasonMessage}
                />
              </div>
            </section>

            {/* Alternancia inferior limpia estilo puerta de acceso */}
            <p className="motion-safe:animate-fade-up motion-safe:[animation-delay:140ms] mt-4.5 text-center text-[13px] text-[#9A9AA2]">
              {gateTab === 'register' ? '¿Ya tienes una cuenta?' : '¿Nuevo en OMEGA?'}{' '}
              <button
                type="button"
                onClick={() => setGateTab((prev) => (prev === 'login' ? 'register' : 'login'))}
                className="font-medium text-[#F2F2F4] border-b border-[#2F6FED] hover:text-white hover:border-[#6EA0FF] transition-colors duration-150 cursor-pointer"
              >
                {gateTab === 'register' ? 'Iniciar sesión' : 'Crear cuenta'}
              </button>
            </p>
          </div>
        ) : (
          <>
            {/* Encabezado de sesión activa glassmórfico */}
            <section className="omega-glass-panel motion-safe:animate-fade-up rounded-[22px] p-6 flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-center gap-4 min-w-0">
                <OmegaLogo size={60} framed />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30D158]/35 bg-[#30D158]/10 px-2.5 py-0.5 font-tech text-[10.5px] text-[#30D158]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#30D158] motion-safe:animate-pulse" />
                      Sesión activa
                    </span>
                    <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[10.5px] text-[#F2F2F4]">
                      {authSession.role || 'ANALYST'}
                    </span>
                    {authSession.tenantSlug && (
                      <span className="font-tech text-[11px] text-[#9A9AA2]">
                        @{authSession.tenantSlug}
                      </span>
                    )}
                  </div>
                  <h1 className="mt-1.5 text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[#F2F2F4] truncate">
                    {authSession.email}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChat?.(indexedCount > 0)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#2F6FED] hover:brightness-110 hover:shadow-[0_0_24px_rgba(47,111,237,0.28)] px-3.5 py-2 text-[12.5px] font-medium text-white transition-all cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Abrir Asistente</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth?.('Inicia sesión con otra cuenta registrada.')}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/[0.05] border border-white/[0.09] hover:bg-white/[0.09] px-3 py-2 text-[12.5px] text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span>Cambiar cuenta</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLogout?.()}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#FF453A]/35 bg-[#FF453A]/10 hover:bg-[#FF453A]/20 px-3 py-2 text-[12.5px] text-[#FFDAD6] transition-colors cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr] gap-5">
              {/* Biblioteca privada Zero-Retention */}
              <section className="apple-group rounded-[20px] p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                      Biblioteca privada de PDFs
                    </h2>
                    <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                      Consultable desde <span className="text-[#F2F2F4]">Mis PDFs</span> en el Asistente.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void onUploadPdf?.(file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploadingPdf}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-50 px-3 py-1.5 text-[12px] font-medium text-white transition-all cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{uploadingPdf ? 'Procesando en RAM...' : 'Subir PDF'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={loadingDocs}
                      onClick={() => onRefreshDocs?.()}
                      aria-label="Actualizar biblioteca privada"
                      className="h-8 w-8 inline-flex items-center justify-center rounded-[9px] border border-white/[0.09] bg-white/[0.04] hover:bg-white/[0.09] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {(docNotice || docError) && (
                  <div
                    className={`flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-[12px] ${
                      docError
                        ? 'border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FFDAD6]'
                        : 'border-[#30D158]/35 bg-[#30D158]/10 text-[#B8F2C7]'
                    }`}
                  >
                    <span className="truncate">{docError || docNotice}</span>
                    {onDismissDocBanner && (
                      <button
                        type="button"
                        aria-label="Cerrar aviso"
                        onClick={onDismissDocBanner}
                        className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {privateDocs.length === 0 ? (
                  <div className="rounded-[13px] border border-dashed border-white/[0.12] bg-black/25 p-6 text-center space-y-2">
                    <FileText className="h-6 w-6 text-[#2F6FED] mx-auto" />
                    <div className="text-[13px] font-medium text-[#F2F2F4]">
                      Tu biblioteca privada está vacía
                    </div>
                    <p className="text-[12px] text-[#9A9AA2] max-w-md mx-auto">
                      Adjunta informes técnicos, peritajes o reportes internos en PDF para citarlos por página en el chat con cero retención del archivo fuente.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] rounded-[13px] border border-white/[0.08] bg-black/25 overflow-hidden">
                    {privateDocs.map((doc) => {
                      const isIndexed = doc.status === 'INDEXED';
                      const isFailed = doc.status === 'FAILED';
                      return (
                        <div
                          key={doc.id}
                          className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                isIndexed
                                  ? 'bg-[#30D158]'
                                  : isFailed
                                    ? 'bg-[#FF453A]'
                                    : 'bg-[#FF9F0A] animate-pulse'
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-[#F2F2F4] truncate">
                                {doc.originalFilename}
                              </div>
                              <div className="font-tech text-[11px] text-[#9A9AA2] flex flex-wrap items-center gap-2 mt-0.5">
                                <span>{doc.status}</span>
                                <span>·</span>
                                <span>{doc.chunkCount || 0} fragmentos</span>
                                {doc.sha256Hash && (
                                  <>
                                    <span>·</span>
                                    <span>SHA-256: {shortHash(doc.sha256Hash)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {isIndexed && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2.5 py-0.5 font-tech text-[10.5px] text-[#30D158]">
                              <CheckCircle2 className="h-3 w-3" />
                              Listo para RAG
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Telemetría y enlaces a gobernanza */}
              <section className="apple-group rounded-[20px] p-5 sm:p-6 flex flex-col justify-between gap-4">
                <div className="space-y-4">
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                      Resumen de cuenta
                    </h2>
                    <p className="mt-0.5 text-[12px] text-[#9A9AA2]">
                      Resumen de documentos y actividad de tu cuenta.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-[11px] border border-white/[0.07] bg-black/25 p-3">
                      <div className="text-[11px] text-[#9A9AA2]">PDFs indexados</div>
                      <div className="font-tech mt-1 text-[17px] font-semibold text-[#F2F2F4]">
                        {Number(tenantStats?.documents ?? indexedCount)}
                      </div>
                    </div>
                    <div className="rounded-[11px] border border-white/[0.07] bg-black/25 p-3">
                      <div className="text-[11px] text-[#9A9AA2]">Archivos eliminados</div>
                      <div className="font-tech mt-1 text-[17px] font-semibold text-[#30D158]">
                        {Number(tenantStats?.zero_retention_purged_pdfs ?? indexedCount)}
                      </div>
                    </div>
                    <div className="rounded-[11px] border border-white/[0.07] bg-black/25 p-3">
                      <div className="text-[11px] text-[#9A9AA2]">Activos monitoreados</div>
                      <div className="font-tech mt-1 text-[17px] font-semibold text-[#F2F2F4]">
                        {Number(tenantStats?.osint_assets || 0)}
                      </div>
                    </div>
                    <div className="rounded-[11px] border border-white/[0.07] bg-black/25 p-3">
                      <div className="text-[11px] text-[#9A9AA2]">Sesión</div>
                      <div className="mt-1 text-[14px] font-semibold text-[#F2F2F4]">
                        Protegida
                      </div>
                    </div>
                  </div>
                </div>

                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => onOpenSettings('cuenta')}
                    className="w-full rounded-[10px] border border-white/[0.09] bg-white/[0.04] hover:bg-white/[0.08] px-3.5 py-2.5 text-[12px] font-medium text-[#F2F2F4] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>Ajustes, equipo y registro de actividad</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#2F6FED]" />
                  </button>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
