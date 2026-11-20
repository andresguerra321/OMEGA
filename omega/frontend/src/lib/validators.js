/**
 * Utilidades compartidas de validación de entradas del cliente (espejo de reglas del backend OMEGA).
 */

const EMAIL_RE =
  /^(?=.{5,255}$)(?!.*\.\.)[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+){0,3}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;

const PERSON_ALLOWED_RE = /^[\p{L}][\p{L}\s.'’-]{0,198}[\p{L}.]$/u;
const ORG_ALLOWED_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s&'’.,/()-]{0,198}[\p{L}\p{N}.)]$/u;
const LETTER_RE = /\p{L}/gu;
const CONSECUTIVE_SAME_LETTER_RE = /(\p{L})\1{3}/iu;
const CONSECUTIVE_PUNCT_RE = /[.'’-]{2}/u;
const CONSECUTIVE_ORG_PUNCT_RE = /\.\.|,,|''|’’|--|\/\/|&&|\.-|-\./u;
const CONSONANT_RUN_RE = /[bcdfghjklmnñpqrstvwxz]{7}/iu;
const HOST_CONSONANT_RUN_RE = /[bcdfghjklmnpqrstvwxz]{7}/i;
const CHAT_CONSONANT_RUN_RE = /[bcdfghjklmnñpqrstvwxz]{7}/iu;
const INTERLEAVED_SMASH_RE = /(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\d+[a-z]+\d+/i;
const UNICODE_INTERLEAVED_SMASH_RE = /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]{9,})[\p{L}\p{N}]*\p{L}+\p{N}+\p{L}+\p{N}+/iu;
const VOWEL_RE = /[aeiouyáéíóúàèìòùäëïöüâêîôû]/iu;
const PASSWORD_HAS_LETTER_RE = /\p{L}/u;
const PASSWORD_HAS_DIGIT_OR_SYMBOL_RE = /[\p{N}\p{P}\p{S}]/u;
const PASSWORD_ALL_SAME_CHAR_RE = /^(.)\1+$/u;
const UNSAFE_SCHEME_RE = /^(?:javascript|data|vbscript|file|ftp|mailto|about):/i;

export function countLetters(text) {
  const matches = String(text || '').match(LETTER_RE);
  return matches ? matches.length : 0;
}

export function validateEmail(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return { valid: false, value, error: 'Ingresa tu correo electrónico.' };
  }
  if (/\s/.test(value)) {
    return { valid: false, value, error: 'El correo electrónico no puede contener espacios.' };
  }
  if (!EMAIL_RE.test(value)) {
    return {
      valid: false,
      value,
      error: 'Ingresa un correo electrónico válido (por ejemplo: nombre@dominio.org).',
    };
  }
  const lower = value.toLowerCase();
  const [localPart, domainPart] = lower.split('@');
  const localSegments = localPart.split('.');
  if (
    CONSECUTIVE_SAME_LETTER_RE.test(localPart) ||
    HOST_CONSONANT_RUN_RE.test(localPart) ||
    INTERLEAVED_SMASH_RE.test(localPart) ||
    (localSegments.length >= 3 && localSegments.some((seg) => /^\d+$/.test(seg))) ||
    !validateDomain(domainPart).valid
  ) {
    return {
      valid: false,
      value,
      error: 'Ingresa un correo electrónico válido (por ejemplo: nombre@dominio.org).',
    };
  }
  return { valid: true, value: lower, error: '' };
}

export function validateFullName(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length < 2) {
    return {
      valid: false,
      value,
      error: 'Ingresa tu nombre completo (mínimo 2 caracteres).',
    };
  }
  if (value.length > 120) {
    return {
      valid: false,
      value,
      error: 'El nombre completo no puede superar 120 caracteres.',
    };
  }
  if (
    /\s{2}/.test(value) ||
    countLetters(value) < 2 ||
    CONSECUTIVE_PUNCT_RE.test(value) ||
    CONSECUTIVE_SAME_LETTER_RE.test(value) ||
    CONSONANT_RUN_RE.test(value) ||
    value.split(/[\s'’-]+/).some((w) => w.length >= 4 && !VOWEL_RE.test(w)) ||
    !PERSON_ALLOWED_RE.test(value)
  ) {
    return {
      valid: false,
      value,
      error:
        'Ingresa un nombre válido (solo letras, espacios simples, apóstrofo o guion; sin números ni símbolos).',
    };
  }
  return { valid: true, value, error: '' };
}

export function validateOrganizationName(raw, { required = false } = {}) {
  const value = String(raw ?? '').trim();
  if (!value) {
    if (required) {
      return { valid: false, value, error: 'Ingresa el nombre de tu organización.' };
    }
    return { valid: true, value: '', error: '' };
  }
  if (value.length < 2 || value.length > 140) {
    return {
      valid: false,
      value,
      error: 'La organización debe tener entre 2 y 140 caracteres.',
    };
  }
  const nonSpaceLen = value.replace(/\s/g, '').length;
  if (
    /\s{2}/.test(value) ||
    countLetters(value) < 2 ||
    countLetters(value) * 2 < nonSpaceLen ||
    CONSECUTIVE_ORG_PUNCT_RE.test(value) ||
    /\.\d+\./.test(value) ||
    CONSECUTIVE_SAME_LETTER_RE.test(value) ||
    CONSONANT_RUN_RE.test(value) ||
    UNICODE_INTERLEAVED_SMASH_RE.test(value) ||
    value.split('.').length > 4 ||
    !ORG_ALLOWED_RE.test(value)
  ) {
    return {
      valid: false,
      value,
      error: 'Ingresa un nombre de organización válido (al menos 2 letras, sin caracteres sin sentido).',
    };
  }
  return { valid: true, value, error: '' };
}

export function validateTenantSlug(raw, { required = false } = {}) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) {
    if (required) {
      return { valid: false, value, error: 'Ingresa el identificador de organización.' };
    }
    return { valid: true, value: '', error: '' };
  }
  if (
    !TENANT_SLUG_RE.test(value) ||
    /--/.test(value) ||
    countLetters(value) < 2 ||
    CONSECUTIVE_SAME_LETTER_RE.test(value) ||
    HOST_CONSONANT_RUN_RE.test(value) ||
    INTERLEAVED_SMASH_RE.test(value)
  ) {
    return {
      valid: false,
      value,
      error: 'El identificador solo admite minúsculas reales, números y guiones simples (3 a 80 caracteres).',
    };
  }
  return { valid: true, value, error: '' };
}

export function validateNewPassword(raw) {
  const value = String(raw ?? '');
  if (!value) {
    return { valid: false, value, error: 'Ingresa una contraseña.' };
  }
  if (value !== value.trim()) {
    return {
      valid: false,
      value,
      error: 'La contraseña no puede empezar ni terminar con espacios.',
    };
  }
  if (/[\r\n\t\0]/.test(value)) {
    return {
      valid: false,
      value,
      error: 'La contraseña contiene caracteres de control no permitidos.',
    };
  }
  if (value.length < 12 || value.length > 128) {
    return {
      valid: false,
      value,
      error: 'La contraseña debe tener entre 12 y 128 caracteres reales.',
    };
  }
  if (
    PASSWORD_ALL_SAME_CHAR_RE.test(value) ||
    /(.)\1{5}/.test(value) ||
    !PASSWORD_HAS_LETTER_RE.test(value) ||
    !PASSWORD_HAS_DIGIT_OR_SYMBOL_RE.test(value)
  ) {
    return {
      valid: false,
      value,
      error: 'Usa al menos 12 caracteres combinando letras y un número o símbolo (sin caracteres repetidos).',
    };
  }
  return { valid: true, value, error: '' };
}

export function validateLoginPassword(raw) {
  const value = String(raw ?? '');
  if (!value.trim()) {
    return { valid: false, value, error: 'Ingresa tu contraseña.' };
  }
  if (value.length > 128) {
    return { valid: false, value, error: 'La contraseña supera la longitud máxima permitida.' };
  }
  return { valid: true, value, error: '' };
}

function hasDomainNoise(host) {
  const labels = host.split('.');
  if (labels.length < 2 || labels.length > 5) return true;
  if (labels.filter((label) => label.length === 1).length >= 2) return true;
  if (labels.some((label) => label.includes('--') && !label.startsWith('xn--'))) return true;
  if (
    CONSECUTIVE_SAME_LETTER_RE.test(host) ||
    HOST_CONSONANT_RUN_RE.test(host) ||
    INTERLEAVED_SMASH_RE.test(host)
  ) {
    return true;
  }
  return false;
}

export function validateDomain(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) {
    return { valid: false, value, error: 'Ingresa un dominio válido (ej. organizacion.org).' };
  }
  if (/^https?:\/\//i.test(value) || /\//.test(value) || /\s/.test(value)) {
    return {
      valid: false,
      value,
      error: 'Escribe solo el dominio sin http:// ni rutas (por ejemplo: organizacion.org).',
    };
  }
  if (!DOMAIN_RE.test(value) || hasDomainNoise(value)) {
    return {
      valid: false,
      value,
      error: 'Formato de dominio inválido (debe incluir extensión válida, ej. organizacion.org).',
    };
  }
  return { valid: true, value, error: '' };
}

function isValidIpv4(host) {
  if (!IPV4_RE.test(host)) return false;
  return host.split('.').every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function validateUrlInput(raw, { allowBareDomain = true } = {}) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      value: trimmed,
      error: allowBareDomain
        ? 'Ingresa una URL, dominio o IPv4 para analizar.'
        : 'Ingresa una URL completa que empiece por https:// o http://.',
    };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, value: trimmed, error: 'La URL no puede contener espacios.' };
  }
  if (UNSAFE_SCHEME_RE.test(trimmed)) {
    return {
      valid: false,
      value: trimmed,
      error: 'Solo se permiten enlaces con esquema http:// o https://.',
    };
  }

  const refanged = trimmed
    .replace(/^hxxps:\/\//i, 'https://')
    .replace(/^hxxp:\/\//i, 'http://')
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, '.');

  if (!allowBareDomain && !/^https?:\/\//i.test(refanged)) {
    return {
      valid: false,
      value: trimmed,
      error: 'Ingresa una URL completa que comience con https:// o http://.',
    };
  }

  const candidate = /^https?:\/\//i.test(refanged) ? refanged : `http://${refanged}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      value: trimmed,
      error: 'Ingresa una URL o dominio válido (por ejemplo: https://ejemplo.org/ruta).',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      value: trimmed,
      error: 'Solo se permiten enlaces HTTP o HTTPS.',
    };
  }

  const host = (parsed.hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || (!validateDomain(host).valid && !isValidIpv4(host))) {
    return {
      valid: false,
      value: trimmed,
      error: 'Ingresa una URL o dominio con extensión válida (por ejemplo: https://ejemplo.org).',
    };
  }

  return { valid: true, value: trimmed, error: '' };
}

export function validateAuthLoginForm(form, { includeTenantSlug = false } = {}) {
  const fieldErrors = {};
  const emailRes = validateEmail(form?.email);
  if (!emailRes.valid) fieldErrors.email = emailRes.error;

  const pwdRes = validateLoginPassword(form?.password);
  if (!pwdRes.valid) fieldErrors.password = pwdRes.error;

  const slugRes = includeTenantSlug
    ? validateTenantSlug(form?.tenantSlug, { required: false })
    : { valid: true, value: '', error: '' };
  if (!slugRes.valid) fieldErrors.tenantSlug = slugRes.error;

  const firstError = Object.values(fieldErrors)[0] || '';
  return {
    valid: !firstError,
    fieldErrors,
    firstError,
    sanitized: {
      email: emailRes.value,
      password: pwdRes.value,
      tenantSlug: slugRes.value,
    },
  };
}

export function validateAuthRegisterForm(form, { bootstrapSecretRequired = false } = {}) {
  const fieldErrors = {};
  const nameRes = validateFullName(form?.fullName);
  if (!nameRes.valid) fieldErrors.fullName = nameRes.error;

  const emailRes = validateEmail(form?.email);
  if (!emailRes.valid) fieldErrors.email = emailRes.error;

  const orgRes = validateOrganizationName(form?.organizationName, { required: false });
  if (!orgRes.valid) fieldErrors.organizationName = orgRes.error;

  const pwdRes = validateNewPassword(form?.password);
  if (!pwdRes.valid) fieldErrors.password = pwdRes.error;

  const bootstrapSecret = String(form?.bootstrapSecret ?? '').trim();
  if (bootstrapSecretRequired && !bootstrapSecret) {
    fieldErrors.bootstrapSecret = 'Ingresa la clave de aprovisionamiento (Bootstrap Secret).';
  }

  const normalizedProfile = ['GENERAL', 'DEVELOPER', 'LEGAL'].includes(
    String(form?.profile ?? '').trim().toUpperCase(),
  )
    ? String(form.profile).trim().toUpperCase()
    : 'GENERAL';

  const firstError = Object.values(fieldErrors)[0] || '';
  return {
    valid: !firstError,
    fieldErrors,
    firstError,
    sanitized: {
      fullName: nameRes.value,
      email: emailRes.value,
      organizationName: orgRes.value,
      password: pwdRes.value,
      bootstrapSecret,
      profile: normalizedProfile,
    },
  };
}

/* ------------------------------------------------------------------------
 * Blindaje genérico de entradas libres (búsquedas, chat, IOC, archivos)
 * ---------------------------------------------------------------------- */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const MEANINGFUL_CHAR_RE = /[\p{L}\p{N}]/u;
const REPEATED_CHAR_RUN_RE = /(.)\1{9,}/u;

/** Elimina caracteres de control / bidi invisibles y limita longitud. */
export function stripUnsafeChars(raw, maxLength = 4000) {
  return String(raw ?? '')
    .replace(CONTROL_CHARS_RE, '')
    .slice(0, maxLength);
}

/** Sanitiza filtros de búsqueda locales: sin control chars, espacios colapsados, máx. N chars. */
export function sanitizeSearchInput(raw, maxLength = 120) {
  return stripUnsafeChars(raw, maxLength * 2)
    .replace(/\s{2,}/g, ' ')
    .slice(0, maxLength);
}

const DOTTED_VERSION_RE = /^\d+(?:\.\d+){1,3}$/;
const DOUBLE_DOT_GIBBERISH_RE = /[a-z0-9]\.\.[a-z0-9]/i;
const MULTI_DOT_CHAIN_RE = /(?:[a-z0-9]+\.){3,}[a-z0-9]+/i;
const HEX_LONG_RE = /^[a-f0-9]{16,64}$/i;

function isGibberishChatToken(rawToken) {
  const token = rawToken.replace(/^[()[\]{}<>"'.,;:?!¿¡]+|[()[\]{}<>"'.,;:?!¿¡]+$/g, '');
  if (!token || classifyIoc(token) || HEX_LONG_RE.test(token) || DOTTED_VERSION_RE.test(token)) {
    return false;
  }
  return (
    DOUBLE_DOT_GIBBERISH_RE.test(token) ||
    MULTI_DOT_CHAIN_RE.test(token) ||
    UNICODE_INTERLEAVED_SMASH_RE.test(token) ||
    CHAT_CONSONANT_RUN_RE.test(token)
  );
}

/** Mensaje libre al asistente: mantiene funcionalidad, bloquea vacío, ruido y abuso de longitud. */
export function validateChatMessage(raw, { maxLength = 4000 } = {}) {
  const value = stripUnsafeChars(raw, maxLength + 1).trim();
  if (!value) {
    return { valid: false, value, error: 'Escribe una consulta antes de enviar.' };
  }
  if (value.length > maxLength) {
    return {
      valid: false,
      value: value.slice(0, maxLength),
      error: `La consulta supera el máximo de ${maxLength} caracteres.`,
    };
  }
  if (!MEANINGFUL_CHAR_RE.test(value)) {
    return {
      valid: false,
      value,
      error: 'La consulta debe incluir letras o números, no solo símbolos.',
    };
  }
  if (value.length < 2) {
    return { valid: false, value, error: 'La consulta es demasiado corta.' };
  }
  if (REPEATED_CHAR_RUN_RE.test(value)) {
    return {
      valid: false,
      value,
      error: 'La consulta contiene caracteres repetidos sin sentido. Reformúlala.',
    };
  }
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.some(isGibberishChatToken)) {
    return {
      valid: false,
      value,
      error: 'La consulta contiene texto sin sentido o un formato inválido. Escribe una pregunta clara o un indicador válido.',
    };
  }
  return { valid: true, value, error: '' };
}

const CVE_RE = /^CVE-\d{4}-\d{4,7}$/i;
const HASH_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;

/** Detecta el tipo de un indicador CTI (CVE, hash, IPv4, dominio, URL) o null si es basura. */
export function classifyIoc(raw) {
  const value = stripUnsafeChars(raw, 2048).trim();
  if (!value || /\s/.test(value)) return null;
  if (CVE_RE.test(value)) return { type: 'cve', value: value.toUpperCase() };
  if (HASH_RE.test(value)) return { type: 'hash', value: value.toLowerCase() };
  const refanged = value.replace(/\[\.\]|\(\.\)|\{\.\}/g, '.');
  if (isValidIpv4(refanged)) return { type: 'ipv4', value: refanged };
  const domainCheck = validateDomain(refanged);
  if (domainCheck.valid) return { type: 'domain', value: domainCheck.value };
  if (/^(?:https?|hxxps?):\/\//i.test(refanged) && validateUrlInput(refanged).valid) {
    return { type: 'url', value: refanged };
  }
  return null;
}

export function validateIocInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { valid: false, value: '', type: null, error: 'Ingresa un CVE, dominio, IPv4, URL o hash.' };
  }
  const match = classifyIoc(trimmed);
  if (!match) {
    return {
      valid: false,
      value: trimmed,
      type: null,
      error: 'Indicador no reconocido. Usa CVE-AAAA-NNNN, dominio.tld, IPv4, URL http(s) o hash MD5/SHA1/SHA256.',
    };
  }
  return { valid: true, value: match.value, type: match.type, error: '' };
}

/** Lista multilínea de indicadores (máx. N líneas): separa válidos e inválidos. */
export function validateIocList(raw, { maxLines = 200 } = {}) {
  const lines = stripUnsafeChars(raw, 100000)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { valid: false, accepted: [], rejected: [], error: 'Pega al menos un indicador por línea.' };
  }
  if (lines.length > maxLines) {
    return {
      valid: false,
      accepted: [],
      rejected: [],
      error: `Máximo ${maxLines} indicadores por análisis (recibidos ${lines.length}).`,
    };
  }
  const accepted = [];
  const rejected = [];
  for (const line of lines) {
    const m = classifyIoc(line);
    if (m) accepted.push(m.value);
    else rejected.push(line);
  }
  if (accepted.length === 0) {
    return {
      valid: false,
      accepted,
      rejected,
      error: 'Ninguna línea es un indicador válido (dominio, IPv4, URL, CVE o hash).',
    };
  }
  return { valid: true, accepted: [...new Set(accepted)], rejected, error: '' };
}

/** Valida archivo subido por extensión, tamaño y nombre. */
export function validateUploadFile(file, { extensions = [], maxBytes = 25 * 1024 * 1024, label = 'archivo' } = {}) {
  if (!file) return { valid: false, error: `Selecciona un ${label}.` };
  const name = String(file.name || '');
  const lower = name.toLowerCase();
  if (!name || name.length > 255 || CONTROL_CHARS_RE.test(name)) {
    CONTROL_CHARS_RE.lastIndex = 0;
    return { valid: false, error: 'El nombre del archivo no es válido.' };
  }
  if (extensions.length && !extensions.some((ext) => lower.endsWith(ext))) {
    return {
      valid: false,
      error: `Formato no admitido. Usa: ${extensions.join(', ')}.`,
    };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { valid: false, error: 'El archivo está vacío.' };
  }
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `El ${label} supera el máximo de ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return { valid: true, error: '' };
}

export function validateTenantUserForm(form) {
  const fieldErrors = {};
  const nameRes = validateFullName(form?.fullName);
  if (!nameRes.valid) fieldErrors.fullName = nameRes.error;

  const emailRes = validateEmail(form?.email);
  if (!emailRes.valid) fieldErrors.email = emailRes.error;

  const pwdRes = validateNewPassword(form?.password);
  if (!pwdRes.valid) fieldErrors.password = pwdRes.error;

  const firstError = Object.values(fieldErrors)[0] || '';
  return {
    valid: !firstError,
    fieldErrors,
    firstError,
    sanitized: {
      fullName: nameRes.value,
      email: emailRes.value,
      password: pwdRes.value,
      role: form?.role || 'ANALYST',
    },
  };
}
