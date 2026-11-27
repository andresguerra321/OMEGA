import { useState } from 'react';
import { BookOpenCheck, ChevronDown, X } from 'lucide-react';
import { LEGAL_SECONDARY } from '../lib/legalPresentation.js';

const STORAGE_KEY = 'omega_legal_onboarding_dismissed_v1';

function isDismissedInitially() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function LegalOnboardingGuide() {
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
    <details className="group border-t border-white/[0.06]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-zinc-300 hover:text-white focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
        <BookOpenCheck size={16} strokeWidth={1.75} aria-hidden="true" /> Cómo empezar
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="group-open:rotate-180" />
      </summary>
      <div className="flex items-start justify-between gap-3 pb-3">
        <ul className="space-y-2 text-sm text-zinc-300">
          <li><strong className="font-medium text-white">Crea un expediente.</strong> Abre una ficha para reunir los datos de tu caso.</li>
          <li><strong className="font-medium text-white">Agrega tus documentos.</strong> Puedes subir PDF, Word, PNG o JPEG después de que se apruebe el uso de IA.</li>
          <li><strong className="font-medium text-white">Consulta y comparte.</strong> Revisa las citas y la cronología, o exporta el informe del caso.</li>
        </ul>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ocultar guía rápida"
          className={`${LEGAL_SECONDARY} !p-1.5`}
        >
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </details>
  );
}
