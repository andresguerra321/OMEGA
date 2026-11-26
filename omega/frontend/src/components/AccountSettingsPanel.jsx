import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  KeyRound,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { buildProfileInitials } from './AuthModulePanel';
import DossierExportButtons from './DossierExportButtons';
import { RecoveryKeyCard } from './RecoveryKeyCard';
import { GoogleAccountLink } from './GoogleAccountLink';
import { SaasFleetCard } from './SaasFleetCard';
import { ApiTokensCard } from './ApiTokensCard';
import { BillingPanel } from './BillingPanel';
import { ProfessionalReportsPanel } from './ProfessionalReportsPanel';
import { CommercialBillingPanel } from './CommercialBillingPanel';
import { resolveProfileLabel, WORKSPACE_PROFILES } from '../lib/useTenantProfileConfig.js';
import { PilotWorkspaceCard } from './PilotOpsPanel';

const SettingsPanel = lazy(() =>
  import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

const SIDEBAR_GROUPS = [
  {
    title: 'General',
    items: [
      { id: 'cuenta', label: 'Mi perfil y sesión' },
      { id: 'plan', label: 'Mi plan y créditos' },
      { id: 'informes', label: 'Informes' },
      { id: 'comercial', label: 'Documentos y facturación' },
      { id: 'permisos', label: 'Permisos y ética' },
    ],
  },
  {
    title: 'Inteligencia',
    items: [
      { id: 'ia', label: 'Motor de IA' },
      { id: 'rag', label: 'Motor RAG' },
      { id: 'corpus', label: 'Corpus indexado' },
    ],
  },
  {
    title: 'Datos',
    items: [
      { id: 'biblioteca', label: 'Biblioteca PDFs' },
      { id: 'respaldo', label: 'Recuperación y Flota' },
    ],
  },
];

const SETTINGS_SECTION_IDS = new Set(['cuenta', 'permisos', 'ia', 'rag', 'corpus']);
const ACCOUNT_TYPE_LABELS = { INDIVIDUAL: 'Cuenta personal', ORGANIZATION: 'Organización' };
const ROLE_LABELS = { ADMIN: 'Administrador', ANALYST: 'Analista', CLIENT: 'Cliente' };

function shortHash(hash) {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/**
 * Módulo unificado de Cuenta y Ajustes de OMEGA.
 * Shell de 2 columnas (navegación lateral izquierda + canvas abierto #09090B).
 */
export function AccountSettingsPanel({
  authSession,
  onLogout,
  onOpenAuth,
  onPanicPurge,
  privateDocs = [],
  activeExpedienteId = '',
  loadingDocs = false,
  uploadingPdf = false,
  docNotice = '',
  docError = '',
  onDismissDocBanner,
  onUploadPdf,
  onRefreshDocs,
  onOpenChat,
  topK = 6,
  onChangeTopK,
  sourceScope = 'Todas las fuentes',
  onChangeSourceScope,
  initialSection = '',
  initialSectionKey = 0,
  billingReason = '',
  onDismissBillingReason,
  onAiConfigured,
  profileConfig = null,
  onSwitchProfile,
}) {
  const [activeNav, setActiveNav] = useState(() =>
    initialSection && (SETTINGS_SECTION_IDS.has(initialSection) || initialSection === 'biblioteca' || initialSection === 'respaldo' || ['plan', 'informes', 'comercial'].includes(initialSection))
      ? initialSection
      : 'cuenta',
  );
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingProfile, setPendingProfile] = useState('');
  const [profileConfirm, setProfileConfirm] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!initialSection) return;
    if (SETTINGS_SECTION_IDS.has(initialSection) || initialSection === 'biblioteca' || initialSection === 'respaldo' || ['plan', 'informes', 'comercial'].includes(initialSection)) {
      setActiveNav(initialSection);
    }
  }, [initialSection, initialSectionKey]);

  const isAdmin = authSession?.role === 'ADMIN' && authSession?.accountType !== 'INDIVIDUAL';
  const canManage = authSession?.canManageAccount || isAdmin;
  const activeProfile = profileConfig?.profile || authSession?.profile || 'GENERAL';
  const profileLabel = resolveProfileLabel(activeProfile);
  const displayHandle = authSession?.tenantSlug
    ? `Espacio @${authSession.tenantSlug}`
    : authSession?.email || 'Mi cuenta';
  const accountTypeLabel = ACCOUNT_TYPE_LABELS[authSession?.accountType];
  const roleLabel = authSession?.accountType === 'ORGANIZATION' ? ROLE_LABELS[authSession.role] : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-transparent px-3 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div className="w-full max-w-[1440px] 2xl:max-w-[1560px] mx-auto pb-16">
          {/* Contenedor Glass unificado y responsive (Sidebar izquierda + Contenido derecha) */}
          <div className="motion-safe:animate-fade-up rounded-2xl bg-[#0D1119]/62 backdrop-blur-xl border border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.08)] overflow-hidden grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[248px_1fr]">
            {/* Columna izquierda: Navegación lateral dentro del bloque glass */}
            <aside className="border-b md:border-b-0 md:border-r border-white/[0.06] bg-black/20 p-4 sm:p-5 lg:p-6 flex flex-col justify-between gap-6">
              <div className="space-y-5">
                <div className="px-2.5 space-y-1">
                  <div className="text-[13.5px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                    Configuración
                  </div>
                  <div className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-zinc-400">
                    <span className="h-[5px] w-[5px] rounded-full bg-emerald-400 motion-safe:animate-pulse" />
                    <span>Zero-Retention</span>
                  </div>
                </div>

                {SIDEBAR_GROUPS.map((group) => (
                  <div key={group.title} className="space-y-1">
                    <div className="px-2.5 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                      {group.title}
                    </div>
                    <nav aria-label={group.title} className="flex flex-wrap md:flex-nowrap md:flex-col gap-1 md:gap-0.5 pb-1 md:pb-0">
                      {group.items.map((item) => {
                        const isActive = activeNav === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveNav(item.id)}
                            className={`md:w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-left shrink-0 transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${isActive
                              ? 'bg-white/[0.07] text-[#EDEDEF] font-medium'
                              : 'text-[#7E8691] hover:text-zinc-200 hover:bg-white/[0.03]'
                              }`}
                          >
                            <span className="whitespace-nowrap">{item.label}</span>
                            {item.id === 'biblioteca' && (
                              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                                {privateDocs.length}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                ))}
              </div>

              {/* Acción global de guardado accesible desde cualquier pestaña */}
              <div className="pt-4 border-t border-white/[0.06] hidden md:block">
                <button
                  type="button"
                  disabled={!isDirty && !savedFeedback}
                  onClick={() => {
                    if (!SETTINGS_SECTION_IDS.has(activeNav)) setActiveNav('rag');
                    setSaveTrigger((n) => n + 1);
                  }}
                  className={`w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${isDirty || savedFeedback
                    ? 'bg-[#EDEDEF] hover:bg-white text-[#09090B] cursor-pointer'
                    : 'bg-white/[0.03] border border-white/[0.06] text-zinc-500 opacity-55 pointer-events-none'
                    }`}
                >
                  {savedFeedback ? (
                    <>
                      <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>Guardado</span>
                    </>
                  ) : (
                    <span>Guardar cambios</span>
                  )}
                </button>
              </div>
            </aside>

            {/* Columna derecha: Contenido principal dentro del bloque glass */}
            <div key={activeNav} className="min-w-0 p-4 sm:p-6 lg:p-8 motion-safe:animate-fade-up">
              {/* Banner con efecto logo OMEGA AI detrás de la info de la cuenta */}
              {activeNav === 'cuenta' && (
                <header className="relative mb-6 rounded-xl bg-[#0B0F18]/85 border border-white/[0.1] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_24px_rgba(47,111,237,0.18)] px-4 sm:px-5 py-4">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_68%_135%_at_50%_130%,rgba(47,111,237,0.48),rgba(47,111,237,0.14)_46%,transparent_76%)]"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:16px_16px]"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-16 h-16 text-[#F8FAFC] opacity-[0.07]"
                  >
                    <path
                      d="M5 18.5H9.2V16.2C7.4 14.9 6.3 12.9 6.3 10.6C6.3 7.3 8.85 4.8 12 4.8C15.15 4.8 17.7 7.3 17.7 10.6C17.7 12.9 16.6 14.9 14.8 16.2V18.5H19"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        aria-label={`Avatar de ${authSession?.email || 'cuenta activa'}`}
                        className="relative w-12 h-12 shrink-0 inline-flex items-center justify-center rounded-full bg-[#0F131B]/90 border border-white/[0.14] overflow-hidden select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_16px_rgba(47,111,237,0.22)]"
                      >
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(47,111,237,0.45),transparent_72%)]"
                        />
                        <span className="relative z-10 font-semibold tracking-wider text-xs text-[#F8FAFC]">
                          {buildProfileInitials(authSession)}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF] truncate">
                            {displayHandle}
                          </h1>
                          {accountTypeLabel && <span className="text-xs text-zinc-300">{accountTypeLabel}</span>}
                        </div>
                        {authSession?.tenantSlug && <p className="mt-0.5 truncate text-xs text-zinc-400">{authSession.email}</p>}
                        <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-300">
                          <span>Perfil activo <strong className="font-medium text-white">{profileLabel}</strong></span>
                          {roleLabel && <span>Permisos en el equipo <strong className="font-medium text-white">{roleLabel}</strong></span>}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenAuth?.('Inicia sesión con otra cuenta registrada.')}
                        className="h-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] hover:border-white/[0.22] bg-[#0B0F18]/70 hover:bg-[#0B0F18]/90 px-3 text-xs font-medium text-zinc-200 hover:text-[#EDEDEF] transition-colors cursor-pointer"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-zinc-400" strokeWidth={1.75} />
                        <span>Cambiar cuenta</span>
                      </button>
                    </div>
                  </div>
                </header>
              )}

              {/* Botón Guardar cambios en móvil cuando haya cambios pendientes */}
              {(isDirty || savedFeedback) && (
                <div className="mb-4 flex justify-end md:hidden">
                  <button
                    type="button"
                    onClick={() => {
                      if (!SETTINGS_SECTION_IDS.has(activeNav)) setActiveNav('rag');
                      setSaveTrigger((n) => n + 1);
                    }}
                    className="h-8 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white px-3.5 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
                  >
                    {savedFeedback ? (
                      <>
                        <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>Guardado</span>
                      </>
                    ) : (
                      <span>Guardar cambios</span>
                    )}
                  </button>
                </div>
              )}
            {activeNav === 'plan' && <BillingPanel key={authSession?.tenantId} authSession={authSession} billingReason={billingReason} onDismissBillingReason={onDismissBillingReason} onOpenProfiles={canManage && onSwitchProfile ? () => setActiveNav('cuenta') : undefined} />}
            {activeNav === 'informes' && <ProfessionalReportsPanel profile={activeProfile} activeExpedienteId={activeExpedienteId} />}
            {activeNav === 'comercial' && <CommercialBillingPanel canManage={canManage} />}
            {activeNav === 'cuenta' && authSession && <div className="mb-6"><GoogleAccountLink /></div>}
              {SETTINGS_SECTION_IDS.has(activeNav) && (
                <>
                  {activeNav === 'cuenta' && canManage && onSwitchProfile && (
                    <section className="border-t border-white/[0.06] py-6 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                            Cambia tu perfil de trabajo
                          </h2>
                          <p className="mt-0.5 text-[12.5px] text-[#7E8691]">
                            Elige las herramientas que necesitas en este espacio.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {WORKSPACE_PROFILES.map((opt) => {
                          const selected = (pendingProfile || activeProfile) === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setPendingProfile(opt.id);
                                setProfileConfirm(false);
                                setProfileError('');
                              }}
                              className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${selected
                                ? 'border-[#2F6FED] bg-[#141923]/75 text-white'
                                : 'border-white/[0.07] bg-[#141923]/75 text-zinc-200 hover:border-white/[0.16]'
                                }`}
                            >
                              <div className="text-[13px] font-medium">{opt.label}{activeProfile === opt.id && <span className="ml-2 text-xs text-zinc-400"> Activo</span>}</div>
                              <div className="mt-1 text-xs text-zinc-300">{opt.description}</div>
                              {opt.plan && <div className="mt-1 text-xs text-zinc-400">Requiere {opt.plan}</div>}
                            </button>
                          );
                        })}
                      </div>

                      {pendingProfile && pendingProfile !== activeProfile && (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={profileConfirm}
                            onClick={() => setProfileConfirm((v) => !v)}
                            className="inline-flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer"
                          >
                            <span
                              className={`inline-flex h-[20px] w-9 items-center rounded-full p-0.5 transition-colors ${profileConfirm ? 'bg-[#EDEDEF]' : 'bg-white/[0.12]'
                                }`}
                            >
                              <span
                                className={`h-4 w-4 rounded-full transition-transform ${profileConfirm ? 'translate-x-4 bg-[#09090B]' : 'translate-x-0 bg-zinc-300'
                                  }`}
                              />
                            </span>
                            <span>Confirmo cambiar el perfil a {resolveProfileLabel(pendingProfile)}</span>
                          </button>

                          <button
                            type="button"
                            disabled={!profileConfirm || switchingProfile}
                            onClick={async () => {
                              setSwitchingProfile(true);
                              setProfileError('');
                              try {
                                await onSwitchProfile(pendingProfile, true);
                                setPendingProfile('');
                                setProfileConfirm(false);
                              } catch (err) {
                                setProfileError(err?.message || 'No se pudo cambiar el perfil del espacio.');
                              } finally {
                                setSwitchingProfile(false);
                              }
                            }}
                            className="h-8 rounded-md bg-[#EDEDEF] hover:bg-white disabled:opacity-45 disabled:cursor-not-allowed px-3 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
                          >
                            {switchingProfile ? 'Aplicando...' : 'Aplicar perfil'}
                          </button>
                        </div>
                      )}

                      {profileError && (
                        <p role="alert" className="text-sm text-rose-400">{profileError}</p>
                      )}
                    </section>
                  )}
                  <Suspense
                    fallback={
                      <div className="py-6 text-xs text-[#7E8691]">
                        Cargando configuración del sistema...
                      </div>
                    }
                  >
                    <SettingsPanel
                      embedded
                      activeSectionOverride={activeNav}
                      topK={topK}
                      onChangeTopK={onChangeTopK}
                      sourceScope={sourceScope}
                      onChangeSourceScope={onChangeSourceScope}
                      authSession={authSession}
                      onOpenAuth={onOpenAuth}
                      onLogout={onLogout}
                      onPanicPurge={onPanicPurge}
                      initialSection={initialSection}
                      initialSectionKey={initialSectionKey}
                      onAiConfigured={onAiConfigured}
                      saveTrigger={saveTrigger}
                      onSavedFeedback={setSavedFeedback}
                      onDirtyChange={setIsDirty}
                    />
                  </Suspense>
                </>
              )}

              {activeNav === 'biblioteca' && (
                <section className="space-y-6">
                  <div className="pb-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-[15px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                        Biblioteca privada de PDFs
                      </h2>
                      <p className="mt-0.5 text-[13px] text-[#7E8691]">
                        Consultable desde <span className="text-zinc-200">Mis PDFs</span> en el Asistente sin guardar el archivo original.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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
                        className="h-8 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white disabled:opacity-45 px-3 text-xs font-medium text-[#09090B] transition-colors cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>{uploadingPdf ? 'Procesando en RAM...' : 'Subir PDF'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={loadingDocs}
                        onClick={() => onRefreshDocs?.()}
                        aria-label="Actualizar biblioteca privada"
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] text-zinc-400 hover:text-[#EDEDEF] transition-colors cursor-pointer"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  {(docNotice || docError) && (
                    <div
                      className={`flex items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 text-xs ${docError
                        ? 'border-[#E5484D]/35 bg-[#E5484D]/10 text-[#FFB4AE]'
                        : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
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
                          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="pb-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-medium text-[#EDEDEF]">Exportación de expediente</div>
                      <p className="mt-0.5 text-xs text-[#7E8691]">
                        Descarga el informe en PDF o exporta la evidencia estructurada en JSON.
                      </p>
                    </div>
                    <DossierExportButtons expedienteId={activeExpedienteId} profile={activeProfile} />
                  </div>

                  {privateDocs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.015] py-8 px-6 text-center space-y-1.5">
                      <FileText className="h-[18px] w-[18px] text-zinc-400 mx-auto" strokeWidth={1.75} />
                      <div className="text-[13px] font-medium text-[#EDEDEF]">
                        Tu biblioteca privada está vacía
                      </div>
                      <p className="text-xs text-[#7E8691] max-w-md mx-auto">
                        Adjunta informes técnicos o peritajes en PDF para citarlos por página en el chat con cero retención del archivo fuente.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {privateDocs.map((doc) => {
                        const isIndexed = doc.status === 'INDEXED';
                        const isFailed = doc.status === 'FAILED';
                        return (
                          <div
                            key={doc.id}
                            className="py-3 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className={`h-1.5 w-1.5 rounded-full shrink-0 ${isIndexed
                                  ? 'bg-emerald-400'
                                  : isFailed
                                    ? 'bg-[#E5484D]'
                                    : 'bg-amber-400 animate-pulse'
                                  }`}
                              />
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-[#EDEDEF] truncate">
                                  {doc.originalFilename}
                                </div>
                                <div className="font-mono text-[11px] text-[#7E8691] flex flex-wrap items-center gap-2 mt-0.5">
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

                            {isIndexed && onOpenChat && (
                              <button
                                type="button"
                                onClick={() => onOpenChat(true)}
                                className="h-7 rounded-md border border-white/[0.08] hover:border-white/[0.18] bg-white/[0.02] hover:bg-white/[0.05] px-2.5 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
                              >
                                Consultar en chat
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {activeNav === 'respaldo' && (
                <div className="space-y-6">
                  <PilotWorkspaceCard authSession={authSession} currentView="cuenta-respaldo" />
                  <RecoveryKeyCard />
                  {activeProfile === 'DEVELOPER' && <ApiTokensCard authSession={authSession} />}
                  {canManage && <SaasFleetCard authSession={authSession} mode="fleet" />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      );
}
