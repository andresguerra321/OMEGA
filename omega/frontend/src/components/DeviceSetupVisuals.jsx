import { useState } from 'react';
import {
  AlertTriangle,
  Cable,
  Check,
  Laptop,
  LockOpen,
  ShieldCheck,
  Smartphone,
  Usb,
} from 'lucide-react';

const ANDROID_BUILD_LABELS = {
  generic: {
    header: 'Ajustes · Acerca del teléfono',
    rowTitle: 'Número de compilación',
  },
  samsung: {
    header: 'Ajustes · Información de software',
    rowTitle: 'Número de compilación',
  },
  xiaomi: {
    header: 'Ajustes · Sobre el teléfono',
    rowTitle: 'Versión de MIUI / HyperOS',
  },
};

/**
 * Mockups interactivos de pantalla móvil en tamaño legible para guiar al usuario
 * paso a paso sin usar miniaturas SVG pequeñas.
 */
export function AndroidStepVisual({ step, brand = 'generic' }) {
  const [tapCount, setTapCount] = useState(0);
  const unlocked = tapCount >= 7;
  const labels = ANDROID_BUILD_LABELS[brand] || ANDROID_BUILD_LABELS.generic;

  if (step === 1) {
    return (
      <div className="w-full max-w-[340px] space-y-2">
        <div
          role="region"
          aria-label="Mockup interactivo de Ajustes Android"
          className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
        >
          <div className="flex items-center justify-between text-[11px] font-tech text-[#9A9AA2] border-b border-white/[0.06] pb-2">
            <span className="truncate">{labels.header}</span>
            <span className="text-[#F2F2F4] shrink-0">{tapCount}/7</span>
          </div>

          <button
            type="button"
            onClick={() => setTapCount((c) => (c >= 7 ? 0 : c + 1))}
            className={`w-full rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              unlocked
                ? 'border-emerald-400/35 bg-emerald-400/10'
                : 'border-[#2F6FED]/45 bg-[#2F6FED]/10 hover:bg-[#2F6FED]/15'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {!unlocked && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2F6FED] opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      unlocked ? 'bg-emerald-400' : 'bg-[#2F6FED]'
                    }`}
                  />
                </span>
                <span className="text-xs font-semibold text-[#F2F2F4] truncate">
                  {labels.rowTitle}
                </span>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium shrink-0 ${
                  unlocked
                    ? 'bg-emerald-400/15 text-emerald-400'
                    : 'bg-[#2F6FED] text-white'
                }`}
              >
                {unlocked ? 'Desbloqueado' : `Toca 7 veces (${tapCount}/7)`}
              </span>
            </div>
          </button>

          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#F2F2F4]">
                Depuración USB
              </div>
              <div className="text-[11px] text-[#9A9AA2]">
                {unlocked ? 'Activada para OMEGA' : 'Se activa al tocar 7 veces'}
              </div>
            </div>
            <span
              aria-label={unlocked ? 'Depuración USB activada' : 'Depuración USB desactivada'}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                unlocked ? 'bg-emerald-400' : 'bg-white/15'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  unlocked ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          {unlocked
            ? 'Así se verá en tu celular cuando el permiso esté listo.'
            : 'Haz clic en la fila resaltada para simular los 7 toques.'}
        </p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="w-full max-w-[340px] space-y-2">
        <div
          role="region"
          aria-label="Mockup de notificación USB en Android"
          className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-tech text-[#9A9AA2] border-b border-white/[0.06] pb-2">
            <Usb className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
            <span>Sistema Android · Usar USB para</span>
          </div>

          <div className="space-y-2">
            <div className="rounded-xl border border-[#2F6FED]/50 bg-[#2F6FED]/12 px-3 py-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#F2F2F4]">
                Transferencia de archivos / MTP
              </span>
              <span className="h-5 w-5 rounded-full bg-[#2F6FED] text-white inline-flex items-center justify-center shrink-0">
                <Check className="h-3 w-3" strokeWidth={2.2} />
              </span>
            </div>

            <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-xs text-[#9A9AA2]">Solo carga</span>
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-400">
                <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                Evitar
              </span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          Selecciona Transferencia de archivos para que el cable transmita datos.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[340px] space-y-2">
      <div
        role="region"
        aria-label="Mockup de autorización USB en Android"
        className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
      >
        <div className="space-y-1">
          <div className="text-sm font-semibold text-[#F2F2F4]">
            ¿Permitir depuración USB?
          </div>
          <p className="text-xs text-[#9A9AA2]">
            La huella RSA de este equipo solicita acceso temporal.
          </p>
        </div>

        <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3 py-2 flex items-center gap-2.5">
          <span className="h-4 w-4 rounded bg-[#2F6FED] text-white inline-flex items-center justify-center shrink-0">
            <Check className="h-3 w-3" strokeWidth={2.4} />
          </span>
          <span className="text-xs text-[#F2F2F4]">
            Permitir siempre desde esta computadora
          </span>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="px-3 py-1.5 rounded-lg text-xs text-[#9A9AA2]">
            Cancelar
          </span>
          <span className="relative inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] px-3.5 py-1.5 text-xs font-semibold text-white">
            <span className="animate-ping absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#2F6FED] opacity-75" />
            <span>Aceptar</span>
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        Así se verá en tu celular cuando el permiso esté listo para autorizar.
      </p>
    </div>
  );
}

export function IosStepVisual({ step }) {
  if (step === 1) {
    return (
      <div className="w-full max-w-[340px] space-y-2">
        <div
          role="region"
          aria-label="Mockup de iPhone desbloqueado"
          className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
        >
          <div className="flex items-center justify-between text-[11px] font-tech text-[#9A9AA2] border-b border-white/[0.06] pb-2">
            <span>iPhone / iPad</span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <LockOpen className="h-3 w-3" strokeWidth={1.75} />
              Desbloqueado
            </span>
          </div>

          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3 flex items-center gap-3">
            <span className="h-9 w-9 rounded-xl bg-emerald-400/12 border border-emerald-400/30 text-emerald-400 inline-flex items-center justify-center shrink-0">
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#F2F2F4]">
                Pantalla de inicio activa
              </div>
              <div className="text-[11px] text-[#9A9AA2]">
                Listo para iniciar emparejamiento seguro
              </div>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          Mantén el iPhone encendido y desbloqueado antes de conectar el cable.
        </p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="w-full max-w-[340px] space-y-2">
        <div
          role="region"
          aria-label="Mockup de conexión directa por cable en iOS"
          className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
        >
          <div className="flex items-center justify-between text-[11px] font-tech text-[#9A9AA2] border-b border-white/[0.06] pb-2">
            <span>Conexión directa</span>
            <span className="text-emerald-400">Lightning / USB-C</span>
          </div>

          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[#F2F2F4]">
              <Laptop className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
              <span>PC</span>
            </div>
            <Cable className="h-4 w-4 text-emerald-400" strokeWidth={1.75} />
            <div className="flex items-center gap-2 text-xs text-[#F2F2F4]">
              <Smartphone className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
              <span>iPhone</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center">
          Conecta el cable directo a la computadora evitando hubs de solo carga.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[340px] space-y-2">
      <div
        role="region"
        aria-label="Mockup de diálogo Confiar en iPhone"
        className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 space-y-3"
      >
        <div className="space-y-1 text-center">
          <div className="text-sm font-semibold text-[#F2F2F4]">
            ¿Confiar en esta computadora?
          </div>
          <p className="text-xs text-[#9A9AA2]">
            Tu configuración y datos serán accesibles solo en RAM mientras dure la revisión.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <span className="rounded-lg bg-[#141923]/75 border border-white/[0.05] py-2 text-center text-xs text-[#9A9AA2]">
            No confiar
          </span>
          <span className="relative rounded-lg bg-[#2F6FED] py-2 text-center text-xs font-semibold text-white">
            <span className="animate-ping absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#2F6FED] opacity-75" />
            Confiar
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        Pulsa Confiar e ingresa tu código de desbloqueo en el teléfono.
      </p>
    </div>
  );
}

export function PcStepVisual() {
  return (
    <div className="w-full max-w-[340px] space-y-2">
      <div className="w-full rounded-2xl bg-[#0B0E14] border border-white/10 p-4 flex items-center gap-3">
        <span className="h-9 w-9 rounded-xl bg-[#2F6FED]/15 border border-[#2F6FED]/35 text-[#2F6FED] inline-flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[#F2F2F4]">
            Inspección directa en RAM
          </div>
          <div className="text-[11px] text-[#9A9AA2]">
            Procesos WMI, sockets activos y persistencia
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 text-center">
        Lectura volátil sin modificar archivos ni escribir en disco.
      </p>
    </div>
  );
}
