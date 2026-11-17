import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Mail,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  confirmEmailMfa,
  confirmTotpMfa,
  disableMfa,
  fetchMfaStatus,
  setupEmailMfa,
  setupTotpMfa,
} from '../lib/api';

function formatSecretGroups(secret) {
  return String(secret || '')
    .replace(/\s+/g, '')
    .match(/.{1,4}/g)
    ?.join(' ') || '';
}

export function TwoFactorSettingsCard({ authSession }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Modal wizard state: null | 'pick' | 'totp' | 'email' | 'codes' | 'success' | 'disable'
  const [modalStep, setModalStep] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState('TOTP');
  const [totpSetup, setTotpSetup] = useState(null); // { secret, otpauthUri, qrDataUrl }
  const [codeInput, setCodeInput] = useState('');
  const [disablePwd, setDisablePwd] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [activatedMethod, setActivatedMethod] = useState('TOTP');
  const [copiedKey, setCopiedKey] = useState('');
  const otpRefs = useRef([]);

  useEffect(() => {
    if (!authSession) return;
    let cancelled = false;
    fetchMfaStatus()
      .then((res) => {
        if (!cancelled && res) setStatus(res);
      })
      .catch(() => {
        // Silent fallback if gateway is warming up
      });
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  function openSetupWizard(initialMethod = 'TOTP') {
    setErrorMsg('');
    setInfoMsg('');
    setCodeInput('');
    setBackupCodes([]);
    setSelectedMethod(initialMethod);
    setModalStep('pick');
  }

  function closeModal() {
    setModalStep(null);
    setTotpSetup(null);
    setCodeInput('');
    setDisablePwd('');
    setErrorMsg('');
  }

  async function handleContinueFromPicker() {
    setLoading(true);
    setErrorMsg('');
    setCodeInput('');
    try {
      if (selectedMethod === 'TOTP') {
        const res = await setupTotpMfa();
        const qrDataUrl = await QRCode.toDataURL(res.otpauthUri, {
          width: 200,
          margin: 1,
          color: { dark: '#0A0A0C', light: '#FFFFFF' },
        });
        setTotpSetup({ ...res, qrDataUrl });
        setModalStep('totp');
      } else {
        const res = await setupEmailMfa();
        setInfoMsg(res.message || 'Código enviado a tu correo.');
        setModalStep('email');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo iniciar la configuración 2FA.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOtp(e) {
    e?.preventDefault();
    const clean = codeInput.replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) {
      setErrorMsg('Ingresa los 6 dígitos de verificación.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res =
        modalStep === 'totp' ? await confirmTotpMfa(clean) : await confirmEmailMfa(clean);
      const codes = res.backupCodes || [];
      setBackupCodes(codes);
      setActivatedMethod(res.method || (modalStep === 'totp' ? 'TOTP' : 'EMAIL'));
      setStatus((prev) => ({
        ...(prev || {}),
        mfaEnabled: true,
        method: res.method || (modalStep === 'totp' ? 'TOTP' : 'EMAIL'),
        backupCodesRemaining: codes.length,
      }));
      setTotpSetup(null);
      setCodeInput('');
      setModalStep(codes.length > 0 ? 'codes' : 'success');
    } catch (err) {
      setErrorMsg(err?.message || 'Código incorrecto o expirado.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisableMfa(e) {
    e.preventDefault();
    if (!disablePwd) {
      setErrorMsg('Ingresa tu contraseña actual para desactivar 2FA.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await disableMfa(disablePwd);
      setStatus(res);
      setDisablePwd('');
      setBackupCodes([]);
      setInfoMsg('Verificación en dos pasos desactivada.');
      setModalStep(null);
    } catch (err) {
      setErrorMsg(err?.message || 'Contraseña incorrecta.');
    } finally {
      setLoading(false);
    }
  }

  function copyText(text, label) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(''), 1800);
    });
  }

  function downloadBackupCodes() {
    const content = [
      'OMEGA — Códigos de recuperación 2FA',
      `Cuenta: ${authSession?.email || 'usuario'}`,
      `Generados: ${new Date().toISOString()}`,
      '',
      'Cada código solo puede usarse una vez:',
      ...backupCodes,
      '',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omega-2fa-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderSixDigitBoxes() {
    return (
      <div
        className="grid grid-cols-6 gap-2"
        onPaste={(e) => {
          const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (!pasted) return;
          e.preventDefault();
          setCodeInput(pasted);
          const nextIdx = Math.min(pasted.length, 5);
          otpRefs.current[nextIdx]?.focus();
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((idx) => {
          const digit = codeInput[idx] || '';
          return (
            <input
              key={idx}
              ref={(el) => {
                otpRefs.current[idx] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={idx === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              aria-label={`Dígito 2FA ${idx + 1} de 6`}
              value={digit}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(-1);
                const chars = codeInput.padEnd(6, ' ').split('').slice(0, 6);
                chars[idx] = val || ' ';
                const nextCode = chars.join('').replace(/\s+/g, '');
                setCodeInput(nextCode);
                if (val && idx < 5) {
                  otpRefs.current[idx + 1]?.focus();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digit && idx > 0) {
                  otpRefs.current[idx - 1]?.focus();
                } else if (e.key === 'ArrowLeft' && idx > 0) {
                  e.preventDefault();
                  otpRefs.current[idx - 1]?.focus();
                } else if (e.key === 'ArrowRight' && idx < 5) {
                  e.preventDefault();
                  otpRefs.current[idx + 1]?.focus();
                }
              }}
              className={`h-12 w-full rounded-[12px] border text-center font-mono text-[19px] font-semibold text-[#F2F2F4] transition-all duration-150 focus:outline-none ${
                digit
                  ? 'border-[#2F6FED]/75 bg-[#2F6FED]/15 shadow-[0_0_16px_rgba(47,111,237,0.24)]'
                  : 'border-white/[0.12] bg-[#0A0A0C]/80 focus:border-[#2F6FED]'
              }`}
            />
          );
        })}
      </div>
    );
  }

  const mfaEnabled = Boolean(status?.mfaEnabled);
  const currentMethod = status?.method || 'NONE';

  return (
    <div className="pt-4 border-t border-white/[0.06] space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-[#F2F2F4]">
              Verificación en dos pasos (2FA)
            </span>
            {mfaEnabled && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium border border-[#30D158]/35 bg-[#30D158]/10 text-[#86EFAC]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]" />
                {currentMethod === 'EMAIL' ? 'Correo electrónico' : 'App Autenticadora (TOTP)'}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#9A9AA2] leading-relaxed">
            Mantén tu cuenta segura activando 2FA mediante código al correo o aplicación autenticadora (TOTP).
          </p>
          {mfaEnabled && (
            <button
              type="button"
              onClick={() => openSetupWizard(currentMethod === 'EMAIL' ? 'EMAIL' : 'TOTP')}
              className="text-[11.5px] font-medium text-[#6EA0FF] hover:text-white transition-colors cursor-pointer pt-0.5"
            >
              Cambiar método 2FA →
            </button>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={mfaEnabled}
          aria-label="Activar o desactivar verificación en dos pasos"
          onClick={() => {
            if (mfaEnabled) {
              setErrorMsg('');
              setDisablePwd('');
              setModalStep('disable');
            } else {
              openSetupWizard('TOTP');
            }
          }}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 cursor-pointer ${
            mfaEnabled
              ? 'bg-[#2F6FED] border-[#6EA0FF]/60 shadow-[0_0_16px_rgba(47,111,237,0.45)]'
              : 'bg-white/[0.08] border-white/[0.14] hover:bg-white/[0.14]'
          }`}
        >
          <span
            className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
              mfaEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {infoMsg && !modalStep && (
        <div className="rounded-[9px] border border-[#30D158]/35 bg-[#30D158]/10 px-3 py-2 text-[12px] text-[#CFFAD9]">
          {infoMsg}
        </div>
      )}

      {modalStep &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !loading) closeModal();
            }}
          >
            <div className="relative w-full max-w-[440px] rounded-[20px] border border-white/[0.12] bg-gradient-to-b from-[#171923]/95 to-[#0D0E14]/98 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] text-[#F2F2F4]">
              <button
                type="button"
                aria-label="Cerrar"
                disabled={loading}
                onClick={closeModal}
                className="absolute top-4 right-4 h-8 w-8 rounded-[9px] border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.10] flex items-center justify-center text-[#9A9AA2] hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              {errorMsg && (
                <div className="mb-4 rounded-[10px] border border-[#FF453A]/40 bg-[#FF453A]/14 px-3.5 py-2 text-[12px] text-[#FFDAD6]">
                  {errorMsg}
                </div>
              )}

              {/* STEP 1: Method Picker */}
              {modalStep === 'pick' && (
                <div className="space-y-4">
                  <div className="pr-8">
                    <h3 className="text-[17px] font-semibold tracking-[-0.015em]">
                      Protege tu cuenta con 2FA
                    </h3>
                    <p className="mt-1 text-[12.5px] text-[#9A9AA2]">
                      Elige cómo deseas recibir tus códigos de autenticación.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedMethod('TOTP')}
                      className={`w-full text-left rounded-[13px] border p-3.5 flex items-start gap-3 transition-all cursor-pointer ${
                        selectedMethod === 'TOTP'
                          ? 'border-[#2F6FED]/70 bg-[#2F6FED]/12 shadow-[0_0_22px_rgba(47,111,237,0.18)]'
                          : 'border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="mt-0.5 h-9 w-9 rounded-[10px] bg-[#2F6FED]/15 border border-[#2F6FED]/35 flex items-center justify-center shrink-0">
                        <Smartphone className="h-4 w-4 text-[#8BB2FF]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-[#F2F2F4]">
                            App Autenticadora
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#30D158]/15 border border-[#30D158]/35 text-[#86EFAC]">
                            Recomendado
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-[#9A9AA2]">
                          Usa Google Authenticator, Authy o Bitwarden (funciona offline).
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={status?.smtpConfigured === false}
                      onClick={() => setSelectedMethod('EMAIL')}
                      className={`w-full text-left rounded-[13px] border p-3.5 flex items-start gap-3 transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                        selectedMethod === 'EMAIL'
                          ? 'border-[#2F6FED]/70 bg-[#2F6FED]/12 shadow-[0_0_22px_rgba(47,111,237,0.18)]'
                          : 'border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="mt-0.5 h-9 w-9 rounded-[10px] bg-white/[0.06] border border-white/[0.12] flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4 text-[#8BB2FF]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[#F2F2F4]">
                          Código por Correo
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-[#9A9AA2]">
                          OMEGA enviará un código de 6 dígitos a tu correo al iniciar sesión.
                        </p>
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="h-9.5 px-4 rounded-[10px] border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#C2C7D6] cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void handleContinueFromPicker()}
                      className="h-9.5 px-4 rounded-[10px] bg-[#2F6FED] hover:brightness-110 text-[12.5px] font-medium text-white cursor-pointer disabled:opacity-50"
                    >
                      {loading ? 'Preparando...' : 'Continuar'}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2A: Authenticator QR + Manual Key + 6-digit OTP */}
              {modalStep === 'totp' && totpSetup && (
                <form onSubmit={handleConfirmOtp} className="space-y-4">
                  <div className="pr-8">
                    <h3 className="text-[17px] font-semibold tracking-[-0.015em]">
                      Configurar con App Autenticadora
                    </h3>
                    <p className="mt-1 text-[12px] text-[#9A9AA2]">
                      Escanea el QR con Google Authenticator, Authy o Microsoft Authenticator.
                    </p>
                  </div>

                  {/* QR Viewfinder with 4 cobalt corner brackets & scan glow */}
                  <div className="relative mx-auto w-fit p-3.5">
                    <span className="absolute top-0 left-0 h-5 w-5 border-t-2 border-l-2 border-[#2F6FED] rounded-tl-[6px]" />
                    <span className="absolute top-0 right-0 h-5 w-5 border-t-2 border-r-2 border-[#2F6FED] rounded-tr-[6px]" />
                    <span className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-[#2F6FED] rounded-bl-[6px]" />
                    <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-[#2F6FED] rounded-br-[6px]" />
                    <div className="relative overflow-hidden rounded-[12px] bg-white p-2 shadow-[0_12px_36px_rgba(47,111,237,0.28)]">
                      <img
                        src={totpSetup.qrDataUrl}
                        alt="Código QR 2FA"
                        className="h-38 w-38 block select-none"
                        draggable={false}
                      />
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-10 bg-gradient-to-b from-[#2F6FED]/25 to-transparent border-t border-[#2F6FED]/80" />
                    </div>
                  </div>

                  {/* Manual secret copy */}
                  <div className="space-y-1.5">
                    <div className="text-[11.5px] text-[#9A9AA2]">
                      Si no puedes escanear el QR, ingresa esta clave manualmente:
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-[10px] border border-white/[0.09] bg-[#0A0A0C]/85 px-3 py-2 font-mono text-[12px] tracking-[0.06em] text-[#DCE6FF] select-all truncate">
                        {formatSecretGroups(totpSetup.secret)}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(totpSetup.secret, 'secret')}
                        aria-label="Copiar clave secreta"
                        className="h-9.5 w-9.5 rounded-[10px] border border-white/[0.10] bg-white/[0.05] hover:bg-white/[0.10] flex items-center justify-center text-[#DCE6FF] cursor-pointer shrink-0"
                      >
                        {copiedKey === 'secret' ? (
                          <Check className="h-4 w-4 text-[#30D158]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 6-digit confirmation boxes */}
                  <div className="space-y-2">
                    <div className="text-[12px] font-medium text-[#F2F2F4]">
                      Ingresa el código de 6 dígitos
                    </div>
                    {renderSixDigitBoxes()}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setModalStep('pick')}
                      className="h-9.5 px-3.5 rounded-[10px] border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#C2C7D6] cursor-pointer"
                    >
                      Atrás
                    </button>
                    <button
                      type="submit"
                      disabled={loading || codeInput.length < 6}
                      className="h-9.5 px-4 rounded-[10px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-50 text-[12.5px] font-medium text-white cursor-pointer"
                    >
                      {loading ? 'Verificando...' : 'Verificar y activar'}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 2B: Email OTP Confirmation */}
              {modalStep === 'email' && (
                <form onSubmit={handleConfirmOtp} className="space-y-4">
                  <div className="pt-1 text-center space-y-2">
                    <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2F6FED]/40 bg-gradient-to-b from-[#2F6FED]/25 to-[#0A0A0C]/80 shadow-[0_8px_28px_rgba(47,111,237,0.32)]">
                      <Mail className="h-6 w-6 text-[#8BB2FF]" />
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#2F6FED] text-[10px] font-bold text-white">
                        Ω
                      </span>
                    </div>
                    <h3 className="text-[17px] font-semibold">Revisa tu correo</h3>
                    <p className="text-[12px] text-[#9A9AA2]">
                      Enviamos un código de 6 dígitos a{' '}
                      <span className="text-[#F2F2F4] font-medium">{authSession?.email}</span>.
                    </p>
                  </div>

                  {renderSixDigitBoxes()}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setModalStep('pick')}
                      className="h-9.5 px-3.5 rounded-[10px] border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#C2C7D6] cursor-pointer"
                    >
                      Atrás
                    </button>
                    <button
                      type="submit"
                      disabled={loading || codeInput.length < 6}
                      className="h-9.5 px-4 rounded-[10px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-50 text-[12.5px] font-medium text-white cursor-pointer"
                    >
                      {loading ? 'Activando...' : 'Confirmar y activar'}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: Backup Recovery Codes */}
              {modalStep === 'codes' && (
                <div className="space-y-4">
                  <div className="pr-8">
                    <h3 className="text-[17px] font-semibold">
                      Guarda tus códigos de recuperación
                    </h3>
                    <p className="mt-1 text-[12px] text-[#9A9AA2]">
                      Si pierdes acceso a tu método principal, puedes entrar con uno de estos códigos. Cada código se usa una sola vez.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-[14px] border border-white/[0.09] bg-[#0A0A0C]/85 p-3.5">
                    {backupCodes.map((code) => (
                      <div
                        key={code}
                        className="rounded-[8px] border border-white/[0.06] bg-[#141418] py-2 text-center font-mono text-[13px] tracking-[0.06em] text-[#DCE6FF]"
                      >
                        {code}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(backupCodes.join('\n'), 'backup')}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] border border-white/[0.10] bg-white/[0.05] hover:bg-white/[0.10] text-[12px] text-[#F2F2F4] cursor-pointer"
                      >
                        {copiedKey === 'backup' ? (
                          <Check className="h-3.5 w-3.5 text-[#30D158]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedKey === 'backup' ? 'Copiados' : 'Copiar'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={downloadBackupCodes}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] border border-white/[0.10] bg-white/[0.05] hover:bg-white/[0.10] text-[12px] text-[#F2F2F4] cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Descargar .txt</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setModalStep('success')}
                      className="h-9 px-4 rounded-[9px] bg-[#2F6FED] hover:brightness-110 text-[12.5px] font-medium text-white cursor-pointer"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: Success Confirmation */}
              {modalStep === 'success' && (
                <div className="py-3 text-center space-y-4">
                  <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-[#2F6FED]/50 bg-gradient-to-b from-[#2F6FED]/35 via-[#2F6FED]/15 to-[#0A0A0C]/90 shadow-[0_12px_40px_rgba(47,111,237,0.42),inset_0_1px_0_rgba(255,255,255,0.22)]">
                    <ShieldCheck className="h-10 w-10 text-[#9CC0FF]" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[18px] font-semibold">
                      ¡Verificación en dos pasos activada!
                    </h3>
                    <p className="text-[12.5px] text-[#9A9AA2]">
                      Tu cuenta ahora está protegida con{' '}
                      <span className="text-[#F2F2F4] font-medium">
                        {activatedMethod === 'EMAIL' ? 'Código por Correo' : 'App Autenticadora (TOTP)'}
                      </span>
                      .
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInfoMsg('Verificación en dos pasos activada correctamente.');
                      closeModal();
                    }}
                    className="h-10 px-6 rounded-[10px] bg-[#2F6FED] hover:brightness-110 text-[13px] font-medium text-white cursor-pointer"
                  >
                    Listo
                  </button>
                </div>
              )}

              {/* DISABLE 2FA */}
              {modalStep === 'disable' && (
                <form onSubmit={handleDisableMfa} className="space-y-4">
                  <div className="pr-8">
                    <h3 className="text-[17px] font-semibold">Desactivar 2FA</h3>
                    <p className="mt-1 text-[12px] text-[#9A9AA2]">
                      Confirma tu contraseña actual para desactivar la verificación en dos pasos.
                    </p>
                  </div>
                  <div className="relative flex items-center">
                    <KeyRound className="h-3.5 w-3.5 text-[#9A9AA2] absolute left-3.5 pointer-events-none" />
                    <input
                      type="password"
                      value={disablePwd}
                      onChange={(e) => setDisablePwd(e.target.value)}
                      placeholder="Tu contraseña actual"
                      className="w-full h-10 pl-9.5 pr-3.5 rounded-[10px] bg-[#0A0A0C]/85 border border-white/[0.12] text-[13px] text-[#F2F2F4] focus:outline-none focus:border-[#FF453A]"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="h-9.5 px-3.5 rounded-[10px] border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#C2C7D6] cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-9.5 px-4 rounded-[10px] bg-[#FF453A] hover:brightness-110 disabled:opacity-50 text-[12.5px] font-medium text-white cursor-pointer"
                    >
                      {loading ? 'Desactivando...' : 'Confirmar y desactivar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
