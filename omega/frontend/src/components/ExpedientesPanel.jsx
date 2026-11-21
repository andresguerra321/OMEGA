import { useCallback, useState } from 'react';
import { FolderOpen, Plus, ArrowLeft } from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LegalDocumentAiPanel } from './LegalDocumentAiPanel';
import { LegalCaseEditor } from './LegalCaseEditor';
import { CASE_CLASSES, CASE_STATES, LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY, LegalLoadState, LegalPagination } from './LegalWorkspacePrimitives';
import { LegalDocumentsPreview, LegalAccessPreview, LegalActivityPreview, LegalAssistantPreview } from './LegalCasePreviewTabs';

const TABS = [['documents', 'Documentos'], ['assistant', 'Asistente'], ['access', 'Acceso'], ['activity', 'Actividad']];

function CaseDetail({ id, onBack, onEdit, onOpenAssistant, currentUserId }) {
  const [tab, setTab] = useState('documents');
  const load = useCallback(() => legalApi.metadata(id), [id]);
  const request = useLegalData(load);
  function moveTab(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const current = TABS.findIndex(([key]) => key === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next][0]); document.getElementById(`legal-tab-${TABS[next][0]}`)?.focus();
  }
  return <LegalLoadState request={request} label="Abriendo expediente…">{value => <div className="space-y-5">
    <header className="space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={onBack} className={`${LEGAL_SECONDARY} inline-flex items-center gap-2`}><ArrowLeft size={14} strokeWidth={1.75} />Expedientes</button>{value.canWrite && <button type="button" className={LEGAL_SECONDARY} onClick={() => onEdit(value)}>Editar expediente</button>}</div>
      <h2 className="break-words text-xl font-semibold text-white">{value.title}</h2>
      <p className="text-sm text-white/60">{CASE_STATES[value.status]} · {CASE_CLASSES[value.classification]}{value.reference ? ` · ${value.reference}` : ''}</p>
      {value.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{value.description}</p>}
    </header>
    <div className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-5 backdrop-blur-md">
      <div role="tablist" aria-label="Secciones del expediente" onKeyDown={moveTab} className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-2">{TABS.map(([key, label]) => <button key={key} id={`legal-tab-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`legal-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white ${tab === key ? 'border-b-2 border-[#2F6FED] text-white' : 'text-white/60 hover:text-white'}`}>{label}</button>)}</div>
      <section role="tabpanel" id={`legal-panel-${tab}`} aria-labelledby={`legal-tab-${tab}`} tabIndex={0} className="pt-4 focus-visible:outline-2 focus-visible:outline-white">
        {tab === 'documents' && <LegalDocumentsPreview key={value.id} value={value} />}
        {tab === 'assistant' && <LegalAssistantPreview value={value} onOpenAssistant={onOpenAssistant} />}
        {tab === 'access' && <LegalAccessPreview key={value.id} value={value} />}
        {tab === 'activity' && <LegalActivityPreview key={value.id} value={value} currentUserId={currentUserId} />}
      </section>
    </div>
  </div>}</LegalLoadState>;
}

export function ExpedientesPanel({ authSession, onOpenAssistant }) {
  const [filters, setFilters] = useState({ search: '', status: '', classification: '', order: 'updated' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const [editor, setEditor] = useState(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const load = useCallback(() => legalApi.cases({ ...filters, page, size: 20 }), [filters, page]);
  const request = useLegalData(load);
  const canCreate = ['ADMIN', 'ANALYST'].includes(authSession?.role);
  const change = event => { setFilters(previous => ({ ...previous, [event.target.name]: event.target.value })); setPage(0); };
  async function save(draft) {
    const saved = editor.value ? await legalApi.update(editor.value.id, draft) : await legalApi.create(draft);
    setSelected(saved.id); setDetailRevision(value => value + 1); setEditor(null); request.reload();
  }
  return <section aria-labelledby="expedientes-title" className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
    <div inert={editor ? true : undefined} className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2"><h1 id="expedientes-title" className="flex items-center gap-2 text-xl font-semibold text-white"><FolderOpen aria-hidden="true" size={16} strokeWidth={1.75} />Expedientes</h1><p className="text-sm text-white/60">Tus casos, documentos y acceso del despacho.</p></div>
        {!selected && canCreate && <button type="button" onClick={() => setEditor({ value: null })} className={`${policyAccepted ? LEGAL_PRIMARY : LEGAL_SECONDARY} inline-flex items-center gap-2`}><Plus size={14} strokeWidth={1.75} />Nuevo expediente</button>}
      </header>
      <p role="note" className="text-xs text-white/60">El asistente no ofrece asesoría legal. Verifica la información con un profesional.</p>
      <LegalDocumentAiPanel onPolicyChange={setPolicyAccepted} />
      {selected ? <CaseDetail key={`${selected}:${detailRevision}`} id={selected} onBack={() => setSelected('')} onEdit={value => setEditor({ value })} onOpenAssistant={onOpenAssistant} currentUserId={authSession?.userId} /> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-white/60">Buscar<input name="search" value={filters.search} onChange={change} maxLength={120} placeholder="Título o referencia" className={LEGAL_INPUT} /></label>
          <label className="space-y-1 text-xs text-white/60">Estado<select name="status" value={filters.status} onChange={change} className={LEGAL_INPUT}><option value="">Todos los estados</option>{Object.entries(CASE_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="space-y-1 text-xs text-white/60">Clasificación<select name="classification" value={filters.classification} onChange={change} className={LEGAL_INPUT}><option value="">Todas las clasificaciones</option>{Object.entries(CASE_CLASSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="space-y-1 text-xs text-white/60">Orden<select name="order" value={filters.order} onChange={change} className={LEGAL_INPUT}><option value="updated">Actualizados recientemente</option><option value="created">Más recientes</option><option value="title">Título</option></select></label>
        </div>
        <LegalLoadState request={request} label="Cargando expedientes…">{data => <div className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 px-5 backdrop-blur-md">
          {data.content.length === 0 ? <div className="space-y-2 py-6"><h2 className="font-medium text-white">No hay expedientes para mostrar</h2><p className="text-sm text-white/60">{canCreate ? 'Crea tu primer expediente o cambia los filtros de búsqueda.' : 'Cambia los filtros o pide al propietario que revise tu acceso.'}</p></div> : <ul aria-label="Expedientes disponibles" className="divide-y divide-white/[0.06]">{data.content.map(item => <li key={item.id}><button type="button" onClick={() => setSelected(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg py-4 text-left focus-visible:outline-2 focus-visible:outline-white hover:bg-white/[0.02]" aria-label={`Abrir expediente ${item.title}`}><span className="min-w-0 break-words font-medium text-white">{item.title}<span className="mt-1 block text-xs font-normal text-white/55">{item.reference || 'Sin referencia'} · {CASE_CLASSES[item.classification]}</span></span><span className="rounded-full border border-white/[0.05] bg-[#141923]/75 px-2.5 py-1 text-xs text-white/60">{CASE_STATES[item.status]}</span></button></li>)}</ul>}
          <LegalPagination value={data} onPage={setPage} label="Páginas de expedientes" />
        </div>}</LegalLoadState>
      </>}
    </div>
    {editor && <LegalCaseEditor value={editor.value} onClose={() => setEditor(null)} onSave={save} />}
  </section>;
}