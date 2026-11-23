import { lazy, Suspense, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  KeyRound,
  RefreshCw,
  Settings,
  Shield,
  Upload,
  X,
} from 'lucide-react';
import { buildProfileInitials } from './AuthModulePanel';
import DossierExportButtons from './DossierExportButtons';
import { RecoveryKeyCard } from './RecoveryKeyCard';
import { SaasFleetCard } from './SaasFleetCard';
import { ApiTokensCard } from './ApiTokensCard';
import { PilotWorkspaceCard } from './PilotOpsPanel';

const SettingsPanel = lazy(() =>
  import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

function shortHash(hash) {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/**
 * Módulo unificado de Cuenta y Ajustes de OMEGA.
 * Consolida identidad, configuración del sistema, 2FA, biblioteca PDF y control de sesión.
 */
export function AccountSettingsPanel({
  authSession,
  onLogout,
  onOpenAuth,
  onPanicPurge,
  govStats = null,
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
  onAiConfigured,
  profileConfig = null,
  onSwitchProfile,
}) {
  const [mainTab, setMainTab] = useState('config');
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingProfile, setPendingProfile] = useState('');
  const [profileConfirm, setProfileConfirm] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const fileInputRef = useRef(null);

  const tenantStats = govStats?.tenant_stats || null;
  const indexedCount = privateDocs.filter((d) => d.status === 'INDEXED').length;
  const isAdmin = authSession?.role === 'ADMIN';
  const activeProfile = profileConfig?.profile || authSession?.profile || 'GENERAL';
  const nicheText =
    activeProfile === 'DEVELOPER'
      ? 'desarrollador'
      : activeProfile === 'LEGAL'
        ? 'legal'
        : 'general';
  const displayHandle = authSession?.tenantSlug
    ? `@${authSession.tenantSlug}`
    : authSession?.email || 'Cuenta activa';
  const roleLabel = authSession?.role || 'ANALYST';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mx-auto max-w-[1200px] space-y-6 pb-16">
        {/* Header de Identidad y Espacio (Banner Minimalista + Avatar Anclado) */}
        <header className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.06] overflow-hidden">
          <div
            aria-hidden="true"
            className="h-[68px] bg-[#0E1015] bg-[radial-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] [background-size:16px_16px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border-b border-white/[0.06]"
          />

          <div className="px-5 sm:px-6 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="flex items-end gap-4 min-w-0">
                <div
                  aria-label={`Avatar de ${authSession?.email || 'cuenta activa'}`}
                  className="-mt-8 relative w-16 h-16 shrink-0 inline-flex items-center justify-center rounded-full bg-[#141923] border border-white/[0.08] ring-4 ring-[#0F131B] select-none"
                >
                  <span className="font-semibold tracking-wider text-base text-zinc-100">
                    {buildProfileInitials(authSession)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[#0F131B]"
                  />
                </div>

                <div className="min-w-0 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-base font-semibold tracking-[-0.02em] text-zinc-100 truncate">
                      {displayHandle}
                    </h1>
                    <span className="bg-white/[0.05] border border-white/[0.08] text-zinc-300 text-[11px] font-medium px-2 py-0.5 rounded-md">
                      {roleLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] font-normal text-[#8A8F98] truncate">
                    {authSession?.tenantSlug ? `${authSession.email} · ` : ''}
                    {`Perfil ${nicheText}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenAuth?.('Inicia sesión con otra cuenta registrada.')}
                  className="group h-8 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] px-3 text-xs font-medium text-zinc-100 transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer"
                >
                  <KeyRound
                    className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-100 transition-colors duration-150"
                    strokeWidth={1.75}
                  />
                  <span>Cambiar cuenta</span>
                </button>

                <button
                  type="button"
                  disabled={!isDirty && !savedFeedback}
                  onClick={() => {
                    setMainTab('config');
                    setSaveTrigger((n) => n + 1);
                  }}
                  className={`h-8 inline-flex items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${isDirty || savedFeedback
                    ? 'bg-[#2F6FED] hover:bg-[#2F6FED]/90 text-white border border-transparent cursor-pointer'
                    : 'bg-white/[0.04] border border-white/[0.06] text-zinc-500 opacity-50 pointer-events-none'
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
            </div>
          </div>
        </header>

        {/* Layout Asimétrico de 2 Columnas (8 / 4) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna Principal (8/12): Configuración, Seguridad 2FA y Biblioteca */}
          <div className="lg:col-span-8 min-w-0 space-y-4">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.06] p-1">
              <button
                type="button"
                onClick={() => setMainTab('config')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${
                  mainTab === 'config'
                    ? 'bg-white/[0.08] text-zinc-100 border-white/[0.08]'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Configuración y Seguridad</span>
              </button>

              <button
                type="button"
                onClick={() => setMainTab('biblioteca')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${
                  mainTab === 'biblioteca'
                    ? 'bg-white/[0.08] text-zinc-100 border-white/[0.08]'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Biblioteca PDFs ({privateDocs.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setMainTab('respaldo')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer ${
                  mainTab === 'respaldo'
                    ? 'bg-white/[0.08] text-zinc-100 border-white/[0.08]'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Recuperación y Flota</span>
              </button>
            </div>

            {mainTab === 'config' && (
              <>
                {isAdmin && onSwitchProfile && (
                  <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-[#F2F2F4]">Perfil del espacio</h2>
                        <p className="mt-0.5 text-xs text-[#9A9AA2]">
                          Adapta módulos visibles y alcance del asistente sin borrar ni migrar datos existentes.
                        </p>
                      </div>
                      <span className="font-tech rounded-full border border-white/[0.08] bg-[#141923]/75 px-2.5 py-0.5 text-[10.5px] text-[#9A9AA2]">
                        Activo: {activeProfile}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'GENERAL', label: 'General', desc: 'Spyware, CTI y verificación estándar' },
                        { id: 'DEVELOPER', label: 'Developer', desc: 'Repositorios y cadena de suministro' },
                        { id: 'LEGAL', label: 'Legal', desc: 'Expedientes y lenguaje probatorio' },
                      ].map((opt) => {
                        const selected = (pendingProfile || activeProfile) === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setPendingProfile(opt.id);
                              setProfileConfirm(false);
                              setProfileError('');
                            }}
                            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${selected
                              ? 'border-[#2F6FED] bg-[#2F6FED]/12 text-[#F2F2F4]'
                              : 'border-white/[0.06] bg-[#141923]/75 text-[#9A9AA2] hover:text-[#F2F2F4]'
                              }`}
                          >
                            <div className="text-xs font-semibold">{opt.label}</div>
                            <div className="mt-0.5 text-[11px] text-[#8E95A5]">{opt.desc}</div>
                          </button>
                        );
                      })}
                    </div>

                    {pendingProfile && pendingProfile !== activeProfile && (
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={profileConfirm}
                          onClick={() => setProfileConfirm((v) => !v)}
                          className="inline-flex items-center gap-2 text-xs text-[#D1D5DB] cursor-pointer"
                        >
                          <span
                            className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${profileConfirm ? 'bg-[#2F6FED]' : 'bg-white/[0.12]'
                              }`}
                          >
                            <span
                              className={`h-3 w-3 rounded-full bg-white transition-transform ${profileConfirm ? 'translate-x-3' : 'translate-x-0'
                                }`}
                            />
                          </span>
                          <span>Confirmo cambiar el espacio a {pendingProfile} (queda en auditoría)</span>
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
                          className="rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                        >
                          {switchingProfile ? 'Aplicando...' : 'Aplicar perfil'}
                        </button>
                      </div>
                    )}

                    {profileError && (
                      <p className="text-xs text-rose-400">{profileError}</p>
                    )}
                  </section>
                )}

                <Suspense
                  fallback={
                    <div className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 text-xs text-[#9A9AA2]">
                      Cargando configuración del sistema...
                    </div>
                  }
                >
                  <SettingsPanel
                    embedded
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

            {mainTab === 'biblioteca' && (
              <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-5 sm:p-6 space-y-5">
                <div className="pb-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-[#F2F2F4]">
                        Biblioteca privada de PDFs
                      </h2>
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-tech text-[10.5px] text-emerald-400">
                        Zero-Retention
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#9A9AA2]">
                      Consultable desde <span className="text-[#F2F2F4]">Mis PDFs</span> en el Asistente sin guardar el archivo original.
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2F6FED]/90 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>{uploadingPdf ? 'Procesando en RAM...' : 'Subir PDF'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={loadingDocs}
                      onClick={() => onRefreshDocs?.()}
                      aria-label="Actualizar biblioteca privada"
                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-white/[0.14] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                {(docNotice || docError) && (
                  <div
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${docError
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-300'
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

                <div className="pb-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[#F2F2F4]">Exportación de expediente</div>
                    <p className="mt-0.5 text-xs text-[#9A9AA2]">
                      Descarga el informe en PDF o exporta la evidencia estructurada en JSON.
                    </p>
                  </div>
                  <DossierExportButtons expedienteId={activeExpedienteId} />
                </div>

                {privateDocs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#141923]/75 p-6 text-center space-y-2">
                    <FileText className="h-5 w-5 text-[#2F6FED] mx-auto" strokeWidth={1.75} />
                    <div className="text-sm font-medium text-[#F2F2F4]">
                      Tu biblioteca privada está vacía
                    </div>
                    <p className="text-xs text-[#9A9AA2] max-w-md mx-auto">
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
                              className={`h-2 w-2 rounded-full shrink-0 ${isIndexed
                                ? 'bg-emerald-400'
                                : isFailed
                                  ? 'bg-rose-500'
                                  : 'bg-amber-400 animate-pulse'
                                }`}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[#F2F2F4] truncate">
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

                          {isIndexed && onOpenChat && (
                            <button
                              type="button"
                              onClick={() => onOpenChat(true)}
                              className="rounded-lg border border-white/[0.07] bg-[#141923]/75 hover:border-[#2F6FED]/50 px-3 py-1.5 text-xs font-medium text-[#F2F2F4] transition-colors cursor-pointer"
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

            {mainTab === 'respaldo' && (
              <div className="space-y-4">
                <PilotWorkspaceCard authSession={authSession} currentView="cuenta-respaldo" />
                <RecoveryKeyCard />
                <ApiTokensCard authSession={authSession} />
                {isAdmin && <SaasFleetCard authSession={authSession} />}
              </div>
            )}
          </div>

          {/* Columna Lateral (4/12): Telemetría de Solo Lectura */}
          <aside className="lg:col-span-4 rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.06] p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">Actividad del espacio</h2>
                <span className="inline-flex items-center gap-1.5 font-tech text-[11px] text-[#8A8F98]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  En vivo
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3 py-2.5">
                  <div className="text-[11px] text-[#8A8F98]">Archivos eliminados</div>
                  <div className="mt-1 text-base font-semibold text-zinc-100 tabular-nums">
                    {Number(tenantStats?.zero_retention_purged_pdfs ?? indexedCount)}
                  </div>
                </div>

                <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3 py-2.5">
                  <div className="text-[11px] text-[#8A8F98]">Activos monitoreados</div>
                  <div className="mt-1 text-base font-semibold text-zinc-100 tabular-nums">
                    {Number(tenantStats?.osint_assets || 0)}
                  </div>
                </div>

                <div className="col-span-2 rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3 py-2.5 flex items-center justify-between">
                  <span className="text-[11px] text-[#8A8F98]">Sesión</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Protegida
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-[#8A8F98]">Ficha técnica</div>
              <dl className="divide-y divide-white/[0.06] text-xs">
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[#8A8F98]">Organización</dt>
                  <dd className="font-mono text-zinc-200 truncate">
                    @{authSession?.tenantSlug || 'personal'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[#8A8F98]">Modo de memoria</dt>
                  <dd className="text-zinc-200 font-medium">Cero retención en disco</dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[#8A8F98]">Llave de recuperación</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={() => setMainTab('respaldo')}
                      className="group inline-flex items-center gap-1 text-zinc-300 hover:text-white font-medium transition-colors duration-150 cursor-pointer"
                    >
                      <span>Gestionar</span>
                      <ArrowRight
                        className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5"
                        strokeWidth={1.75}
                      />
                    </button>
                  </dd>
                </div>
                {isAdmin && (
                  <div className="py-2.5 flex items-center justify-between gap-2">
                    <dt className="text-[#8A8F98]">Flota SaaS</dt>
                    <dd>
                      <button
                        type="button"
                        onClick={() => setMainTab('respaldo')}
                        className="group inline-flex items-center gap-1 text-zinc-300 hover:text-white font-medium transition-colors duration-150 cursor-pointer"
                      >
                        <span>Ver resumen</span>
                        <ArrowRight
                          className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5"
                          strokeWidth={1.75}
                        />
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
