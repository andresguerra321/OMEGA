import { useState } from 'react';
import { BookOpenCheck, X } from 'lucide-react';
import { LEGAL_SECONDARY } from '../lib/legalPresentation.js';

const STORAGE_KEY = 'omega_legal_onboarding_dismissed_v1';

function isDismissedInitially() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function LegalOnboardingGuide({ policyAccepted }) {
  const [dismissed, setDismissed] = useState(isDismissedInitially);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore storage quota errors
    }
  }

  return (
    <aside
      aria-label="Guía rápida de inicio para perfil LEGAL"
      className="rounded-2xl border border-[#2F6FED]/25 bg-[#0F131B]/90 p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <BookOpenCheck size={16} strokeWidth={1.75} className="text-[#2F6FED]" aria-hidden="true" />
          <span>Guía rápida de tu espacio LEGAL</span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ocultar guía rápida"
          className={`${LEGAL_SECONDARY} !p-1.5`}
        >
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3 text-xs text-white/75">
        <li className="space-y-1">
          <p className="font-medium text-white">
            1. Aceptar política de IA {policyAccepted ? '(listo)' : '(pendiente)'}
          </p>
          <p className="text-white/60">
            Un administrador revisa dónde se indexan y responden los documentos antes de la primera carga.
          </p>
        </li>
        <li className="space-y-1">
          <p className="font-medium text-white">2. Crear expediente y cargar archivos</p>
          <p className="text-white/60">
            Admite PDF, Word (.docx), PNG y JPEG. OMEGA extrae texto y elimina el archivo original (Zero-Retention).
          </p>
        </li>
        <li className="space-y-1">
          <p className="font-medium text-white">3. Consultar con citas y exportar dossier</p>
          <p className="text-white/60">
            Usa el Asistente y Cronología dentro de cada expediente y descarga el dossier PDF/JSON con verificación técnica SHA-256.
          </p>
        </li>
      </ol>
    </aside>
  );
}
