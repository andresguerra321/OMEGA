import { useEffect, useState } from 'react';
import { Download, FileJson, FileText, ShieldCheck } from 'lucide-react';
import {
  exportDevReportJson,
  exportDevReportPdf,
  listDevProjects,
} from '../lib/api';
import { OmegaSelect } from './OmegaSelect';

export function DevReportsTab() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  async function loadReport(targetProjectId = projectId) {
    setLoading(true);
    setError('');
    try {
      const [projList, repData] = await Promise.all([
        projects.length ? Promise.resolve(projects) : listDevProjects(),
        exportDevReportJson(targetProjectId),
      ]);
      if (!projects.length) {
        setProjects(Array.isArray(projList) ? projList : []);
      }
      setReport(repData || null);
    } catch (err) {
      setError(err?.message || 'No se pudo generar la vista previa del reporte.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport(projectId);
  }, [projectId]);

  async function handleDownloadJson() {
    setExporting('json');
    setError('');
    try {
      const data = await exportDevReportJson(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = projectId ? `omega-dev-report-${projectId}.json` : 'omega-dev-org-report.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || 'No se pudo descargar el reporte JSON.');
    } finally {
      setExporting('');
    }
  }

  async function handleDownloadPdf() {
    setExporting('pdf');
    setError('');
    try {
      const blob = await exportDevReportPdf(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = projectId ? `omega-dev-report-${projectId}.pdf` : 'omega-dev-org-report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || 'No se pudo descargar el reporte PDF.');
    } finally {
      setExporting('');
    }
  }

  const sevCounts = report?.severityCounts || {};
  const triageCounts = report?.triageCounts || {};
  const reportProjects = Array.isArray(report?.projects) ? report.projects : [];
  const activeSuppressions = Array.isArray(report?.activeSuppressions) ? report.activeSuppressions : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <FileText className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Reportes Ejecutivos y Técnicos (PDF / JSON)
              </h2>
              <p className="text-xs text-slate-400">
                Resumen de postura por proyecto u organización con hallazgos por severidad, triaje y riesgos aceptados sin evidencia sensible.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <OmegaSelect
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="Seleccionar alcance del reporte"
              className="min-w-[220px]"
            >
              <option value="">Toda la organización</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Proyecto: {p.name}
                </option>
              ))}
            </OmegaSelect>

            <button
              type="button"
              disabled={Boolean(exporting)}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{exporting === 'pdf' ? 'Generando PDF...' : 'Exportar PDF'}</span>
            </button>

            <button
              type="button"
              disabled={Boolean(exporting)}
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.16] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <FileJson className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{exporting === 'json' ? 'Exportando...' : 'Exportar JSON'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            Compilando métricas del reporte...
          </p>
        ) : (
          <div className="space-y-5 pt-2 border-t border-white/[0.06]">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-[#141923]/65 border border-white/[0.05] p-3.5">
                <p className="text-[11px] text-slate-400">Proyectos incluidos</p>
                <p className="text-lg font-semibold text-slate-100 mt-1">
                  {report?.projectsCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-[#141923]/65 border border-white/[0.05] p-3.5">
                <p className="text-[11px] text-slate-400">Puntaje efectivo promedio</p>
                <p className="text-lg font-semibold text-slate-100 mt-1">
                  {report?.averageEffectiveScore ?? 0}/100
                </p>
              </div>
              <div className="rounded-xl bg-[#141923]/65 border border-white/[0.05] p-3.5">
                <p className="text-[11px] text-slate-400">Hallazgos críticos / altos</p>
                <p className="text-lg font-semibold text-rose-300 mt-1">
                  {(sevCounts.CRITICAL || 0) + (sevCounts.HIGH || 0)}
                </p>
              </div>
              <div className="rounded-xl bg-[#141923]/65 border border-white/[0.05] p-3.5">
                <p className="text-[11px] text-slate-400">Supresiones activas</p>
                <p className="text-lg font-semibold text-amber-300 mt-1">
                  {activeSuppressions.length}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#141923]/55 border border-white/[0.05] px-4 py-3 text-xs text-slate-300">
              <span>
                Triaje: <strong className="text-slate-100">{triageCounts.OPEN || 0}</strong> abiertos ·{' '}
                <strong className="text-slate-100">{triageCounts.IN_REVIEW || 0}</strong> en revisión ·{' '}
                <strong className="text-amber-300">{triageCounts.ACCEPTED || 0}</strong> riesgos aceptados ·{' '}
                <strong className="text-emerald-300">{triageCounts.FIXED || 0}</strong> corregidos
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
                <span>Zero-Retention garantizado</span>
              </span>
            </div>

            {reportProjects.length > 0 && (
              <div className="divide-y divide-white/[0.06] rounded-xl bg-[#141923]/60 border border-white/[0.05]">
                {reportProjects.map((proj) => (
                  <div
                    key={proj.projectId}
                    className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">{proj.name}</p>
                      <p className="text-[11px] text-slate-400">
                        Escaneos: {proj.scansCount} · Hallazgos: {proj.findingsCount} · Dependencias: {proj.dependenciesCount}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-200">
                        Efectivo: <strong>{proj.effectiveScore}</strong>/100 (Bruto: {proj.rawScore})
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          proj.policyStatus === 'FAIL'
                            ? 'border border-rose-500/35 bg-rose-500/10 text-rose-300'
                            : proj.policyStatus === 'WARN'
                            ? 'border border-amber-400/35 bg-amber-400/10 text-amber-300'
                            : 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        }`}
                      >
                        Política: {proj.policyStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
