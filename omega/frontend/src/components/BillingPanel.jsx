import { CommercialDocumentsPanel } from './CommercialDocumentsPanel';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarCheck2,
  Check,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Info,
  Layers,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { isDesktopApp, openBillingCheckout } from '../lib/desktopBridge.js';
import {
  cancelBillingSubscription,
  classifyAccountType,
  createBillingCheckout,
  fetchBillingHistory,
  fetchBillingPlans,
  fetchBillingSummary,
  fetchCurrentPrincipal,
  refreshBilling,
  restoreCookieAuthSession,
} from '../lib/api.js';

const formatCopDigits = (value) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(value) || 0);
const money = (value) => `$${formatCopDigits(value)}`;
const date = (value) => (value ? new Date(value).toLocaleDateString('es-CO') : '—');
const planName = (value) => ({ FREE: 'Gratis', PRO: 'Pro', ENTERPRISE: 'Enterprise' })[value] || 'Gratis';
const profileName = (value) =>
  ({ GENERAL: 'General', DEVELOPER: 'Desarrollador', LEGAL: 'Legal' })[value] || 'General';
const bucketLabel = (source) =>
  ({ WELCOME: 'Bienvenida', SUBSCRIPTION: 'Incluidos en tu plan', TOPUP: 'Recarga' })[source] || source;

function MercadoPagoOfficialMark({ className = 'h-6 w-6' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M11.115 16.479a.93.927 0 0 1-.939-.886c-.002-.042-.006-.155-.103-.155c-.04 0-.074.023-.113.059c-.112.103-.254.206-.46.206a.816.814 0 0 1-.305-.066c-.535-.214-.542-.578-.521-.725c.006-.038.007-.08-.02-.11l-.032-.03h-.034c-.027 0-.055.012-.093.039a.788.786 0 0 1-.454.16a.7.699 0 0 1-.253-.05c-.708-.27-.65-.928-.617-1.126q.008-.062-.03-.092l-.05-.04l-.047.043a.728.726 0 0 1-.505.203a.73.728 0 0 1-.732-.725c0-.4.328-.722.732-.722c.364 0 .675.27.721.63l.026.195l.11-.165c.01-.018.307-.46.852-.46c.102 0 .21.016.316.05c.434.13.508.52.519.68c.008.094.075.1.09.1c.037 0 .064-.024.083-.045a.746.744 0 0 1 .54-.225q.193 0 .402.09c.69.293.379 1.158.374 1.167c-.058.144-.061.207-.005.244l.027.013h.02c.03 0 .07-.014.134-.035c.093-.032.235-.08.367-.08a.944.942 0 0 1 .94.93a.936.934 0 0 1-.94.928m7.302-4.171c-1.138-.98-3.768-3.24-4.481-3.77c-.406-.302-.685-.462-.928-.533a1.559 1.554 0 0 0-.456-.07q-.274 0-.58.095c-.46.145-.918.505-1.362.854l-.023.018c-.414.324-.84.66-1.164.73a1.986 1.98 0 0 1-.43.049c-.362 0-.687-.104-.81-.258q-.03-.037.04-.125l.008-.008l1-1.067c.783-.774 1.525-1.506 3.23-1.545h.085c1.062 0 2.12.469 2.24.524a7 7 0 0 0 3.056.724c1.076 0 2.188-.263 3.354-.795a9.135 9.11 0 0 0-.405-.317c-1.025.44-2.003.66-2.946.66c-.962 0-1.925-.229-2.858-.68c-.05-.022-1.22-.567-2.44-.57q-.049 0-.096.002c-1.434.033-2.24.536-2.782.976c-.528.013-.982.138-1.388.25c-.361.1-.673.186-.979.185c-.125 0-.35-.01-.37-.012c-.35-.01-2.115-.437-3.518-.962q-.213.15-.415.31c1.466.593 3.25 1.053 3.812 1.089c.157.01.323.027.491.027c.372 0 .744-.103 1.104-.203c.213-.059.446-.123.692-.17l-.196.194l-1.017 1.087c-.08.08-.254.294-.14.557a.705.703 0 0 0 .268.292c.243.162.677.27 1.08.271q.23 0 .43-.044c.427-.095.874-.448 1.349-.82c.377-.296.913-.672 1.323-.782a1.494 1.494 0 0 1 .37-.05a.611.611 0 0 1 .095.005c.27.034.533.125 1.003.472c.835.62 4.531 3.815 4.566 3.846c.002.002.238.203.22.537c-.007.186-.11.352-.294.466a.902.9 0 0 1-.484.15a.804.802 0 0 1-.428-.124c-.014-.01-1.28-1.157-1.746-1.543c-.074-.06-.146-.115-.22-.115a.12.12 0 0 0-.096.045c-.073.09.01.212.105.294l1.48 1.47c.002 0 .184.17.204.395q.017.367-.35.606a.957.955 0 0 1-.526.171a.766.764 0 0 1-.42-.127l-.214-.206a21.035 20.978 0 0 0-1.08-1.009c-.072-.058-.148-.112-.221-.112a.13.13 0 0 0-.094.038c-.033.037-.056.103.028.212a.698.696 0 0 0 .075.083l1.078 1.198c.01.01.222.26.024.511l-.038.048a1.18 1.178 0 0 1-.1.096c-.184.15-.43.164-.527.164a.8.798 0 0 1-.147-.012q-.16-.027-.212-.089l-.013-.013c-.06-.06-.602-.609-1.054-.98c-.059-.05-.133-.11-.21-.11a.13.13 0 0 0-.096.042c-.09.096.044.24.1.293l.92 1.003a.2.2 0 0 1-.033.062c-.033.044-.144.155-.479.196a.91.907 0 0 1-.122.007c-.345 0-.712-.164-.902-.264a1.343 1.343 0 0 0 .13-.576a1.368 1.365 0 0 0-1.42-1.357c.024-.342-.025-.99-.697-1.274a1.455 1.452 0 0 0-.575-.125q-.22 0-.42.075a1.153 1.153 0 0 0-.671-.564a1.52 1.515 0 0 0-.494-.085q-.421 0-.767.242a1.168 1.165 0 0 0-.903-.43a1.173 1.173 0 0 0-.82.335c-.287-.217-1.425-.93-4.467-1.613a17.39 17.344 0 0 1-.692-.189a4.822 4.822 0 0 0-.077.494l.67.157c3.108.682 4.136 1.391 4.309 1.525a1.145 1.142 0 0 0-.09.442a1.16 1.158 0 0 0 1.378 1.132c.096.467.406.821.879 1.003a1.165 1.162 0 0 0 .415.08q.135 0 .266-.034c.086.22.282.493.722.668a1.233 1.233 0 0 0 .457.094q.183 0 .355-.063a1.373 1.373 0 0 0 1.269.841c.37.002.726-.147.985-.41c.221.121.688.341 1.163.341q.09.001.175-.01c.47-.059.689-.24.789-.382a.571.571 0 0 0 .048-.078c.11.032.234.058.373.058c.255 0 .501-.086.75-.265c.244-.174.418-.424.444-.637v-.01q.125.026.251.026c.265 0 .527-.082.773-.242c.48-.31.562-.715.554-.98a1.28 1.279 0 0 0 .978-.194a1.04 1.04 0 0 0 .502-.808a1.088 1.085 0 0 0-.16-.653c.804-.342 2.636-1.003 4.795-1.483a4.734 4.721 0 0 0-.067-.492a27.742 27.667 0 0 0-5.049 1.62zm5.123-.763c0 4.027-5.166 7.293-11.537 7.293S.465 15.572.465 11.545S5.63 4.252 12.004 4.252c6.371 0 11.537 3.265 11.537 7.293zm.46.004c0-4.272-5.374-7.755-12-7.755S.002 7.277.002 11.55L0 12.004c0 4.533 4.695 8.203 11.999 8.203c7.347 0 12-3.67 12-8.204z" />
    </svg>
  );
}

function PriceDisplay({ value, size = 'lg' }) {
  const digits = formatCopDigits(value);
  const styles =
    size === 'xl'
      ? { symbol: 'text-[17px] leading-none', number: 'text-[28px] leading-none font-semibold tracking-tight' }
      : size === 'sm'
        ? { symbol: 'text-[11px] leading-none', number: 'text-xs leading-none font-medium' }
        : { symbol: 'text-[15px] leading-none', number: 'text-[26px] leading-none font-semibold tracking-tight' };

  return (
    <span className="inline-flex items-baseline gap-0.5 tabular-nums text-[#F5F5F7]">
      <span className={`${styles.symbol} font-normal text-white/50`}>$</span>
      <span className={styles.number}>{digits}</span>
    </span>
  );
}

export function BillingPanel({
  authSession,
  layout = 'settings',
  canContinueFreeGeneral = false,
  onContinueFreeGeneral,
  continuingFreeGeneral = false,
}) {
  const tenantId = authSession?.tenantId;
  const [catalog, setCatalog] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [plan, setPlan] = useState('PRO');
  const [interval, setInterval] = useState('MONTHLY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [payerEmail, setPayerEmail] = useState('');
  const [accountType, setAccountType] = useState('INDIVIDUAL');

  const load = useCallback(async () => {
    const [offers, account] = await Promise.all([fetchBillingPlans(), fetchBillingSummary()]);
    setCatalog(offers);
    setSummary(account);
    if (account.canManage) setHistory(await fetchBillingHistory());
  }, []);

  useEffect(() => {
    let active = true;
    if (tenantId) {
      Promise.resolve()
        .then(load)
        .catch((err) => {
          if (active) setError(err.message);
        });
    }
    return () => {
      active = false;
    };
  }, [tenantId, load]);

  async function action(work) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (err) {
      setError(err.message || 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  const selected = catalog?.plans?.find(
    (item) => item.plan_code === plan && item.interval === interval,
  );
  const monthlyReference = catalog?.plans?.find(
    (item) => item.plan_code === plan && item.interval === 'MONTHLY',
  );
  const pending = summary?.checkouts?.find(
    (item) =>
      item.kind === 'SUBSCRIPTION' &&
      ['PENDING', 'CREATING', 'ACTIVE', 'PAUSED', 'CANCEL_REQUESTED'].includes(item.status),
  );
  const paymentUrl =
    pending?.status === 'CANCEL_REQUESTED'
      ? ''
      : summary?.paymentUrl || (pending?.status === 'PENDING' ? pending.checkout_url : '');
  const canCheckout = summary?.canManage && catalog?.mode !== 'disabled';
  const paid = summary && summary.planCode !== 'FREE';
  const movements = Array.isArray(summary?.movements) ? summary.movements : [];
  const operations = Array.isArray(catalog?.operations) ? catalog.operations : [];

  const annualSubtotal =
    interval === 'ANNUAL' && monthlyReference ? Number(monthlyReference.price) * 12 : null;
  const annualSavings =
    annualSubtotal && selected && annualSubtotal > Number(selected.price)
      ? annualSubtotal - Number(selected.price)
      : 0;
  const accountLabel =
    summary?.accountType === 'INDIVIDUAL'
      ? 'Cuenta individual'
      : summary?.accountType === 'ORGANIZATION'
        ? 'Organización'
        : 'Cuenta';
  const activeProfileLabel = profileName(summary?.profile || authSession?.profile);

  async function checkout(topup = false) {
    await action(async () => {
      const result = await createBillingCheckout({
        planCode: plan,
        interval,
        topup,
        payerEmail: payerEmail || undefined,
      });
      await load();
      setNotice(
        'Pago preparado. Abre Mercado Pago para continuar; tu plan se activará al confirmar el cobro.',
      );
      setSummary((old) => ({ ...old, paymentUrl: result.checkoutUrl }));
    });
  }

  function handleRefreshStatus() {
    return action(async () => {
      await refreshBilling();
      await load();
      window.dispatchEvent(new Event('omega:billing-updated'));
    });
  }

  function handleOpenMercadoPago(event) {
    if (!paymentUrl) return;
    if (isDesktopApp()) {
      event.preventDefault();
      if (!busy) action(() => openBillingCheckout(paymentUrl));
    }
  }

  if (!authSession) return null;

  /* ──────────────────────────────────────────────────────────────────────────
   * MODO CHECKOUT LUJO MINIMALISTA + GLASSMORPHISM PURO (MembershipGate)
   * ────────────────────────────────────────────────────────────────────────── */
  if (layout === 'checkout') {
    const ctaPrice = selected ? money(selected.price) : '';
    const primaryCtaText = busy
      ? 'Preparando pago…'
      : ctaPrice
        ? `Pagar ${ctaPrice} en Mercado Pago`
        : `Continuar con ${planName(plan)}`;

    return (
      <section className="space-y-12 text-sm text-[#F5F5F7]" aria-labelledby="billing-title">
        {/* Alertas de error o confirmación */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            <AlertCircle size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {notice && !paymentUrl && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-xs text-[#F5F5F7]"
          >
            <Check size={15} strokeWidth={1.6} className="mt-0.5 shrink-0 text-white/70" />
            <span>{notice}</span>
          </div>
        )}

        {summary?.accountType === 'UNCLASSIFIED' && summary.canManage && (
          <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] p-6">
            <p className="text-xs text-[#8E929B]">
              Confirma si este espacio antiguo es individual o pertenece a una organización. Esto no
              cambia tu plan ni tus documentos.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2.5 text-xs text-[#8E929B]">
                <span>Tipo de cuenta</span>
                <select
                  value={accountType}
                  onChange={(event) => setAccountType(event.target.value)}
                  className="h-9 rounded-lg border border-white/[0.1] bg-[#0B0D12] px-3 text-xs text-[#F5F5F7] focus:border-white/30 focus:outline-none"
                >
                  <option value="INDIVIDUAL">Cuenta individual</option>
                  <option value="ORGANIZATION">Organización</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                className="h-9 rounded-lg border border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.11] px-4 text-xs font-medium text-[#F5F5F7] transition-colors cursor-pointer disabled:opacity-40"
                onClick={() =>
                  action(async () => {
                    await classifyAccountType(accountType);
                    restoreCookieAuthSession(await fetchCurrentPrincipal());
                    await load();
                  })
                }
              >
                Confirmar tipo de cuenta
              </button>
            </div>
          </div>
        )}

        {/* Grid principal de 2 columnas (62% izquierda / 38% derecha sticky) */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.58fr)_minmax(330px,1fr)] gap-8 lg:gap-10 items-start">
          {/* COLUMNA IZQUIERDA: Selección y Pago */}
          <div className="space-y-8">
            {/* Encabezado respirable */}
            <div className="space-y-2.5">
              {(paymentUrl || pending) && (
                <p className="text-[11.5px] font-medium text-white/65 tracking-wide">
                  Paso 2 · Confirmación pendiente en Mercado Pago
                </p>
              )}
              <h1
                id="billing-title"
                className="text-3xl sm:text-[34px] font-semibold tracking-tight text-[#F5F5F7] leading-tight"
              >
                Elige tu membresía
              </h1>
              <p className="text-[14.5px] text-[#8E929B] leading-relaxed max-w-xl">
                General individual es gratuito. Desarrollador, Legal y espacios de organización
                requieren Pro o Enterprise.
              </p>
            </div>

            {/* Selector Mensual / Anual en cristal OMEGA */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="inline-flex items-center rounded-full bg-[#0F131B]/75 p-1 border border-white/[0.08] backdrop-blur-xl"
                role="group"
                aria-label="Período de pago"
              >
                {[
                  ['MONTHLY', 'Mensual', null],
                  ['ANNUAL', 'Anual', '2 meses de ahorro'],
                ].map(([value, label, badge]) => {
                  const active = interval === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setInterval(value)}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer ${
                        active
                          ? 'bg-white/15 border border-white/15 text-white shadow-sm'
                          : 'border border-transparent text-[#8E929B] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <span>{label}</span>
                      {badge && (
                        <span className="rounded-full bg-blue-500/15 text-blue-300 border border-transparent px-2 py-0.5 text-[11px] font-normal">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tarjetas de Planes (Pro vs Enterprise) en cristal OMEGA */}
            <div
              role="radiogroup"
              aria-label="Plan de suscripción"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5"
            >
              {catalog?.plans
                ?.filter((item) => item.plan_code !== 'FREE' && item.interval === interval)
                .map((item) => {
                  const isSelected = plan === item.plan_code;
                  const monthlyEq =
                    interval === 'ANNUAL' ? Math.round(Number(item.price) / 12) : Number(item.price);
                  return (
                    <button
                      key={item.plan_code}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setPlan(item.plan_code)}
                      className={`relative overflow-hidden flex flex-col justify-between gap-6 rounded-2xl border p-6 sm:p-7 text-left backdrop-blur-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED] cursor-pointer ${
                        isSelected
                          ? 'bg-[#141923]/80 border-[#2F6FED]/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_20px_48px_rgba(4,8,18,0.55)]'
                          : 'bg-[#0F131B]/60 border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] hover:bg-[#141923]/65 hover:border-white/[0.14]'
                      }`}
                    >
                      {/* Reflejo radial superior interno en azul OMEGA contenido */}
                      {isSelected && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_85%_60%_at_50%_0%,rgba(47,111,237,0.16),transparent_75%)]"
                        />
                      )}

                      <div className="relative space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="text-[16px] font-medium tracking-tight text-[#F5F5F7]">
                              {item.name}
                            </span>
                            <span className="mt-1 block text-xs text-[#8E929B]">
                              {item.plan_code === 'PRO'
                                ? 'Para profesionales independientes'
                                : 'Para equipos y firmas'}
                            </span>
                          </div>
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                              isSelected
                                ? 'border-[#2F6FED] bg-[#2F6FED] text-white'
                                : 'border-white/20 bg-transparent'
                            }`}
                          >
                            {isSelected && <Check size={12} strokeWidth={2.5} />}
                          </span>
                        </div>

                        <div>
                          <div className="flex items-baseline gap-1">
                            <PriceDisplay value={item.price} size="lg" />
                            <span className="text-xs text-[#8E929B]">
                              /{interval === 'ANNUAL' ? 'año' : 'mes'}
                            </span>
                          </div>
                          {interval === 'ANNUAL' && (
                            <span className="mt-1 block text-[11.5px] text-[#9EB8E8] tabular-nums">
                              Equivale a {money(monthlyEq)}/mes · pago anticipado
                            </span>
                          )}
                        </div>
                      </div>

                      <ul className="relative space-y-2.5 border-t border-white/[0.06] pt-5 text-xs text-[#D2D6E2]">
                        <li className="flex items-center gap-2.5">
                          <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                          <span className="tabular-nums">
                            {Number(item.credits).toLocaleString('es-CO')} créditos mensuales
                          </span>
                        </li>
                        <li className="flex items-center gap-2.5">
                          <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                          <span>
                            {item.max_users} {item.max_users === 1 ? 'usuario' : 'usuarios'} ·{' '}
                            {item.max_devices} equipos
                          </span>
                        </li>
                        <li className="flex items-center gap-2.5">
                          <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                          <span>General, Desarrollador y Legal incluidos</span>
                        </li>
                      </ul>
                    </button>
                  );
                })}
            </div>

            {/* Banner oficial de Mercado Pago adaptado a la paleta OMEGA (sin cajas internas) */}
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F131B]/65 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] p-6 sm:p-7 space-y-4">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-48 rounded-full bg-[#2F6FED]/[0.09] blur-2xl"
              />
              <div className="relative flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2F6FED]/30 bg-[#2F6FED]/12 text-[#8AB4FF]">
                    <MercadoPagoOfficialMark className="h-7 w-7" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-medium tracking-tight text-[#F5F5F7]">
                        Mercado Pago
                      </h2>
                      <span className="rounded-full border border-[#2F6FED]/30 bg-[#2F6FED]/12 px-2 py-0.5 text-[10px] font-medium text-[#9EB8E8]">
                        Pasarela oficial
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#8E929B]">
                      Checkout seguro y encriptado · Activación automática
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#8E929B]">
                  <Lock size={12} strokeWidth={1.5} className="text-[#7AA7FF]" />
                  <span>TLS · Encriptado</span>
                </span>
              </div>

              <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4 text-xs">
                <span className="text-[#8E929B]">Medios aceptados en Colombia</span>
                <span className="text-[#D2D6E2]/80 tracking-wide">
                  Crédito · Débito · PSE · Efectivo
                </span>
              </div>

              {catalog?.mode === 'disabled' && (
                <p className="relative text-xs text-[#8E929B]">
                  Los pagos aún no están disponibles. Puedes consultar los planes y el consumo.
                </p>
              )}
              {catalog?.enforced === false && (
                <p className="relative text-xs text-[#9EB8E8]">
                  Modo de desarrollo: los módulos conservan sus funciones y las operaciones no
                  consumen créditos.
                </p>
              )}
            </div>
          </div>

          {/* COLUMNA DERECHA (Sticky): Lámina de cristal esmerilado en paleta OMEGA */}
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-2xl border border-[#2F6FED]/25 bg-[#0F131B]/82 backdrop-blur-3xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_24px_64px_rgba(0,0,0,0.5)] p-6 sm:p-7 space-y-6">
              {/* Encabezado con plan elegido + recargar estado */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#8E929B]">
                    Resumen de tu membresía
                  </p>
                  <h2 className="mt-1.5 text-lg font-medium tracking-tight text-[#F5F5F7]">
                    Plan {planName(plan)} · {interval === 'ANNUAL' ? 'Anual' : 'Mensual'}
                  </h2>
                  <p className="mt-0.5 text-xs text-[#8E929B]">
                    {accountLabel} · {activeProfileLabel}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Actualizar pagos y saldo"
                  title="Actualizar estado del pago"
                  disabled={busy}
                  onClick={handleRefreshStatus}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#141923]/75 text-white/65 hover:border-[#2F6FED]/40 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw size={13} strokeWidth={1.5} className={busy ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Lista limpia de beneficios */}
              <ul className="space-y-2.5 border-t border-white/[0.06] pt-5 text-xs text-[#D2D6E2]">
                {selected && (
                  <li className="flex items-center gap-2.5">
                    <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                    <span className="tabular-nums">
                      {Number(selected.credits).toLocaleString('es-CO')} créditos mensuales
                    </span>
                  </li>
                )}
                <li className="flex items-center gap-2.5">
                  <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                  <span className="tabular-nums">
                    + {Number(summary?.balance ?? 30)} créditos de bienvenida incluidos
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={13} strokeWidth={1.6} className="text-[#7AA7FF] shrink-0" />
                  <span>Acceso completo a General, Desarrollador y Legal</span>
                </li>
              </ul>

              {/* Desglose financiero con divisor hairline */}
              <div className="space-y-2.5 border-t border-white/[0.06] pt-5 text-xs">
                <div className="flex items-center justify-between text-[#8E929B]">
                  <span>Subtotal</span>
                  <span className="tabular-nums text-[#D2D6E2]">
                    {annualSubtotal ? money(annualSubtotal) : selected ? money(selected.price) : '—'}
                  </span>
                </div>
                {annualSavings > 0 && (
                  <div className="flex items-center justify-between text-[#9EB8E8]">
                    <span>Ahorro anual (2 meses)</span>
                    <span className="tabular-nums">−{money(annualSavings)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-white/[0.06] pt-4">
                  <span className="text-sm font-medium text-[#F5F5F7]">Total a pagar hoy</span>
                  {selected ? <PriceDisplay value={selected.price} size="xl" /> : <span>—</span>}
                </div>
              </div>

              {/* Estado de pago preparado (condicional) */}
              {(paymentUrl || pending) && (
                <div className="border-t border-white/[0.06] pt-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-2 font-medium text-[#F5F5F7]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" />
                      {pending?.status === 'CREATING'
                        ? 'Conciliación en curso'
                        : pending?.status === 'PAUSED'
                          ? 'Suscripción pausada'
                          : 'Pago preparado'}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleRefreshStatus}
                      className="text-[11.5px] text-[#9EB8E8] hover:text-white underline underline-offset-4 cursor-pointer disabled:opacity-40"
                    >
                      Recargar estado
                    </button>
                  </div>
                  <p className="text-[11.5px] text-[#8E929B]">
                    {pending?.status === 'CREATING'
                      ? 'Espera a confirmar el estado antes de reintentar.'
                      : 'Completa el cobro en Mercado Pago y recarga el estado para entrar.'}
                  </p>
                </div>
              )}

              {/* CTA Principal de alto contraste estilo Apple en una sola línea */}
              <div className="space-y-3 pt-1">
                {paymentUrl ? (
                  <a
                    href={paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleOpenMercadoPago}
                    className="flex h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-white hover:bg-neutral-200 active:scale-[0.99] px-4 text-sm font-medium text-[#050608] transition-all"
                  >
                    <span>{primaryCtaText}</span>
                    <ArrowUpRight size={15} strokeWidth={1.8} className="shrink-0" />
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !canCheckout || !selected || Boolean(pending)}
                    onClick={() => checkout()}
                    className="flex h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-white hover:bg-neutral-200 active:scale-[0.99] px-4 text-sm font-medium text-[#050608] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0C] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>{primaryCtaText}</span>
                    {!busy && <ArrowUpRight size={15} strokeWidth={1.8} className="shrink-0" />}
                  </button>
                )}

                <p className="text-center text-[11px] text-[#8E929B]/80 leading-relaxed">
                  Al continuar aceptas los Términos y Condiciones y la Política de Privacidad.
                </p>

                {canContinueFreeGeneral && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={onContinueFreeGeneral}
                      disabled={continuingFreeGeneral}
                      className="text-xs text-[#8E929B] hover:text-[#F5F5F7] underline underline-offset-4 decoration-white/20 hover:decoration-white/60 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {continuingFreeGeneral ? 'Cambiando perfil…' : 'Continuar con General gratis'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Franja minimalista y aireada de 3 columnas (Política de suscripción y cancelación) */}
        <div className="border-t border-white/[0.06] pt-8 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          <div className="flex items-start gap-3">
            <Layers size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#7AA7FF]" />
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[#F5F5F7]">Tres perfiles unificados</h3>
              <p className="text-xs text-[#8E929B] leading-relaxed">
                Pro y Enterprise habilitan General, Desarrollador y Legal compartiendo una sola
                bolsa de créditos.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CalendarCheck2 size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#7AA7FF]" />
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[#F5F5F7]">Renovación mensual</h3>
              <p className="text-xs text-[#8E929B] leading-relaxed">
                El plan anual entrega tus créditos cada mes y ahorra el equivalente a dos meses.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <ShieldCheck size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#7AA7FF]" />
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[#F5F5F7]">Cancelación sin penalizaciones</h3>
              <p className="text-xs text-[#8E929B] leading-relaxed">
                Gestiona o cancela tu suscripción en cualquier momento conservando tu período
                pagado.
              </p>
            </div>
          </div>
        </div>

        {/* Acordeones discretos sin caja pesada */}
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          <details className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
              <span>Consumo por función</span>
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className="text-white/40 transition-transform duration-150 group-open:rotate-180"
              />
            </summary>
            <div className="mt-3 divide-y divide-white/[0.06]">
              {operations.length === 0 ? (
                <p className="py-2 text-xs text-[#8E929B]">
                  No hay tabla de consumo disponible en este momento.
                </p>
              ) : (
                operations.map((op) => (
                  <div key={op.code} className="flex justify-between gap-4 py-2.5 text-xs">
                    <span>
                      <span className="text-[#F5F5F7]">{op.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[#8E929B]">
                        {op.scope}
                        {op.paidOnly ? ' · Plan de pago' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-white/75 tabular-nums">
                      {op.credits} créditos{op.code === 'LEGAL_INDEX' ? ' / bloque' : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
            <p className="mt-2.5 text-[11.5px] text-[#8E929B]">
              Consultar resultados, gestionar proyectos y exportar datos existentes no consume
              créditos. Los fallos sin resultado liberan la reserva.
            </p>
          </details>

          {summary?.canManage && (
            <details className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
                <span>Opciones de suscripción e historial</span>
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  className="text-white/40 transition-transform duration-150 group-open:rotate-180"
                />
              </summary>
              <div className="mt-4 space-y-4">
                {(paid || pending) && !summary.cancelAtPeriodEnd && (
                  <div>
                    {cancelConfirm ? (
                      <div className="space-y-2.5 border-l border-white/[0.12] pl-4">
                        <p className="text-xs text-[#D2D6E2]">
                          Se detendrán los próximos cobros o el pago pendiente actual.
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                await cancelBillingSubscription();
                                await load();
                                setCancelConfirm(false);
                                setNotice('Solicitud cancelada correctamente.');
                              })
                            }
                            className="h-8 rounded-lg border border-rose-500/35 bg-rose-500/15 hover:bg-rose-500/25 px-3 text-xs font-medium text-rose-200 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            Confirmar cancelación
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelConfirm(false)}
                            className="text-xs text-[#8E929B] hover:text-[#F5F5F7] transition-colors cursor-pointer"
                          >
                            Volver
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCancelConfirm(true)}
                        className="text-xs text-[#8E929B] hover:text-[#F5F5F7] underline underline-offset-4 transition-colors cursor-pointer"
                      >
                        Cancelar renovación o pago pendiente
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[#D2D6E2]">Historial de pagos</h4>
                  {history.length === 0 ? (
                    <p className="text-xs text-[#8E929B]">Todavía no hay pagos registrados.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {history.map((item) => (
                        <p
                          key={item.mp_payment_id}
                          className="flex flex-wrap justify-between gap-2 py-2 text-xs text-[#D2D6E2]"
                        >
                          <span>
                            {date(item.approved_at)} · {item.status}
                          </span>
                          <span className="font-mono tabular-nums">{money(item.amount)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
          )}

          {catalog?.mode === 'test' && summary?.canManage && (
            <details className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
                <span>Opciones de prueba (Sandbox)</span>
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  className="text-white/40 transition-transform duration-150 group-open:rotate-180"
                />
              </summary>
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-[#D2D6E2]">
                  Correo del comprador de prueba
                  <input
                    type="email"
                    value={payerEmail}
                    onChange={(event) => setPayerEmail(event.target.value)}
                    placeholder="test_user_...@testuser.com"
                    className="mt-1.5 block h-9 w-full max-w-md rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-xs text-[#F5F5F7] placeholder:text-[#8E929B]/70 focus:border-white/30 focus:outline-none"
                  />
                </label>
                <p className="text-[11px] text-[#8E929B]">
                  Opcional: sobrescribe el correo del comprador al preparar un pago en el sandbox de
                  Mercado Pago.
                </p>
              </div>
            </details>
          )}
        <CommercialDocumentsPanel authenticated compact />
      </div>
      </section>
    );
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * MODO CONFIGURACIÓN (dentro de AccountSettingsPanel -> "Mi plan y créditos")
   * ────────────────────────────────────────────────────────────────────────── */
  return (
    <section className="space-y-6 text-sm text-[#D2D6E2]" aria-labelledby="billing-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2
              id="billing-title"
              className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.015em] text-[#F5F5F7]"
            >
              <CreditCard size={15} strokeWidth={1.6} className="text-white/60 shrink-0" />
              Mi plan y créditos
            </h2>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-mono ${
                paid
                  ? 'bg-white/[0.1] text-[#F5F5F7] border border-white/20'
                  : 'bg-white/[0.04] text-[#8E929B] border border-white/[0.08]'
              }`}
            >
              {planName(summary?.planCode)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8E929B]">
            {accountLabel} · {activeProfileLabel}
          </p>
        </div>

        <button
          type="button"
          aria-label="Actualizar pagos y saldo"
          title="Actualizar pagos y saldo"
          disabled={busy}
          onClick={handleRefreshStatus}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw size={13} strokeWidth={1.5} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
        >
          <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 py-2.5 text-xs text-[#F5F5F7]"
        >
          <Check size={14} strokeWidth={1.6} className="mt-0.5 shrink-0 text-white/70" />
          <span>{notice}</span>
        </div>
      )}

      {(catalog?.mode === 'test' || catalog?.mode === 'disabled' || catalog?.enforced === false) && (
        <div className="space-y-1.5 rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-3 text-xs">
          {catalog?.mode === 'test' && (
            <p className="flex items-center gap-2 text-white/80">
              <Info size={14} strokeWidth={1.5} className="shrink-0 text-white/60" />
              <span>
                Entorno de pruebas de Mercado Pago. Utiliza exclusivamente cuentas y tarjetas de
                prueba.
              </span>
            </p>
          )}
          {catalog?.enforced === false && (
            <p className="flex items-center gap-2 text-amber-300/90">
              <Info size={14} strokeWidth={1.5} className="shrink-0" />
              <span>
                Modo de desarrollo: los módulos conservan sus funciones y las operaciones no
                consumen créditos.
              </span>
            </p>
          )}
          {catalog?.mode === 'disabled' && (
            <p className="text-[#8E929B]">
              Los pagos aún no están disponibles. Puedes consultar los planes y el consumo.
            </p>
          )}
        </div>
      )}

      {summary?.accountType === 'UNCLASSIFIED' && summary.canManage && (
        <div className="space-y-3 rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
          <p className="text-xs text-[#D2D6E2]">
            Confirma si este espacio antiguo es individual o pertenece a una organización. Esto no
            cambia tu plan ni tus documentos.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2.5 text-xs text-[#8E929B]">
              <span>Tipo de cuenta</span>
              <select
                value={accountType}
                onChange={(event) => setAccountType(event.target.value)}
                className="h-9 rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="INDIVIDUAL">Cuenta individual</option>
                <option value="ORGANIZATION">Organización</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              className="h-9 rounded-lg border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.09] px-3.5 text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-40"
              onClick={() =>
                action(async () => {
                  await classifyAccountType(accountType);
                  restoreCookieAuthSession(await fetchCurrentPrincipal());
                  await load();
                })
              }
            >
              Confirmar tipo de cuenta
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-3 border-y border-white/[0.06] py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="flex items-baseline gap-2.5">
              <strong className="text-3xl font-semibold tracking-tight tabular-nums text-[#F5F5F7]">
                {summary.balance}
              </strong>
              <span className="text-xs text-[#8E929B]">créditos disponibles</span>
            </p>
            {summary.buckets?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {summary.buckets.map((bucket, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.07] px-2.5 py-1 font-mono text-[11px] text-[#D2D6E2] tabular-nums"
                  >
                    <span>
                      {bucketLabel(bucket.source)}: {bucket.remaining}
                    </span>
                    {bucket.source !== 'WELCOME' && (
                      <span className="text-[#8E929B]">· vence {date(bucket.expires_at)}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-[#8E929B] leading-relaxed">
            {summary.reserved > 0 ? `${summary.reserved} reservados en operaciones pendientes. ` : ''}
            {paid
              ? `Acceso pagado hasta ${date(summary.paidUntil)}.${
                  summary.cancelAtPeriodEnd ? ' La renovación está cancelada.' : ''
                }`
              : catalog?.enforced === false
                ? 'Los límites comerciales se aplican al activar las pruebas de pagos o desplegar en producción.'
                : 'General incluye 30 créditos de bienvenida, una sola vez. Desarrollador y Legal requieren Pro o Enterprise.'}
          </p>
        </div>
      )}

      {!paid && (
        <div className="space-y-4">
          <div
            className="inline-flex items-center rounded-full bg-white/[0.04] border border-white/[0.08] p-1"
            role="group"
            aria-label="Período de pago"
          >
            {[
              ['MONTHLY', 'Mensual', null],
              ['ANNUAL', 'Anual', '2 meses de ahorro'],
            ].map(([value, label, badge]) => {
              const active = interval === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setInterval(value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    active ? 'bg-white/[0.12] text-[#F5F5F7]' : 'text-[#8E929B] hover:text-[#F5F5F7]'
                  }`}
                >
                  <span>{label}</span>
                  {badge && (
                    <span className="rounded-full bg-white/[0.08] text-white/90 border border-white/10 px-2 py-0.5 text-[10px] font-normal">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            role="radiogroup"
            aria-label="Plan de suscripción"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3.5"
          >
            {catalog?.plans
              ?.filter((item) => item.plan_code !== 'FREE' && item.interval === interval)
              .map((item) => {
                const isSelected = plan === item.plan_code;
                return (
                  <button
                    key={item.plan_code}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setPlan(item.plan_code)}
                    className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 cursor-pointer ${
                      isSelected
                        ? 'bg-white/[0.07] border-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]'
                        : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.14] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[14px] font-medium text-[#F5F5F7]">{item.name}</span>
                        <span className="mt-1 block text-xs text-[#8E929B]">
                          {item.credits} créditos mensuales · {item.max_users}{' '}
                          {item.max_users === 1 ? 'usuario' : 'usuarios'} · {item.max_devices}{' '}
                          equipos
                        </span>
                      </div>
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isSelected
                            ? 'border-white bg-white text-[#050608]'
                            : 'border-white/20 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={2.5} />}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2 pt-3 border-t border-white/[0.06]">
                      <PriceDisplay value={item.price} size="lg" />
                      <span className="text-[11px] text-[#8E929B]">
                        {interval === 'ANNUAL' ? '/año, anticipado' : '/mes'}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>

          <p className="text-xs text-[#8E929B]">
            Pro y Enterprise habilitan los tres perfiles y comparten una única bolsa de créditos. El
            plan anual entrega créditos cada mes.
          </p>

          {!pending && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={busy || !canCheckout || !selected}
                onClick={() => checkout()}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white hover:bg-neutral-200 px-4 text-xs font-medium text-[#050608] active:scale-[0.98] transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>
                  {busy
                    ? 'Preparando pago…'
                    : selected
                      ? `Continuar con Mercado Pago · ${money(selected.price)}`
                      : `Continuar con ${planName(plan)}`}
                </span>
                {!busy && <ArrowUpRight size={14} strokeWidth={1.8} />}
              </button>
              {catalog?.mode === 'disabled' && (
                <span className="text-xs text-[#8E929B]">
                  Vista de consulta — el cobro se habilita al configurar Mercado Pago.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {paymentUrl && (
        <a
          href={paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleOpenMercadoPago}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-white hover:bg-neutral-200 px-4 text-xs font-medium text-[#050608] transition-colors"
        >
          <span>Continuar en Mercado Pago</span>
          <ExternalLink size={13} strokeWidth={1.75} />
        </a>
      )}

      {pending?.status === 'PAUSED' && (
        <p className="text-xs text-white/75">
          La suscripción está pausada en Mercado Pago. Puedes cancelarla desde Opciones de
          suscripción.
        </p>
      )}
      {pending?.status === 'CREATING' && (
        <p role="status" className="text-xs text-white/75">
          La creación del pago está pendiente de conciliación. No vuelvas a pagar hasta confirmar su
          estado.
        </p>
      )}

      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
        <details className="group py-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
            <span>Consumo por función</span>
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              className="text-white/40 transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 divide-y divide-white/[0.06]">
            {operations.length === 0 ? (
              <p className="py-2 text-xs text-[#8E929B]">
                No hay tabla de consumo disponible en este momento.
              </p>
            ) : (
              operations.map((op) => (
                <div key={op.code} className="flex justify-between gap-4 py-2.5 text-xs">
                  <span>
                    <span className="text-[#F5F5F7]">{op.label}</span>
                    <span className="mt-0.5 block text-[11px] text-[#8E929B]">
                      {op.scope}
                      {op.paidOnly ? ' · Plan de pago' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-white/75 tabular-nums">
                    {op.credits} créditos{op.code === 'LEGAL_INDEX' ? ' / bloque' : ''}
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="mt-2.5 text-[11.5px] text-[#8E929B]">
            Consultar resultados, gestionar proyectos y exportar datos existentes no consume
            créditos. Los fallos sin resultado liberan la reserva.
          </p>
        </details>

        {summary?.canManage && (
          <details className="group py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
              <span>Opciones de suscripción</span>
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className="text-white/40 transition-transform duration-150 group-open:rotate-180"
              />
            </summary>
            <div className="mt-4 space-y-4">
              {catalog?.mode === 'test' && (
                <label className="block text-xs text-[#D2D6E2]">
                  Correo del comprador de prueba
                  <input
                    type="email"
                    value={payerEmail}
                    onChange={(event) => setPayerEmail(event.target.value)}
                    placeholder="comprador_test@testuser.com"
                    className="mt-1.5 block h-9 w-full max-w-sm rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white placeholder:text-[#8E929B] focus:border-white/30 focus:outline-none"
                  />
                </label>
              )}

              {paid && (
                <div className="space-y-2">
                  <p className="text-xs text-[#8E929B]">
                    Recarga: 200 créditos por {money(29900)}. Vigencia de 12 meses; no renueva
                    automáticamente.
                  </p>
                  <button
                    type="button"
                    disabled={busy || !canCheckout}
                    onClick={() => checkout(true)}
                    className="h-8 rounded-lg border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.09] px-3 text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-40"
                  >
                    Preparar recarga
                  </button>
                </div>
              )}

              {(paid || pending) && !summary.cancelAtPeriodEnd && (
                <div>
                  {cancelConfirm ? (
                    <div className="space-y-2.5 border-l border-white/[0.12] pl-4">
                      <p className="text-xs text-[#D2D6E2]">
                        Se detendrán los próximos cobros. Conservarás el acceso hasta la fecha
                        pagada.
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              await cancelBillingSubscription();
                              await load();
                              setCancelConfirm(false);
                              setNotice(
                                'Renovación cancelada. Conservas el período ya pagado.',
                              );
                            })
                          }
                          className="h-8 rounded-lg border border-rose-500/35 bg-rose-500/15 hover:bg-rose-500/25 px-3 text-xs font-medium text-rose-200 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          Confirmar cancelación
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelConfirm(false)}
                          className="text-xs text-[#8E929B] hover:text-white transition-colors cursor-pointer"
                        >
                          Volver
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCancelConfirm(true)}
                      className="text-xs text-[#8E929B] hover:text-[#F5F5F7] underline underline-offset-4 transition-colors cursor-pointer"
                    >
                      Cancelar renovación o pago pendiente
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-medium text-[#D2D6E2]">Historial de pagos</h3>
                {history.length === 0 ? (
                  <p className="text-xs text-[#8E929B]">Todavía no hay pagos registrados.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {history.map((item) => (
                      <p
                        key={item.mp_payment_id}
                        className="flex flex-wrap justify-between gap-2 py-2 text-xs text-[#D2D6E2]"
                      >
                        <span>
                          {date(item.approved_at)} · {item.status}
                        </span>
                        <span className="font-mono tabular-nums">{money(item.amount)}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </details>
        )}

        <details className="group py-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[#8E929B] hover:text-[#F5F5F7] transition-colors [&::-webkit-details-marker]:hidden">
            <span>Actividad de créditos</span>
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              className="text-white/40 transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 divide-y divide-white/[0.06]">
            {movements.length === 0 ? (
              <p className="py-2 text-xs text-[#8E929B]">
                Aún no hay movimientos de créditos registrados.
              </p>
            ) : (
              movements.map((item, index) => (
                <p
                  key={index}
                  className="flex justify-between gap-3 py-2 text-xs text-[#D2D6E2]"
                >
                  <span>
                    {operations.find((op) => op.code === item.operation)?.label || item.operation} ·{' '}
                    <span className="text-[#8E929B]">{date(item.created_at)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[#8E929B]">
                    {item.status === 'RESERVED'
                      ? `${item.amount} reservados`
                      : item.status === 'RELEASED'
                        ? 'Devueltos'
                        : `${item.charged} usados`}
                  </span>
                </p>
              ))
            )}
          </div>
        </details>
      </div>
    <CommercialDocumentsPanel authenticated compact />
    </section>
  );
}
