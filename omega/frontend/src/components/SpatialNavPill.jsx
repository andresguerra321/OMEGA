import {
  Home,
  Laptop,
  Layers,
  Link2,
  MessageSquare,
  Radar,
  Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'inicio', label: 'Inicio', ariaLabel: 'Inicio', icon: Home },
  { id: 'equipo', label: 'Equipos', ariaLabel: 'Revisar mi equipo', icon: Laptop },
  { id: 'enlace', label: 'Enlaces', ariaLabel: 'Verificar enlace', icon: Link2 },
  { id: 'amenazas', label: 'Amenazas', ariaLabel: 'Amenazas', icon: Layers },
  { id: 'exposicion', label: 'Exposición', ariaLabel: 'Mi exposición', icon: Radar },
  { id: 'preguntar', label: 'Asistente', ariaLabel: 'Preguntar', icon: MessageSquare, dividerBefore: true },
  { id: 'ajustes', label: 'Ajustes', ariaLabel: 'Ajustes', icon: Settings },
];

function getLedClass(id, { pcVerdict, usbConnected, apiOnline, isLoadingChat }) {
  if (id === 'inicio') {
    if (!apiOnline) return 'bg-[#3B82F6]';
    if (pcVerdict === 'alert' || pcVerdict === 'suspicious' || pcVerdict === 'high') {
      return 'bg-[#EF4444]';
    }
    if (pcVerdict === 'warning' || pcVerdict === 'watch') return 'bg-[#3B82F6]';
    return 'bg-[#22C55E]';
  }
  if (id === 'equipo' && usbConnected) {
    return 'bg-[#3B82F6]';
  }
  if (id === 'preguntar' && isLoadingChat) {
    return 'bg-[#3B82F6] omega-core-pulse';
  }
  return null;
}

export function SpatialNavPill({
  activeNav,
  onSelectNav,
  pcVerdict = null,
  usbConnected = false,
  apiOnline = true,
  isLoadingChat = false,
  compact = false,
}) {
  return (
    <nav
      aria-label="Navegación espacial OMEGA"
      className={`roam-pill-nav inline-flex items-center rounded-full p-1 select-none ${
        compact ? 'gap-0.5' : 'gap-1'
      }`}
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeNav === item.id;
        const ledClass = getLedClass(item.id, {
          pcVerdict,
          usbConnected,
          apiOnline,
          isLoadingChat,
        });

        return (
          <div key={item.id} className="inline-flex items-center">
            {item.dividerBefore && (
              <span
                aria-hidden="true"
                className="mx-1 h-4 w-px bg-white/[0.15] shrink-0"
              />
            )}

            <button
              type="button"
              onClick={() => onSelectNav(item.id)}
              aria-label={item.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
              title={item.ariaLabel}
              className={`group relative flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer active:scale-[0.94] ${
                compact ? 'h-8 w-8' : 'h-9 w-9'
              } ${
                isActive
                  ? 'bg-white text-[#090D16] shadow-[0_4px_12px_rgba(0,0,0,0.34)]'
                  : 'bg-white/[0.06] text-[#DCE4F2] hover:bg-[#1D4ED8]/35 hover:text-white'
              }`}
            >
              <Icon className="h-[16px] w-[16px]" strokeWidth={isActive ? 2.1 : 1.75} />

              {ledClass && (
                <span
                  aria-hidden="true"
                  className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ${
                    isActive ? 'ring-white' : 'ring-[#090D16]'
                  } ${ledClass}`}
                />
              )}

              {/* Tooltip flotante discreto */}
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-full border border-white/[0.14] bg-[#14181F]/95 px-2.5 py-0.5 text-[11px] font-medium text-[#F4F6FA] shadow-lg"
              >
                {item.label}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
