import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  LifeBuoy,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  acceptTeamInvitation,
  createTeamInvitation,
  fetchPilotFunnel,
  fetchPublicSystemStatus,
  fetchTeamInvitations,
  revokeTeamInvitation,
  submitSupportTicket,
} from '../lib/api';

const ROLE_CHOICES = [
  { id: 'ANALYST', label: 'Analista', hint: 'Escaneos, expedientes y consultas' },
  { id: 'CLIENT', label: 'Lectura', hint: 'Consulta de reportes y estado' },
  { id: 'ADMIN', label: 'Admin', hint: 'Gestión de equipo y políticas' },
];

const SUPPORT_CATEGORIES = [
  { id: 'BUG', label: 'Fallo técnico' },
  { id: 'FALSE_POSITIVE', label: 'Falso positivo' },
  { id: 'UX', label: 'Duda de uso' },
  { id: 'BILLING', label: 'Plan o cuota' },
];

/**
 * Modal nativo <dialog> (modern-web-guidance: dialog + forms) para:
 * - Reportar un problema con contexto saneado (Fase 3.2)
 * - Unirse con código de invitación (Fase 3.1)
 * - Consultar Política Zero-Retention, Términos del Piloto, Planes y Estado (Fase 4)
 */
export function PilotTrustAndSupportDialog({
  isOpen,
  initialMode = 'trust',
  currentView = 'cuenta',
  authSession = null,
  onClose,
  onInvitationAccepted,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [activeTab, setActiveTab] = useState(initialMode);
  const [publicStatus, setPublicStatus] = useState(null);

  // Support ticket form state
  const [category, setCategory] = useState('BUG');
  const [summary, setSummary] = useState('');
  const [submittingSupport, setSubmittingSupport] = useState(false);
  const [supportStatus, setSupportStatus] = useState('');
  const [supportError, setSupportError] = useState('');

  // Invitation accept form state
  const [inviteToken, setInviteToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [recoveryKeyIssued, setRecoveryKeyIssued] = useState('');

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      fetchPublicSystemStatus()
        .then((data) => setPublicStatus(data))
        .catch(() => setPublicStatus(null));
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const handleNativeClose = () => {
      dialog.returnValue = '';
      onClose?.();
    };
    dialog.addEventListener('close', handleNativeClose);
    return () => dialog.removeEventListener('close', handleNativeClose);
  }, [onClose]);

  async function handleSupportSubmit(e) {
    e.preventDefault();
    setSubmittingSupport(true);
    setSupportError('');
    setSupportStatus('');
    try {
      const created = await submitSupportTicket({
        category,
        summary,
        currentView,
      });
      setSummary('');
      setSupportStatus(`Reporte #${String(created?.id || '').slice(0, 8)} registrado con contexto técnico saneado.`);
    } catch (err) {
      setSupportError(err?.message || 'No se pudo enviar el reporte.');
    } finally {
      setSubmittingSupport(false);
    }
  }

  async function handleAcceptInviteSubmit(e) {
    e.preventDefault();
    setAcceptingInvite(true);
    setInviteError('');
    try {
      const session = await acceptTeamInvitation({
        token: inviteToken,
        fullName,
        password,
      });
      if (session?.recoveryKey) {
        setRecoveryKeyIssued(session.recoveryKey);
      } else {
        onInvitationAccepted?.(session);
        onClose?.();
      }
    } catch (err) {
      setInviteError(err?.message || 'No se pudo validar la invitación.');
    } finally {
      setAcceptingInvite(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-[680px] rounded-2xl bg-[#0F131B] border border-white/[0.08] text-[#F2F2F4] p-0 shadow-2xl"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
          <h2 id={titleId} className="text-sm font-semibold text-[#F2F2F4]">
            Centro de Confianza, Invitaciones y Soporte OMEGA
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Cerrar ventana"
          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] hover:bg-white/[0.06] cursor-pointer"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="px-5 pt-3 border-b border-white/[0.06] flex flex-wrap items-center gap-1.5 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('trust')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'trust'
              ? 'bg-[#2F6FED] text-white'
              : 'bg-[#141923]/75 text-[#9A9AA2] hover:text-[#F2F2F4]'
          }`}
        >
          Zero-Retention, Planes y Términos
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('invite')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'invite'
              ? 'bg-[#2F6FED] text-white'
              : 'bg-[#141923]/75 text-[#9A9AA2] hover:text-[#F2F2F4]'
          }`}
        >
          Unirme con invitación
        </button>
        {authSession && (
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'support'
                ? 'bg-[#2F6FED] text-white'
                : 'bg-[#141923]/75 text-[#9A9AA2] hover:text-[#F2F2F4]'
            }`}
          >
            Reportar un problema
          </button>
        )}
      </div>

      <div className="p-5 max-h-[75vh] overflow-y-auto space-y-5 text-xs">
        {activeTab === 'trust' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    publicStatus?.status === 'UP' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span className="font-medium text-[#F2F2F4]">
                  Estado del servicio: {publicStatus?.status === 'UP' ? 'Operativo' : 'Verificando'}
                </span>
              </div>
              <span className="font-tech text-[11px] text-emerald-400">
                {publicStatus?.zeroRetentionDefault !== false
                  ? 'Modo RAM Zero-Retention activo'
                  : 'Bóveda cifrada por tenant activa'}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#F2F2F4]">
                1. Política de Datos y Custodia Zero-Retention
              </h3>
              <p className="text-[#9A9AA2] leading-relaxed">
                Por defecto, OMEGA procesa repositorios, volcados USB e imágenes exclusivamente en memoria volátil
                (RAM / tmpfs) y destruye los artefactos temporales al concluir cada análisis. En el perfil LEGAL, solo se
                conservan fragmentos vectorizados y el sello SHA-256 probatorio (o el original cifrado en tu propia
                bóveda MinIO local si activas retención explícita). Ningún dato se utiliza para entrenar modelos externos.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#F2F2F4]">
                2. Planes y Cuotas Verificadas del Piloto
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(publicStatus?.plans || [
                  { planCode: 'PERSONAL', label: 'Personal', monthlyRepoScans: 30, maxDocumentsPerCase: 25, maxDevices: 1 },
                  { planCode: 'PRO', label: 'Pro Equipos', monthlyRepoScans: 300, maxDocumentsPerCase: 150, maxDevices: 5 },
                  { planCode: 'ENTERPRISE', label: 'Enterprise', monthlyRepoScans: 3000, maxDocumentsPerCase: 1000, maxDevices: 25 },
                ]).map((p) => (
                  <div
                    key={p.planCode}
                    className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3 space-y-1.5"
                  >
                    <div className="font-tech text-[11px] text-[#2F6FED] font-semibold">
                      {p.planCode}
                    </div>
                    <div className="text-xs font-medium text-[#F2F2F4]">{p.label}</div>
                    <ul className="text-[11px] text-[#9A9AA2] space-y-1 pt-1">
                      <li>{p.monthlyRepoScans} escaneos repo / mes</li>
                      <li>{p.maxDocumentsPerCase} docs / expediente</li>
                      <li>Hasta {p.maxDevices} equipos en flota</li>
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
              <h3 className="text-xs font-semibold text-[#F2F2F4]">
                3. Términos del Piloto y Derecho de Supresión
              </h3>
              <p className="text-[#9A9AA2] leading-relaxed">
                El cliente conserva la titularidad exclusiva de sus expedientes, repositorios y hallazgos. Las respuestas
                del asistente incluyen citas trazables pero no constituyen asesoría jurídica formal. Al finalizar el
                piloto, el administrador puede ejecutar la purga certificada del espacio con destrucción verificable en
                la cadena de auditoría SHA-256.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'invite' && (
          <div>
            {recoveryKeyIssued ? (
              <div className="space-y-3 rounded-xl bg-[#141923]/75 border border-emerald-400/30 p-4">
                <div className="text-sm font-semibold text-emerald-400">
                  Cuenta activada en el equipo
                </div>
                <p className="text-xs text-[#9A9AA2]">
                  Guarda tu llave de recuperación soberana (se muestra una sola vez):
                </p>
                <pre className="rounded-lg bg-[#0A0A0C] border border-white/[0.07] p-3 font-tech text-xs text-[#F2F2F4] select-all overflow-x-auto">
                  {recoveryKeyIssued}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryKeyIssued('');
                    onInvitationAccepted?.();
                    dialogRef.current?.close();
                  }}
                  className="rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 px-4 py-2 text-xs font-medium text-white cursor-pointer"
                >
                  Entrar al espacio de trabajo
                </button>
              </div>
            ) : (
              <form onSubmit={handleAcceptInviteSubmit} method="POST" action="/api/v1/auth/invitations/accept" className="space-y-3.5">
                <div className="space-y-1">
                  <label htmlFor="omega-invite-token" className="block text-xs font-medium text-[#F2F2F4]">
                    Código de invitación (recibido por correo o de tu administrador) *
                  </label>
                  <input
                    id="omega-invite-token"
                    name="token"
                    type="text"
                    required
                    autoFocus
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={inviteToken}
                    onChange={(e) => {
                      setInviteToken(e.target.value);
                      setInviteError('');
                    }}
                    placeholder="omega_inv_..."
                    className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.07] px-3 py-2 font-tech text-xs text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="omega-invite-fullname" className="block text-xs font-medium text-[#F2F2F4]">
                    Nombre completo (solo letras y espacios) *
                  </label>
                  <input
                    id="omega-invite-fullname"
                    name="fullName"
                    type="text"
                    required
                    minLength={2}
                    maxLength={200}
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setInviteError('');
                    }}
                    placeholder="Laura Gómez"
                    className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.07] px-3 py-2 text-xs text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="omega-invite-password" className="block text-xs font-medium text-[#F2F2F4]">
                    Define tu contraseña personal (mínimo 12 caracteres, letras y números/símbolos) *
                  </label>
                  <input
                    id="omega-invite-password"
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setInviteError('');
                    }}
                    className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.07] px-3 py-2 text-xs text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                  />
                </div>

                {inviteError && (
                  <p role="status" aria-live="polite" className="text-xs text-rose-400">
                    {inviteError}
                  </p>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={acceptingInvite}
                    className="rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white cursor-pointer"
                  >
                    {acceptingInvite ? 'Activando cuenta...' : 'Unirme al equipo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {activeTab === 'support' && authSession && (
          <form onSubmit={handleSupportSubmit} method="POST" action="/api/v1/support/report" className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-[#F2F2F4]">
                Tipo de incidencia *
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SUPPORT_CATEGORIES.map((item) => (
                  <label
                    key={item.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                      category === item.id
                        ? 'border-[#2F6FED] bg-[#2F6FED]/15 text-[#F2F2F4]'
                        : 'border-white/[0.06] bg-[#141923]/75 text-[#9A9AA2]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={item.id}
                      checked={category === item.id}
                      onChange={() => setCategory(item.id)}
                      className="accent-[#2F6FED]"
                    />
                    <span className="text-xs font-medium">{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1">
              <label htmlFor="omega-support-summary" className="block text-xs font-medium text-[#F2F2F4]">
                ¿Qué ocurrió o qué necesitas resolver? (No incluyas contraseñas ni datos confidenciales) *
              </label>
              <textarea
                id="omega-support-summary"
                name="summary"
                required
                minLength={5}
                maxLength={2000}
                rows={4}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setSupportError('');
                }}
                placeholder="Describe brevemente qué estabas haciendo y qué resultado esperabas..."
                className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.07] p-3 text-xs text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
              />
              <span className="block text-[11px] text-[#9A9AA2]">
                Se adjuntará automáticamente el perfil del espacio, vista actual ({currentView}) y modo de retención, sin enviar documentos ni código.
              </span>
            </div>

            {(supportStatus || supportError) && (
              <p
                role="status"
                aria-live="polite"
                className={`text-xs ${supportError ? 'text-rose-400' : 'text-emerald-400'}`}
              >
                {supportError || supportStatus}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submittingSupport}
                className="rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white cursor-pointer"
              >
                {submittingSupport ? 'Enviando reporte...' : 'Enviar reporte saneado'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

/**
 * Tarjeta integrada para el panel de Cuenta y Ajustes:
 * - Embudo de activación del piloto en vivo (Fase 1 & 2)
 * - Gestión de invitaciones por correo sin compartir contraseñas (Fase 3.1, solo ADMIN)
 * - Accesos directos a «Reportar un problema» y «Política Zero-Retention / Planes» (Fase 3.2 & 4)
 */
export function PilotWorkspaceCard({ authSession, currentView = 'cuenta' }) {
  const [funnel, setFunnel] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('ANALYST');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [issuedToken, setIssuedToken] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [dialogState, setDialogState] = useState({ open: false, mode: 'trust' });

  const isAdmin = String(authSession?.role || '').toUpperCase() === 'ADMIN';

  const loadPilotData = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    try {
      const [funnelData, invitesData] = await Promise.all([
        fetchPilotFunnel().catch(() => null),
        isAdmin ? fetchTeamInvitations().catch(() => []) : Promise.resolve([]),
      ]);
      if (funnelData) setFunnel(funnelData);
      if (Array.isArray(invitesData)) setInvitations(invitesData);
    } finally {
      setLoading(false);
    }
  }, [authSession, isAdmin]);

  useEffect(() => {
    void loadPilotData();
  }, [loadPilotData]);

  async function handleInviteSubmit(e) {
    e.preventDefault();
    setCreatingInvite(true);
    setError('');
    setFeedback('');
    setIssuedToken('');
    try {
      const created = await createTeamInvitation({
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail('');
      setIssuedToken(created?.inviteToken || '');
      setFeedback(
        created?.deliveryChannel === 'smtp'
          ? `Invitación enviada por correo a ${created.email}.`
          : `Código de invitación generado para ${created.email} (válido por 72 horas).`,
      );
      await loadPilotData();
    } catch (err) {
      setError(err?.message || 'No se pudo crear la invitación.');
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(id) {
    setError('');
    try {
      await revokeTeamInvitation(id);
      await loadPilotData();
    } catch (err) {
      setError(err?.message || 'No se pudo revocar la invitación.');
    }
  }

  if (!authSession) return null;

  return (
    <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-5 space-y-5">
      {/* Cabecera: Estado del Piloto + Acciones de Soporte y Confianza */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#F2F2F4]">
              Activación del piloto y equipo
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 font-tech text-[10.5px] border ${
                funnel?.activated
                  ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-400'
                  : 'border-amber-400/35 bg-amber-400/10 text-amber-400'
              }`}
            >
              {funnel?.activated ? 'Piloto activado' : 'En progreso'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#9A9AA2]">
            Hitos agregados de activación ({funnel?.profile || 'GENERAL'}) sin almacenar contenido privado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDialogState({ open: true, mode: 'support' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] px-3 py-1.5 text-xs font-medium text-[#F2F2F4] cursor-pointer"
          >
            <LifeBuoy className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
            <span>Reportar problema</span>
          </button>
          <button
            type="button"
            onClick={() => setDialogState({ open: true, mode: 'trust' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] px-3 py-1.5 text-xs font-medium text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Términos y Zero-Retention</span>
          </button>
          <button
            type="button"
            onClick={() => void loadPilotData()}
            disabled={loading}
            aria-label="Actualizar progreso del piloto"
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-white/[0.07] bg-[#141923]/75 text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Hitos de Activación (Fase 1 & 2) */}
      {funnel?.milestones && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {funnel.milestones.map((m) => (
            <div
              key={m.id}
              className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3.5 py-3 flex items-start justify-between gap-2"
            >
              <div className="space-y-1">
                <div className="text-xs font-medium text-[#F2F2F4]">{m.label}</div>
                <div className="font-tech text-[11px] text-[#9A9AA2]">
                  Progreso: {m.currentCount} / {m.targetCount}
                </div>
              </div>
              <span
                className={`h-5 w-5 rounded-full shrink-0 inline-flex items-center justify-center ${
                  m.completed
                    ? 'bg-emerald-400/15 text-emerald-400 border border-emerald-400/35'
                    : 'bg-white/[0.04] text-[#9A9AA2] border border-white/[0.08]'
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={1.75} />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Invitaciones de Equipo por Correo (Fase 3.1 - solo ADMIN) */}
      {isAdmin && (
        <div className="pt-4 border-t border-white/[0.06] space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
            <h3 className="text-xs font-semibold text-[#F2F2F4]">
              Invitar miembros al equipo sin compartir contraseñas
            </h3>
          </div>

          <form onSubmit={handleInviteSubmit} method="POST" action="/api/v1/auth/invitations" className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6 space-y-1">
                <label htmlFor="omega-team-invite-email" className="block text-xs font-medium text-[#9A9AA2]">
                  Correo del integrante *
                </label>
                <input
                  id="omega-team-invite-email"
                  name="email"
                  type="email"
                  required
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="colega@organizacion.org"
                  className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.07] px-3 py-2 text-xs text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                />
              </div>

              <fieldset className="sm:col-span-4 space-y-1">
                <legend className="text-xs font-medium text-[#9A9AA2]">Rol asignado</legend>
                <div className="flex items-center gap-1.5">
                  {ROLE_CHOICES.map((r) => (
                    <label
                      key={r.id}
                      title={r.hint}
                      className={`flex-1 text-center rounded-lg border px-2 py-2 text-xs font-medium cursor-pointer ${
                        inviteRole === r.id
                          ? 'border-[#2F6FED] bg-[#2F6FED]/15 text-[#F2F2F4]'
                          : 'border-white/[0.06] bg-[#141923]/75 text-[#9A9AA2]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.id}
                        checked={inviteRole === r.id}
                        onChange={() => setInviteRole(r.id)}
                        className="sr-only"
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={creatingInvite}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 disabled:opacity-50 px-3 py-2 text-xs font-medium text-white cursor-pointer"
                >
                  <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>{creatingInvite ? 'Creando...' : 'Invitar'}</span>
                </button>
              </div>
            </div>
          </form>

          {(feedback || error) && (
            <p
              role="status"
              aria-live="polite"
              className={`text-xs ${error ? 'text-rose-400' : 'text-emerald-400'}`}
            >
              {error || feedback}
            </p>
          )}

          {issuedToken && (
            <div className="rounded-xl bg-[#141923]/75 border border-white/[0.07] p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-[#9A9AA2]">
                  Código de invitación de un solo uso (compártelo con el integrante):
                </div>
                <div className="font-tech text-xs text-[#F2F2F4] truncate select-all mt-0.5">
                  {issuedToken}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(issuedToken);
                  setCopiedToken(true);
                  setTimeout(() => setCopiedToken(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0F131B] px-2.5 py-1.5 text-xs text-[#F2F2F4] cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                <span>{copiedToken ? 'Copiado' : 'Copiar código'}</span>
              </button>
            </div>
          )}

          {invitations.length > 0 && (
            <div className="divide-y divide-white/[0.06] text-xs">
              {invitations.slice(0, 5).map((inv) => (
                <div key={inv.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[#F2F2F4] truncate">{inv.email}</span>
                    <span className="font-tech text-[10.5px] text-[#9A9AA2]">{inv.role}</span>
                    <span
                      className={`font-tech text-[10.5px] ${
                        inv.status === 'ACCEPTED'
                          ? 'text-emerald-400'
                          : inv.status === 'PENDING'
                            ? 'text-amber-400'
                            : 'text-[#9A9AA2]'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </div>
                  {inv.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => void handleRevokeInvite(inv.id)}
                      aria-label={`Revocar invitación de ${inv.email}`}
                      className="inline-flex items-center gap-1 text-rose-400 hover:underline cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                      <span>Revocar</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <PilotTrustAndSupportDialog
        isOpen={dialogState.open}
        initialMode={dialogState.mode}
        currentView={currentView}
        authSession={authSession}
        onClose={() => setDialogState((prev) => ({ ...prev, open: false }))}
      />
    </section>
  );
}
