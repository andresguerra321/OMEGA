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
    if (!apiOnline) return 'bg-[#2F6FED]';
    if (pcVerdict === 'alert' || pcVerdict === 'suspicious' || pcVerdict === 'high') {
      return 'bg-[#EF4444]';
    }
    if (pcVerdict === 'warning' || pcVerdict === 'watch') return 'bg-[#2F6FED]';
    return 'bg-[#22C55E]';
  }
  if (id === 'equipo' && usbConnected) {
    return 'bg-[#2F6FED]';
  }
  if (id === 'preguntar' && isLoadingChat) {
    return 'bg-[#2F6FED] omega-core-pulse';
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
      className={`roam-pill-nav inline-flex items-center rounded-[14px] p-1 select-none ${
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
                className="mx-1 h-4 w-px bg-white/[0.1] shrink-0"
              />
            )}

            <button
              type="button"
              onClick={() => onSelectNav(item.id)}
              aria-label={item.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
              title={item.ariaLabel}
              className={`group relative flex flex-col items-center justify-center rounded-[10px] transition-[transform,background-color,color,width,box-shadow] duration-150 ease-kowalski cursor-pointer active:scale-[0.95] ${
                compact
                  ? isActive
                    ? 'h-8 w-12'
                    : 'h-8 w-8'
                  : isActive
                    ? 'h-8 w-12 xl:h-9 xl:w-16'
                    : 'h-8 w-8 xl:h-9 xl:w-10'
              } ${
                isActive
                  ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] border border-[#2F6FED]/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_24px_rgba(47,111,237,0.25)]'
                  : 'bg-transparent text-[#9A9AA2] border border-transparent hover:bg-white/[0.06] hover:text-[#F2F2F4]'
              }`}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={isActive ? 2.1 : 1.75} />

              {/* Subrayado discreto de estado activo en único azul principal */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="mt-1 h-[2px] w-4 rounded-full bg-[#2F6FED] shadow-[0_0_8px_rgba(47,111,237,0.7)]"
                />
              )}

              {ledClass && (
                <span
                  aria-hidden="true"
                  className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${ledClass}`}
                />
              )}

              {/* Tooltip flotante discreto */}
              <span
                role="tooltip"
                className="apple-tooltip pointer-events-none opacity-0 scale-95 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150 ease-kowalski origin-top absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium text-[#F2F2F4]"
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
