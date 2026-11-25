const SYSTEM_PREFIXES = new Set([
  'qa',
  'test',
  'dev',
  'admin',
  'fix',
  'sys',
  'bot',
  'demo',
  'staging',
  'ci',
]);

const TECHNICAL_TOKENS = new Set([
  ...SYSTEM_PREFIXES,
  'user',
  'account',
  'local',
  'auto',
  'sandbox',
  'smoke',
  'e2e',
  'tmp',
]);

const UPPERCASE_ACRONYMS = new Set(['qa', 'ci', 'it', 'ops', 'soc']);

function normalizeCasing(word, { allowAcronyms = false } = {}) {
  const clean = String(word || '').trim();
  if (!clean) return '';
  const lower = clean.toLocaleLowerCase('es');
  if (allowAcronyms && UPPERCASE_ACRONYMS.has(lower)) {
    return lower.toUpperCase();
  }
  const upper = clean.toLocaleUpperCase('es');
  // Solo normalizar si viene todo en minúsculas o todo en mayúsculas; respetar capitalización mixta (ej. McDonald, JeanLuc)
  if (clean === lower || clean === upper) {
    return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
  }
  return clean;
}

function isTechnicalRealName(value) {
  const v = String(value || '').trim();
  if (!v || v.includes('@')) return true;
  if (/^\d+$/.test(v) || /\d{4,}/.test(v)) return true;
  if (!v.includes(' ') && /[._]/.test(v)) {
    const parts = v.split(/[._]+/).filter(Boolean);
    if (parts.length > 1 && SYSTEM_PREFIXES.has(parts[0].toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Formatea y abrevia limpiamente el nombre para el saludo editorial del Home.
 * - Nombres reales (`firstName` / `displayName` / `fullName` / `name`): conserva el primer nombre
 *   sin mutilarlo con `.slice()`, respetando tildes y mayúsculas intencionales (ej. `McDonald`, `María-Fernanda` -> `María`).
 * - Correos / handles técnicos (solo fallback cuando no hay nombre real): limpia dominios y números largos.
 *
 * @param {Record<string, unknown> | null | undefined} user
 * @returns {string}
 */
export function formatGreetingName(user) {
  if (!user || typeof user !== 'object') return 'Usuario';

  // Prioridad 1: Nombre real (nunca aplicar heurísticas de cuentas técnicas ni recortes mid-word)
  const realCandidate = String(
    user.firstName || user.displayName || user.fullName || user.name || '',
  ).trim();
  if (realCandidate && !isTechnicalRealName(realCandidate)) {
    // Separar por espacio o guion para nombres compuestos (ej. "María-Fernanda" -> "María", "Juan Carlos" -> "Juan")
    const firstWord = realCandidate.split(/[\s-]+/).filter(Boolean)[0] || '';
    const alphaWord = firstWord.replace(/[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ']/g, '');
    if (alphaWord.length >= 2) {
      return normalizeCasing(alphaWord, { allowAcronyms: false });
    }
  }

  // Prioridad 2: Correo electrónico o handle técnico (fallback cuando no existe nombre real)
  const rawHandle = String(user.username || user.email || '').trim();
  if (!rawHandle) return 'Usuario';

  const localPart = rawHandle.replace(/^@+/, '').split('@')[0].trim();
  if (!localPart) return 'Usuario';

  const rawSegments = localPart.split(/[._\-\s]+/).filter(Boolean);
  const hadNumericSegment = rawSegments.some((seg) => /^\d+$/.test(seg) || /\d{4,}/.test(seg));

  const cleanSegments = rawSegments
    .filter((seg) => !/^\d+$/.test(seg) && !/\d{4,}/.test(seg))
    .map((seg) => seg.replace(/\d+$/g, ''))
    .filter((seg) => /[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ]/.test(seg));

  if (cleanSegments.length === 0) return 'Usuario';

  const firstLower = cleanSegments[0].toLowerCase();
  const secondLower = cleanSegments[1]?.toLowerCase() || '';

  // Cuentas de pruebas / sistema (ej. qa.fix.1795551653173@example.org -> "QA Fix")
  const isSystemAccount =
    SYSTEM_PREFIXES.has(firstLower) &&
    (hadNumericSegment ||
      cleanSegments.length === 1 ||
      TECHNICAL_TOKENS.has(secondLower));

  if (isSystemAccount) {
    const firstFormatted = normalizeCasing(cleanSegments[0], { allowAcronyms: true });
    if (cleanSegments.length >= 2) {
      const combined = `${firstFormatted} ${normalizeCasing(cleanSegments[1], { allowAcronyms: true })}`;
      if (combined.length <= 8) return combined;
    }
    return firstFormatted.length > 12 ? firstFormatted.slice(0, 10) : firstFormatted;
  }

  // Correos personales normales (ej. andres.guerra@gmail.com -> "Andres", fitagh@gmail.com -> "Fitagh")
  const personal = normalizeCasing(cleanSegments[0], { allowAcronyms: false });
  if (!personal) return 'Usuario';
  return personal.length > 12 ? personal.slice(0, 10) : personal;
}
