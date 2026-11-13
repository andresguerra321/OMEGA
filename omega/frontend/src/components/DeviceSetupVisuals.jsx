/**
 * Ilustraciones vectoriales paso a paso estilo Apple Obsidian para guiar a usuarios
 * no técnicos al conectar Android o preparar un diagnóstico/respaldo en iPhone.
 */

export function AndroidStepVisual({ step, adbReady = false }) {
  if (step === 1) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Activar opciones de desarrollador y depuración USB en Android">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        {/* Marco de teléfono */}
        <rect x="46" y="7" width="128" height="90" rx="14" fill="#14141A" stroke="rgba(255,255,255,0.14)" />
        <circle cx="110" cy="14" r="2" fill="#3A3A42" />
        {/* Lista Ajustes */}
        <text x="58" y="27" fill="#8E8E93" fontSize="6.5" fontFamily="system-ui, sans-serif">
          Acerca del teléfono
        </text>
        {/* Fila resaltada: Número de compilación (tocar 7 veces) */}
        <rect x="54" y="32" width="112" height="21" rx="5" fill="rgba(47,111,237,0.16)" stroke="rgba(138,180,255,0.45)" strokeWidth="0.9" />
        <text x="60" y="45" fill="#F5F5F7" fontSize="7" fontWeight="600" fontFamily="system-ui, sans-serif">
          N.º de compilación
        </text>
        <rect x="139" y="37" width="22" height="11" rx="5.5" fill="#2F6FED" />
        <text x="150" y="44.5" textAnchor="middle" fill="#FFFFFF" fontSize="6.5" fontWeight="700" fontFamily="system-ui, sans-serif">
          ×7
        </text>
        {/* Fila inferior: Interruptor Depuración USB ON */}
        <rect x="54" y="59" width="112" height="24" rx="5" fill="rgba(255,255,255,0.035)" />
        <text x="60" y="73.5" fill="#E5E5EA" fontSize="7" fontFamily="system-ui, sans-serif">
          Depuración USB
        </text>
        <rect x="136" y="65.5" width="24" height="11" rx="5.5" fill="#30D158" />
        <circle cx="154" cy="71" r="4.2" fill="#FFFFFF" />
      </svg>
    );
  }

  if (step === 2) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Conector en computadora y cable USB hacia el teléfono">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        {/* Laptop / PC */}
        <rect x="20" y="23" width="58" height="39" rx="5" fill="#16161D" stroke="rgba(255,255,255,0.16)" />
        <rect x="14" y="63" width="70" height="5" rx="2.5" fill="#25252E" />
        <rect x="27" y="31" width="44" height="23" rx="3" fill={adbReady ? 'rgba(48,209,88,0.14)' : 'rgba(47,111,237,0.16)'} />
        <text x="49" y="45" textAnchor="middle" fill={adbReady ? '#30D158' : '#8AB4FF'} fontSize="7" fontWeight="600" fontFamily="system-ui, sans-serif">
          {adbReady ? 'PC listo ✓' : 'Conector PC'}
        </text>
        {/* Cable USB */}
        <line x1="82" y1="44" x2="146" y2="44" stroke={adbReady ? '#30D158' : '#2F6FED'} strokeWidth="2" strokeDasharray={adbReady ? 'none' : '4 3'} />
        <rect x="101" y="36" width="26" height="15" rx="7.5" fill="#181820" stroke="rgba(255,255,255,0.15)" />
        <text x="114" y="46" textAnchor="middle" fill="#D1D1D6" fontSize="6.5" fontWeight="600" fontFamily="system-ui, sans-serif">
          USB
        </text>
        {/* Teléfono */}
        <rect x="150" y="18" width="46" height="68" rx="9" fill="#16161D" stroke="rgba(255,255,255,0.18)" />
        <rect x="156" y="26" width="34" height="52" rx="4" fill="#0E0E13" />
        <text x="173" y="49" textAnchor="middle" fill="#E5E5EA" fontSize="6.2" fontFamily="system-ui, sans-serif">
          Transferir
        </text>
        <text x="173" y="58" textAnchor="middle" fill="#8AB4FF" fontSize="6.2" fontFamily="system-ui, sans-serif">
          archivos
        </text>
        <text x="110" y="94" textAnchor="middle" fill="#8E8E93" fontSize="6.2" fontFamily="system-ui, sans-serif">
          Usa cable de datos (no solo de carga)
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Aceptar ventana de permiso en la pantalla del teléfono">
      <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
      {/* Ventana de diálogo Android */}
      <rect x="28" y="12" width="164" height="80" rx="11" fill="#16161E" stroke="rgba(255,255,255,0.16)" />
      <text x="40" y="29" fill="#F5F5F7" fontSize="7.8" fontWeight="600" fontFamily="system-ui, sans-serif">
        ¿Permitir conexión con esta PC?
      </text>
      <text x="40" y="40" fill="#8E8E93" fontSize="6.2" fontFamily="system-ui, sans-serif">
        Autoriza la revisión de seguridad de solo lectura.
      </text>
      {/* Casilla marcada */}
      <rect x="40" y="49" width="10" height="10" rx="2.5" fill="#2F6FED" />
      <path d="M42.3 54l2 2 3.5-4" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="55" y="56.5" fill="#D1D1D6" fontSize="6.5" fontFamily="system-ui, sans-serif">
        Confiar siempre en esta computadora
      </text>
      {/* Botones */}
      <text x="118" y="78" fill="#8E8E93" fontSize="6.8" fontFamily="system-ui, sans-serif">
        Cancelar
      </text>
      <rect x="148" y="66" width="36" height="17" rx="6" fill="#2F6FED" />
      <circle cx="166" cy="74.5" r="11" fill="none" stroke="rgba(138,180,255,0.55)" strokeWidth="1" />
      <text x="166" y="77" textAnchor="middle" fill="#FFFFFF" fontSize="7" fontWeight="600" fontFamily="system-ui, sans-serif">
        Permitir
      </text>
    </svg>
  );
}

export function IosStepVisual({ step }) {
  if (step === 1) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Generar archivo de diagnóstico en iPhone con botones o Ajustes">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        {/* iPhone con botones resaltados */}
        <rect x="14" y="11" width="60" height="82" rx="11" fill="#14141A" stroke="rgba(255,255,255,0.16)" />
        <rect x="35" y="16" width="18" height="4.5" rx="2.2" fill="#09090C" />
        {/* Botones laterales */}
        <rect x="10.5" y="28" width="3.5" height="11" rx="1.5" fill="#8AB4FF" />
        <rect x="10.5" y="43" width="3.5" height="11" rx="1.5" fill="#8AB4FF" />
        <rect x="74" y="34" width="3.5" height="15" rx="1.5" fill="#8AB4FF" />
        <text x="44" y="51" textAnchor="middle" fill="#F5F5F7" fontSize="6" fontWeight="600" fontFamily="system-ui, sans-serif">
          Vol+ · Vol-
        </text>
        <text x="44" y="61" textAnchor="middle" fill="#8AB4FF" fontSize="5.8" fontFamily="system-ui, sans-serif">
          + Lateral (1s)
        </text>
        {/* Ruta en Ajustes */}
        <rect x="85" y="14" width="121" height="76" rx="9" fill="#131319" stroke="rgba(255,255,255,0.1)" />
        <text x="94" y="28" fill="#8E8E93" fontSize="6.1" fontWeight="600" fontFamily="system-ui, sans-serif">
          O EN AJUSTES DEL IPHONE:
        </text>
        <rect x="93" y="34" width="105" height="14" rx="4" fill="rgba(255,255,255,0.04)" />
        <text x="99" y="43" fill="#E5E5EA" fontSize="6.3" fontFamily="system-ui, sans-serif">
          1. Privacidad y seguridad
        </text>
        <rect x="93" y="52" width="105" height="14" rx="4" fill="rgba(255,255,255,0.04)" />
        <text x="99" y="61" fill="#E5E5EA" fontSize="6.3" fontFamily="system-ui, sans-serif">
          2. Análisis y mejoras
        </text>
        <rect x="93" y="70" width="105" height="14" rx="4" fill="rgba(47,111,237,0.18)" stroke="rgba(138,180,255,0.4)" strokeWidth="0.8" />
        <text x="99" y="79" fill="#8AB4FF" fontSize="6.3" fontWeight="600" fontFamily="system-ui, sans-serif">
          3. Datos de análisis
        </text>
      </svg>
    );
  }

  if (step === 2) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Ventana de Confiar en esta computadora en iPhone">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        {/* Diálogo iOS */}
        <rect x="34" y="12" width="152" height="80" rx="12" fill="#17171F" stroke="rgba(255,255,255,0.16)" />
        <text x="110" y="31" textAnchor="middle" fill="#F5F5F7" fontSize="7.6" fontWeight="600" fontFamily="system-ui, sans-serif">
          ¿Confiar en esta computadora?
        </text>
        <text x="110" y="43" textAnchor="middle" fill="#8E8E93" fontSize="6.1" fontFamily="system-ui, sans-serif">
          Si conectas por cable para copia local,
        </text>
        <text x="110" y="52" textAnchor="middle" fill="#8E8E93" fontSize="6.1" fontFamily="system-ui, sans-serif">
          toca Confiar e ingresa tu código PIN.
        </text>
        <line x1="34" y1="65" x2="186" y2="65" stroke="rgba(255,255,255,0.09)" />
        <line x1="110" y1="65" x2="110" y2="92" stroke="rgba(255,255,255,0.09)" />
        <text x="72" y="81" textAnchor="middle" fill="#8E8E93" fontSize="7" fontFamily="system-ui, sans-serif">
          No confiar
        </text>
        <rect x="116" y="69" width="64" height="19" rx="6" fill="rgba(47,111,237,0.22)" />
        <text x="148" y="81" textAnchor="middle" fill="#8AB4FF" fontSize="7.2" fontWeight="700" fontFamily="system-ui, sans-serif">
          Confiar ✓
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Análisis en memoria sin guardar archivos privados">
      <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
      <rect x="26" y="14" width="168" height="76" rx="10" fill="rgba(47,111,237,0.07)" stroke="rgba(47,111,237,0.4)" strokeDasharray="4 3" />
      {/* Archivo sysdiagnose */}
      <rect x="52" y="26" width="116" height="24" rx="6" fill="#16161E" stroke="rgba(255,255,255,0.14)" />
      <circle cx="66" cy="38" r="6" fill="rgba(48,209,88,0.16)" />
      <path d="M63.5 38l1.8 1.8 3.2-3.5" fill="none" stroke="#30D158" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="77" y="36.5" fill="#F5F5F7" fontSize="6.8" fontWeight="600" fontFamily="system-ui, sans-serif">
        sysdiagnose.tar.gz / copia
      </text>
      <text x="77" y="45" fill="#8E8E93" fontSize="5.8" fontFamily="system-ui, sans-serif">
        Arrastra abajo o elige la carpeta
      </text>
      <rect x="58" y="59" width="104" height="18" rx="9" fill="rgba(48,209,88,0.12)" stroke="rgba(48,209,88,0.3)" />
      <text x="110" y="70.5" textAnchor="middle" fill="#30D158" fontSize="6.4" fontWeight="600" fontFamily="system-ui, sans-serif">
        Lectura temporal · 0 bytes guardados
      </text>
    </svg>
  );
}

export function PcStepVisual({ step }) {
  if (step === 1) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Inspección de conexiones de red externas de esta computadora">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        <rect x="24" y="20" width="64" height="44" rx="6" fill="#16161D" stroke="rgba(255,255,255,0.16)" />
        <rect x="16" y="65" width="80" height="5" rx="2.5" fill="#25252E" />
        <rect x="31" y="28" width="50" height="28" rx="3" fill="rgba(47,111,237,0.16)" />
        <text x="56" y="44.5" textAnchor="middle" fill="#8AB4FF" fontSize="7" fontWeight="600" fontFamily="system-ui, sans-serif">
          Red TCP
        </text>
        <line x1="94" y1="42" x2="136" y2="42" stroke="#2F6FED" strokeWidth="1.8" strokeDasharray="3 3" />
        <rect x="138" y="18" width="58" height="48" rx="8" fill="#14141A" stroke="rgba(138,180,255,0.35)" />
        <text x="167" y="38" textAnchor="middle" fill="#F5F5F7" fontSize="6.4" fontWeight="600" fontFamily="system-ui, sans-serif">
          CTI + YARA
        </text>
        <text x="167" y="49" textAnchor="middle" fill="#30D158" fontSize="6" fontFamily="system-ui, sans-serif">
          Candiru / Helios
        </text>
        <text x="110" y="88" textAnchor="middle" fill="#8E8E93" fontSize="6.2" fontFamily="system-ui, sans-serif">
          Solo conexiones externas activas (sin leer archivos personales)
        </text>
      </svg>
    );
  }

  if (step === 2) {
    return (
      <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Revisión de programas al inicio, WMI y procesos no firmados">
        <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
        <rect x="24" y="12" width="172" height="80" rx="9" fill="#14141A" stroke="rgba(255,255,255,0.14)" />
        <rect x="33" y="21" width="154" height="17" rx="4" fill="rgba(48,209,88,0.1)" />
        <text x="41" y="32" fill="#E5E5EA" fontSize="6.4" fontFamily="system-ui, sans-serif">
          ✓ Procesos en Temp / AppData y firma digital
        </text>
        <rect x="33" y="43" width="154" height="17" rx="4" fill="rgba(47,111,237,0.14)" />
        <text x="41" y="54" fill="#8AB4FF" fontSize="6.4" fontWeight="600" fontFamily="system-ui, sans-serif">
          ✓ Eventos ocultos WMI y Tareas Programadas
        </text>
        <rect x="33" y="65" width="154" height="17" rx="4" fill="rgba(255,255,255,0.04)" />
        <text x="41" y="76" fill="#D1D1D6" fontSize="6.4" fontFamily="system-ui, sans-serif">
          ✓ Llaves de inicio automático (Run)
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 220 104" className="w-full h-[80px]" role="img" aria-label="Verificación de escudos Windows Defender, Firewall y UAC">
      <rect x="1" y="1" width="218" height="102" rx="10" fill="#0B0B0E" stroke="rgba(255,255,255,0.08)" />
      <rect x="30" y="14" width="160" height="46" rx="9" fill="#16161E" stroke="rgba(48,209,88,0.28)" />
      <circle cx="51" cy="37" r="10" fill="rgba(48,209,88,0.16)" />
      <path d="M47 37l2.6 2.6 5.2-5.4" fill="none" stroke="#30D158" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="68" y="34" fill="#F5F5F7" fontSize="7" fontWeight="600" fontFamily="system-ui, sans-serif">
        Escudos del sistema
      </text>
      <text x="68" y="45" fill="#8E8E93" fontSize="6" fontFamily="system-ui, sans-serif">
        Defender · Firewall · UAC · SmartScreen
      </text>
      <rect x="52" y="69" width="116" height="18" rx="9" fill="rgba(48,209,88,0.12)" stroke="rgba(48,209,88,0.3)" />
      <text x="110" y="80.5" textAnchor="middle" fill="#30D158" fontSize="6.4" fontWeight="600" fontFamily="system-ui, sans-serif">
        Solo lectura · Sin modificar la PC
      </text>
    </svg>
  );
}

