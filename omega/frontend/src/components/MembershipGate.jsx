import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, LogOut, RefreshCw } from 'lucide-react';
import { fetchBillingSummary, updateTenantProfile } from '../lib/api.js';
import { BillingPanel } from './BillingPanel.jsx';
import { OmegaBrandMark } from './OmegaBrandMark';
import { GoogleAccountLink } from './GoogleAccountLink';

export function MembershipGate({ authSession, onLogout, onProfileChanged, children }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const identity = authSession ? `${authSession.tenantId}:${authSession.userId}` : '';

  const refresh = useCallback(async () => {
    if (!identity) return;
    try {
      const summary = await fetchBillingSummary();
      setAccount({ identity, ...summary });
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudo verificar tu membresía.');
    }
  }, [identity]);

  useEffect(() => {
    let active = true;
    if (identity) void refresh();
    const update = () => {
      if (active) void refresh();
    };
    window.addEventListener('omega:billing-updated', update);
    window.addEventListener('focus', update);
    const timer = identity ? window.setInterval(update, 30000) : null;
    return () => {
      active = false;
      window.removeEventListener('omega:billing-updated', update);
      window.removeEventListener('focus', update);
      if (timer) window.clearInterval(timer);
    };
  }, [identity, refresh]);

  if (!identity) return children;
  const current = account?.identity === identity ? account : null;
  if (current?.workspaceAccess === true) return children;

  async function switchToGeneral() {
    setBusy(true);
    try {
      await updateTenantProfile('GENERAL', true);
      await onProfileChanged?.();
      await refresh();
      window.dispatchEvent(new Event('omega:billing-updated'));
    } catch (err) {
      setError(err.message || 'No se pudo cambiar a General.');
    } finally {
      setBusy(false);
    }
  }

  const isSandbox = current?.mode === 'test';
  const welcomeBalance = Number(current?.balance ?? 30);

  return (
    <main className="relative isolate h-dvh overflow-y-auto overflow-x-hidden bg-[#0A0A0C] text-[#F5F5F7]">
      {/* Orbes ambientales difusos en la paleta azul rey de OMEGA para refracción real */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-28 left-[8%] h-[520px] w-[520px] rounded-full bg-[#2F6FED]/[0.12] blur-[125px]" />
        <div className="absolute top-[16%] right-[6%] h-[480px] w-[480px] rounded-full bg-[#172540]/[0.28] blur-[120px]" />
        <div className="absolute bottom-[-120px] left-[32%] h-[380px] w-[560px] rounded-full bg-[#2F6FED]/[0.07] blur-[120px]" />
      </div>

      {/* Barra delgada y discreta superior si el entorno Sandbox de Mercado Pago está activo */}
      {isSandbox && (
        <div
          role="status"
          className="border-b border-[#2F6FED]/20 bg-[#0F131B]/90 px-4 py-1.5 text-center text-[11.5px] text-[#9EB8E8]"
        >
          Entorno de pruebas (Sandbox) de Mercado Pago activo · Usa exclusivamente cuentas y
          tarjetas de prueba.
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10 py-6 sm:py-8">
        {/* Header minimalista estilo Apple / Claude en paleta OMEGA */}
        <header className="mb-10 sm:mb-12 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
          <OmegaBrandMark />

          {current && (
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0F131B]/75 backdrop-blur-xl px-3.5 py-1 text-[11.5px] text-[#8E929B]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED] shrink-0" />
              <span>
                Sin membresía activa ·{' '}
                <strong className="font-medium tabular-nums text-[#F5F5F7]">
                  {welcomeBalance}
                </strong>{' '}
                créditos de bienvenida
              </span>
            </span>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0F131B]/65 hover:bg-[#141923] px-3.5 py-1.5 text-xs text-[#8E929B] hover:text-[#F5F5F7] transition-colors cursor-pointer"
          >
            <LogOut size={13} strokeWidth={1.5} />
            <span>Cerrar sesión</span>
          </button>
        </header>

        {error && (
          <p
            role="alert"
            className="mb-6 flex items-center gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            <AlertCircle size={15} strokeWidth={1.5} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </p>
        )}

        {current && <div className="mb-4"><GoogleAccountLink /></div>}

        {current ? (
          <BillingPanel
            authSession={authSession}
            layout="checkout"
            canContinueFreeGeneral={
              current.accountType === 'INDIVIDUAL' && current.profile !== 'GENERAL'
            }
            onContinueFreeGeneral={() => void switchToGeneral()}
            continuingFreeGeneral={busy}
          />
        ) : (
          <div className="mx-auto max-w-lg rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] p-9 text-center space-y-4">
            <h1 className="text-xl font-medium tracking-tight text-[#F5F5F7]">
              Verificando tu membresía
            </h1>
            <p className="text-sm text-[#8E929B]">
              Comprobando el estado de tu cuenta y saldo disponible…
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.09] px-4 py-2 text-xs font-medium text-[#F5F5F7] transition-colors cursor-pointer"
            >
              <RefreshCw size={13} strokeWidth={1.5} />
              <span>{error ? 'Reintentar' : 'Comprobar acceso'}</span>
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
