import { useCallback, useState } from 'react';
import { FolderOpen, ArrowLeft, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { legalApi, queryCasePartyConflicts } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LegalDocumentAiPanel } from './LegalDocumentAiPanel';
import { LegalCaseEditor, LegalConflictBanner } from './LegalCaseEditor';
import { CASE_CLASSES, CASE_STATES, LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY, PROCESS_TYPES } from '../lib/legalPresentation.js';
import { LegalLoadState, LegalPagination } from './LegalWorkspacePrimitives';
import { LegalAccessPreview, LegalActivityPreview } from './LegalCasePreviewTabs';
import { LegalCaseAssistantTab } from './LegalCaseAssistantTab';
import { LegalDocumentsPanel } from './LegalDocumentsPanel';
import { LegalTimelineTab } from './LegalTimelineTab';
import { LegalObservationsTab } from './LegalObservationsTab';
import { LegalAdminIssuesPanel } from './LegalAdminIssuesPanel';
import { LegalFirmSearchPanel } from './LegalFirmSearchPanel';
import { LegalOnboardingGuide } from './LegalOnboardingGuide';
import DossierExportButtons from './DossierExportButtons';

const TABS = [['documents', 'Documentos'], ['assistant', 'Asistente'], ['timeline', 'Cronología'], ['observations', 'Pasajes y revisión'], ['access', 'Acceso'], ['activity', 'Actividad']];
const DEFAULT_FILTERS = { search: '', status: '', classification: '', order: 'updated' };

function CaseSheetSummary({ value }) {
  const entries = [
    ['Cliente', value.clientName],
    ['Contraparte', value.counterpartyName],
    ['Despacho o juzgado', value.courtName],
    ['Tipo de proceso', value.processType ? (PROCESS_TYPES[value.processType] || value.processType) : null],
    ['Etapa procesal', value.caseStage],
  ].filter(([, text]) => text);
  if (entries.length === 0) return null;
  return (
    <dl aria-label="Ficha del caso" className="grid gap-x-6 gap-y-2 border-t border-white/[0.06] pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([label, text]) => (
        <div key={label} className="min-w-0 space-y-0.5">
          <dt className="text-white/50">{label}</dt>
          <dd className="break-words text-white/85">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function CaseDetail({ id, onBack, onEdit, onDeleted, onOpenAssistant, currentUserId, role, policyAccepted, conflictGroups, onDismissConflict }) {
  const [tab, setTab] = useState('documents');
  const [confirmDeleteCase, setConfirmDeleteCase] = useState(false);
  const [deletingCase, setDeletingCase] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const load = useCallback(() => legalApi.metadata(id), [id]);
  const request = useLegalData(load);
  const canDeleteCase = ['ADMIN', 'ANALYST'].includes(role);
  async function handleDeleteCase() {
    setDeletingCase(true);
    setDeleteError('');
    try {
      await legalApi.deleteCase(id);
      onDeleted?.();
    } catch {
      setDeleteError('No se pudo eliminar el expediente. Revisa tus permisos e intenta de nuevo.');
      setDeletingCase(false);
    }
  }
  function moveTab(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const current = TABS.findIndex(([key]) => key === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next][0]); document.getElementById(`legal-tab-${TABS[next][0]}`)?.focus();
  }
  return <LegalLoadState request={request} label="Abriendo expediente…">{value => <div className="space-y-5">
    <header className="space-y-3">
      <div className="flex flex-wrap justify-between gap-3">
        <button type="button" onClick={onBack} className={`${LEGAL_SECONDARY} inline-flex items-center gap-2`}><ArrowLeft size={14} strokeWidth={1.75} />Expedientes</button>
        <div className="flex flex-wrap gap-2">
          {value.canWrite && <button type="button" className={LEGAL_SECONDARY} onClick={() => onEdit(value)}>Editar expediente</button>}
          {value.canWrite && canDeleteCase && <button type="button" className="rounded-lg border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-2 text-xs font-medium text-rose-300 cursor-pointer" onClick={() => setConfirmDeleteCase(true)}>Eliminar expediente</button>}
        </div>
      </div>
      {confirmDeleteCase && (
        <div role="alertdialog" aria-label="Confirmar supresión del expediente" className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 space-y-3 text-xs">
          <p className="text-rose-200 font-medium">Supresión irreversible en cascada</p>
          <p className="text-white/80">Se eliminarán permanentemente todos los documentos, fragmentos de texto, embeddings, eventos de cronología y permisos asociados. En auditoría solo quedarán identificadores técnicos. Si necesitas entregar constancia al cliente, exporta primero el dossier PDF/JSON.</p>
          {deleteError && <p role="alert" className="text-rose-300">{deleteError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={deletingCase} onClick={() => setConfirmDeleteCase(false)} className={LEGAL_SECONDARY}>Cancelar</button>
            <button type="button" disabled={deletingCase} onClick={() => void handleDeleteCase()} className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3.5 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50">{deletingCase ? 'Eliminando…' : 'Confirmar supresión'}</button>
          </div>
        </div>
      )}
      <h2 className="break-words text-xl font-semibold text-white">{value.title}</h2>
      <p className="text-sm text-white/60">{CASE_STATES[value.status]} · {CASE_CLASSES[value.classification]}{value.reference ? ` · ${value.reference}` : ''}</p>
      {value.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{value.description}</p>}
      <CaseSheetSummary value={value} />
      <LegalConflictBanner groups={conflictGroups} onDismiss={onDismissConflict} />
      <div className="pt-1">
        <DossierExportButtons expedienteId={value.id} profile="LEGAL" />
      </div>
    </header>
    <div className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-5 backdrop-blur-md">
      <div role="tablist" aria-label="Secciones del expediente" onKeyDown={moveTab} className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-2">{TABS.map(([key, label]) => <button key={key} id={`legal-tab-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`legal-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white ${tab === key ? 'border-b-2 border-[#2F6FED] text-white' : 'text-white/60 hover:text-white'}`}>{label}</button>)}</div>
      <section role="tabpanel" id={`legal-panel-${tab}`} aria-labelledby={`legal-tab-${tab}`} tabIndex={0} className="pt-4 focus-visible:outline-2 focus-visible:outline-white">
        {tab === 'documents' && <LegalDocumentsPanel key={value.id} value={value} role={role} policyAccepted={policyAccepted} />}
        {tab === 'assistant' && <LegalCaseAssistantTab key={value.id} value={value} policyAccepted={policyAccepted} />}
        {tab === 'timeline' && <LegalTimelineTab key={value.id} value={value} role={role} policyAccepted={policyAccepted} />}
        {tab === 'observations' && <LegalObservationsTab key={value.id} value={value} policyAccepted={policyAccepted} />}
        {tab === 'access' && <LegalAccessPreview key={value.id} value={value} />}
        {tab === 'activity' && <LegalActivityPreview key={value.id} value={value} currentUserId={currentUserId} />}
      </section>
    </div>
  </div>}</LegalLoadState>;
}

export function ExpedientesPanel({ authSession, onOpenAssistant }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const [editor, setEditor] = useState(null);
  const [savedConflict, setSavedConflict] = useState({ caseId: '', groups: [] });
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const load = useCallback(() => legalApi.cases({ ...filters, page, size: 20 }), [filters, page]);
  const request = useLegalData(load);
  const canCreate = ['ADMIN', 'ANALYST'].includes(authSession?.role);
  const hasFilters = Boolean(filters.search.trim() || filters.status || filters.classification);
  const change = event => { setFilters(previous => ({ ...previous, [event.target.name]: event.target.value })); setPage(0); };
  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(0);
  }
  async function save(draft) {
    const saved = editor.value ? await legalApi.update(editor.value.id, draft) : await legalApi.create(draft);
    const groups = await queryCasePartyConflicts(draft, saved.id);
    setSavedConflict({ caseId: saved.id, groups });
    setSelected(saved.id); setDetailRevision(value => value + 1); setEditor(null); request.reload();
  }
  async function createDemoCase() {
    if (!canCreate || creatingDemo) return;
    setCreatingDemo(true);
    try {
      const demo = await legalApi.create({
        title: '[DEMO FICTICIA] Arrendamiento comercial sintético',
        classification: 'INTERNAL',
        reference: 'DEMO-SINTETICA-001',
        status: 'OPEN',
        description: 'Expediente de demostración creado con datos 100% ficticios para explorar el flujo de documentos, cronología, asistente con citas y exportación de dossier. Puedes eliminarlo en cualquier momento.',
      });
      setSelected(demo.id);
      request.reload();
    } finally {
      setCreatingDemo(false);
    }
  }
  return <section aria-labelledby="expedientes-title" className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
    <div inert={editor ? true : undefined} className="mx-auto w-full max-w-[1120px] space-y-5 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="expedientes-title" className="text-3xl font-semibold tracking-tight text-white">Expedientes</h1>
          {!selected && <p className="mt-1.5 text-sm text-zinc-400">Abre un caso para consultar sus documentos y seguir su actividad.</p>}
        </div>
        {!selected && canCreate && (
          <button type="button" onClick={() => setEditor({ value: null })} className={`${LEGAL_PRIMARY} group inline-flex min-h-11 items-center gap-2 hover:brightness-110 motion-safe:transition motion-safe:active:scale-[0.98]`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:-translate-y-0.5">
              <path d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            Nuevo expediente
          </button>
        )}
      </header>
      <LegalDocumentAiPanel onPolicyChange={setPolicyAccepted} />
      {selected ? <CaseDetail key={`${selected}:${detailRevision}`} id={selected} onBack={() => setSelected('')} onEdit={value => setEditor({ value })} onDeleted={() => { setSelected(''); setSavedConflict({ caseId: '', groups: [] }); request.reload(); }} onOpenAssistant={onOpenAssistant} currentUserId={authSession?.userId} role={authSession?.role} policyAccepted={policyAccepted} conflictGroups={savedConflict.caseId === selected ? savedConflict.groups : []} onDismissConflict={() => setSavedConflict({ caseId: '', groups: [] })} /> : <>
        <section aria-label="Lista de expedientes" className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 backdrop-blur-md">
          <div className="space-y-2 border-b border-white/[0.06] p-4 sm:px-5">
            <label className="group relative block">
              <span className="sr-only">Buscar expediente por título o radicado</span>
              <Search size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-white" />
              <input type="search" name="search" value={filters.search} onChange={change} maxLength={120} placeholder="Busca un expediente por título o radicado" className={`${LEGAL_INPUT} min-h-11 pl-10`} />
            </label>
            <details className="group">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm text-zinc-300 hover:text-white focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0">
                  <path d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
                </svg>
                Filtros y orden
                {(filters.status || filters.classification) && <span className="text-xs text-zinc-400">· Filtros activos</span>}
                <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="group-open:rotate-180 motion-safe:transition-transform" />
              </summary>
              <div className="grid gap-3 pb-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm text-zinc-300">Estado<select name="status" value={filters.status} onChange={change} className={LEGAL_INPUT}><option value="">Todos los estados</option>{Object.entries(CASE_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="space-y-1 text-sm text-zinc-300">Clasificación<select name="classification" value={filters.classification} onChange={change} className={LEGAL_INPUT}><option value="">Todas las clasificaciones</option>{Object.entries(CASE_CLASSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="space-y-1 text-sm text-zinc-300">Orden<select name="order" value={filters.order} onChange={change} className={LEGAL_INPUT}><option value="updated">Actualizados recientemente</option><option value="created">Más recientes</option><option value="title">Título</option></select></label>
              </div>
            </details>
            <details className="group">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm text-zinc-300 hover:text-white focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0">
                  <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
                Buscar dentro de los documentos
                <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="group-open:rotate-180 motion-safe:transition-transform" />
              </summary>
              <div className="pb-2 pt-1"><LegalFirmSearchPanel onOpenCase={setSelected} /></div>
            </details>
          </div>
          <div className="px-2 sm:px-3">
            <LegalLoadState request={request} label="Cargando expedientes…">{data => <>
              {data.content.length === 0 ? (
                <div className="space-y-2 px-3 py-8">
                  <h2 className="text-base font-medium text-white">{hasFilters ? 'No encontramos expedientes con esta búsqueda' : 'No hay expedientes para mostrar'}</h2>
                  <p className="text-sm text-zinc-400">{hasFilters ? 'Prueba otro título o radicado, o restablece los filtros.' : canCreate ? 'Crea un caso con Nuevo expediente o explora uno con datos ficticios.' : 'Pide al propietario que revise tu acceso.'}</p>
                  {hasFilters ? <button type="button" onClick={clearFilters} className={LEGAL_SECONDARY}>Restablecer búsqueda y filtros</button>
                    : canCreate && <button type="button" disabled={creatingDemo} onClick={() => void createDemoCase()} className={LEGAL_SECONDARY}>{creatingDemo ? 'Creando demo…' : 'Probar un expediente de ejemplo'}</button>}
                </div>
              ) : (
                <ul aria-label="Expedientes disponibles" className="divide-y divide-white/[0.06]">
                  {data.content.map(item => <li key={item.id}>
                    <button type="button" onClick={() => setSelected(item.id)} aria-label={`Abrir expediente ${item.title}`} className="group flex min-h-[76px] w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-white sm:gap-4">
                      <FolderOpen size={17} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1 break-words font-medium text-white">
                        {item.title}
                        <span className="mt-1 block text-xs font-normal text-zinc-400">{[item.reference, CASE_CLASSES[item.classification]].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="rounded-full border border-white/[0.05] bg-[#141923]/75 px-2.5 py-1 text-xs text-zinc-300">{CASE_STATES[item.status]}</span>
                      <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400 group-hover:text-white group-focus-visible:text-white motion-safe:transition motion-safe:group-hover:translate-x-0.5 motion-safe:group-focus-visible:translate-x-0.5" />
                    </button>
                  </li>)}
                </ul>
              )}
              {data.totalPages > 1 && <div className="border-t border-white/[0.06] px-3"><LegalPagination value={data} onPage={setPage} label="Páginas de expedientes" /></div>}
            </>}</LegalLoadState>
          </div>
        </section>
        <LegalOnboardingGuide />
        <LegalAdminIssuesPanel role={authSession?.role} />
      </>}
      <p role="note" className="text-xs text-zinc-400">El asistente no ofrece asesoría legal. Verifica la información con un profesional.</p>
    </div>
    {editor && <LegalCaseEditor value={editor.value} onClose={() => setEditor(null)} onSave={save} />}
  </section>;
}
