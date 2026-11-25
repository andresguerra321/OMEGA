import { useEffect, useState } from 'react';
import { Check, RotateCcw, Save, Shield, SlidersHorizontal } from 'lucide-react';
import {
  deleteDevProjectPolicyOverride,
  getDevProjectPolicy,
  getDevTenantPolicy,
  listDevProjects,
  updateDevProjectPolicy,
  updateDevTenantPolicy,
} from '../lib/api';
import { OmegaSelect } from './OmegaSelect';

export function DevPoliciesTab({ authSession }) {
  const isAdmin =
    authSession?.role === 'ADMIN' ||
    Boolean(authSession?.canManageAccount) ||
    authSession?.accountType === 'INDIVIDUAL';
  const [projects, setProjects] = useState([]);
  const [scopeProjectId, setScopeProjectId] = useState('');
  const [failOnSeverity, setFailOnSeverity] = useState('HIGH');
  const [actionOnViolation, setActionOnViolation] = useState('FAIL_PIPELINE');
  const [allowedInput, setAllowedInput] = useState('');
  const [blockedInput, setBlockedInput] = useState('');
  const [isOverride, setIsOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [error, setError] = useState('');

  async function loadInitial() {
    setLoading(true);
    setError('');
    try {
      const [projList, tenantPol] = await Promise.all([
        listDevProjects(),
        getDevTenantPolicy(),
      ]);
      setProjects(Array.isArray(projList) ? projList : []);
      applyPolicyDto(tenantPol);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la configuración de políticas.');
    } finally {
      setLoading(false);
    }
  }

  function applyPolicyDto(dto) {
    if (!dto) return;
    setFailOnSeverity(dto.failOnSeverity || 'HIGH');
    setActionOnViolation(dto.actionOnViolation || 'FAIL_PIPELINE');
    setAllowedInput(Array.isArray(dto.allowedPackages) ? dto.allowedPackages.join(', ') : '');
    setBlockedInput(Array.isArray(dto.blockedPackages) ? dto.blockedPackages.join(', ') : '');
    setIsOverride(Boolean(dto.projectOverride));
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  async function handleScopeChange(projectId) {
    setScopeProjectId(projectId);
    setSavedNotice('');
    setError('');
    setLoading(true);
    try {
      const dto = projectId
        ? await getDevProjectPolicy(projectId)
        : await getDevTenantPolicy();
      applyPolicyDto(dto);
    } catch (err) {
      setError(err?.message || 'No se pudo consultar la política seleccionada.');
    } finally {
      setLoading(false);
    }
  }

  function parseList(text) {
    return String(text || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    if (!isAdmin) return;
    setSaving(true);
    setError('');
    setSavedNotice('');
    try {
      const payload = {
        failOnSeverity,
        actionOnViolation,
        allowedPackages: parseList(allowedInput),
        blockedPackages: parseList(blockedInput),
      };
      const updated = scopeProjectId
        ? await updateDevProjectPolicy(scopeProjectId, payload)
        : await updateDevTenantPolicy(payload);
      applyPolicyDto(updated);
      setSavedNotice(
        scopeProjectId
          ? 'Política específica del proyecto guardada y auditada.'
          : 'Política global del tenant guardada y auditada.'
      );
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la política.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetOverride() {
    if (!isAdmin || !scopeProjectId) return;
    setSaving(true);
    setError('');
    setSavedNotice('');
    try {
      await deleteDevProjectPolicyOverride(scopeProjectId);
      const inherited = await getDevProjectPolicy(scopeProjectId);
      applyPolicyDto(inherited);
      setSavedNotice('Override eliminado; el proyecto vuelve a heredar la política del tenant.');
    } catch (err) {
      setError(err?.message || 'No se pudo eliminar el override del proyecto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Políticas de Seguridad para CI, CLI y GitHub App
              </h2>
              <p className="text-xs text-slate-400">
                Define umbrales de bloqueo, comportamiento en pipelines y listas de paquetes permitidos o bloqueados.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <label htmlFor="policy-scope-select" className="text-xs text-slate-400 shrink-0">
              Alcance:
            </label>
            <OmegaSelect
              id="policy-scope-select"
              value={scopeProjectId}
              onChange={(e) => handleScopeChange(e.target.value)}
              className="min-w-[260px]"
            >
              <option value="">Política global del tenant (por defecto)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Proyecto: {p.name}
                </option>
              ))}
            </OmegaSelect>
          </div>
        </div>

        {scopeProjectId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#141923]/60 border border-white/[0.05] px-4 py-2.5 text-xs">
            <span className="text-slate-300">
              {isOverride
                ? 'Este proyecto tiene una política personalizada activa.'
                : 'Este proyecto hereda actualmente la política global del tenant.'}
            </span>
            {isAdmin && isOverride && (
              <button
                type="button"
                disabled={saving}
                onClick={handleResetOverride}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.16] px-2.5 py-1 text-[11px] text-slate-200 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                <span>Restaurar herencia del tenant</span>
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            {error}
          </div>
        )}

        {savedNotice && (
          <div
            role="status"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-xs text-emerald-300"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{savedNotice}</span>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            Cargando política...
          </p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4 pt-2 border-t border-white/[0.06]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="policy-fail-severity" className="block text-xs font-medium text-slate-200 mb-1.5">
                  Severidad mínima que infringe la política
                </label>
                <OmegaSelect
                  id="policy-fail-severity"
                  disabled={!isAdmin}
                  value={failOnSeverity}
                  onChange={(e) => setFailOnSeverity(e.target.value)}
                >
                  <option value="CRITICAL">CRITICAL (solo hallazgos críticos)</option>
                  <option value="HIGH">HIGH (críticos y altos — recomendado)</option>
                  <option value="MEDIUM">MEDIUM (críticos, altos y medios)</option>
                  <option value="LOW">LOW (cualquier hallazgo activo)</option>
                  <option value="NONE">NONE (solo evaluar paquetes bloqueados)</option>
                </OmegaSelect>
              </div>

              <div>
                <label htmlFor="policy-action-violation" className="block text-xs font-medium text-slate-200 mb-1.5">
                  Acción en CLI, GitHub Action y PRs
                </label>
                <OmegaSelect
                  id="policy-action-violation"
                  disabled={!isAdmin}
                  value={actionOnViolation}
                  onChange={(e) => setActionOnViolation(e.target.value)}
                >
                  <option value="FAIL_PIPELINE">FAIL_PIPELINE (fallar ejecución con código de salida != 0)</option>
                  <option value="COMMENT_PR">COMMENT_PR (reportar FAIL en PR sin bloquear CLI local)</option>
                  <option value="MARK_ONLY">MARK_ONLY (solo advertir WARN en panel y reportes)</option>
                </OmegaSelect>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="policy-allowed-pkgs" className="block text-xs font-medium text-slate-200 mb-1">
                  Paquetes permitidos (exentos de umbral)
                </label>
                <textarea
                  id="policy-allowed-pkgs"
                  rows={3}
                  disabled={!isAdmin}
                  value={allowedInput}
                  onChange={(e) => setAllowedInput(e.target.value)}
                  placeholder="Ej. npm:internal-sdk, lodash, pypi:trusted-lib"
                  className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs font-mono text-slate-100 disabled:opacity-60"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Separados por coma o salto de línea.
                </p>
              </div>

              <div>
                <label htmlFor="policy-blocked-pkgs" className="block text-xs font-medium text-slate-200 mb-1">
                  Paquetes bloqueados (infringen siempre la política)
                </label>
                <textarea
                  id="policy-blocked-pkgs"
                  rows={3}
                  disabled={!isAdmin}
                  value={blockedInput}
                  onChange={(e) => setBlockedInput(e.target.value)}
                  placeholder="Ej. npm:event-stream, pypi:ctx, request"
                  className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs font-mono text-slate-100 disabled:opacity-60"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Cualquier presencia en el SBOM marcará violación de política.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                <Shield className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                <span>
                  {isAdmin
                    ? 'Todo cambio queda registrado en audit_logs.'
                    : 'Modo lectura: solo los administradores del tenant pueden editar políticas.'}
                </span>
              </div>

              {isAdmin && (
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>{saving ? 'Guardando...' : 'Guardar política'}</span>
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
