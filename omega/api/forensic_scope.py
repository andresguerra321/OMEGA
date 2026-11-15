"""Alcance honesto RNF9 y mitigaciones reales a nivel de sistema operativo/plataforma."""

from __future__ import annotations

from typing import Any

OS_SCOPE_LIMITATION_NOTICE = (
    "Alcance RNF9 (espacio de usuario): ninguna aplicación en Java, Python o Electron puede interceptar ni "
    "bloquear en vivo exploits zero-click en el kernel, BlastDoor, CoreGraphics o baseband. "
    "'Sin coincidencias' significa ausencia de rastros en los artefactos analizados frente al catálogo vigente, "
    "no certifica inmunidad absoluta del dispositivo."
)


def get_platform_mitigations(platform_hint: str | None = None) -> list[dict[str, str]]:
    """Devuelve controles nativos de sistema operativo e identidad ante amenazas zero-click."""
    plat = str(platform_hint or "").strip().lower()
    items: list[dict[str, str]] = [
        {
            "id": "os_patches",
            "title": "Parches de seguridad del Sistema Operativo y apps críticas",
            "scope": "SO / Kernel / Parser de mensajería",
            "action": "Instalar de inmediato actualizaciones oficiales del sistema operativo, navegador y mensajería.",
            "url": "",
        },
        {
            "id": "credential_isolation",
            "title": "Aislamiento de cuentas y llaves FIDO2 / Passkeys",
            "scope": "Identidad y sesiones",
            "action": "Aislar cuentas sensibles, revocar tokens activos y migrar a llaves FIDO2/Passkeys en dispositivo confiable.",
            "url": "",
        },
    ]

    if plat in ("ios", "iphone", "ipad", "darwin", "macos"):
        items.insert(
            0,
            {
                "id": "apple_lockdown_mode",
                "title": "Modo de Aislamiento (Lockdown Mode) de Apple",
                "scope": "iOS / iPadOS / macOS (BlastDoor / CoreGraphics / WebKit)",
                "action": "Activar Modo de Aislamiento en Ajustes > Privacidad y seguridad si existe riesgo de spyware dirigido.",
                "url": "https://support.apple.com/en-us/105120",
            },
        )
    elif plat == "android":
        items.insert(
            0,
            {
                "id": "android_security_hardening",
                "title": "Parche Android mensual y cierre de depuración USB",
                "scope": "Android OS / Google Play Protect",
                "action": "Desactivar Depuración USB (ADB) al concluir el triaje, habilitar Play Protect y verificar nivel de parche mensual.",
                "url": "",
            },
        )
    else:
        items.insert(
            0,
            {
                "id": "host_fde_and_lockdown",
                "title": "Cifrado de disco completo y Lockdown Mode según plataforma",
                "scope": "Windows BitLocker / macOS FileVault & Lockdown Mode / Linux LUKS",
                "action": "Mantener activo el cifrado de disco completo (BitLocker/FileVault/LUKS), SmartScreen y Modo de Aislamiento en Apple.",
                "url": "https://support.apple.com/en-us/105120",
            },
        )

    return items


def format_clean_verdict_texts(cutoff_date: str | None) -> tuple[str, str]:
    """Construye etiqueta y justificación honesta cuando no hay coincidencias (RNF9)."""
    cutoff_label = str(cutoff_date).strip() if cutoff_date and str(cutoff_date).strip() else "sin fecha verificada"
    label = f"0 coincidencias contra catálogo con corte {cutoff_label}"
    rationale = (
        f"0 coincidencias detectadas frente al catálogo CTI público (corte {cutoff_label}) "
        "y sin anomalías conductuales ni firmas YARA en los artefactos revisados en RAM. "
        "Nota RNF9: esto indica ausencia de rastros observables en los artefactos analizados, "
        "pero ninguna herramienta en espacio de usuario puede garantizar inmunidad ni detectar por sí sola "
        "exploits zero-click activos en kernel, BlastDoor, CoreGraphics o baseband."
    )
    return label, rationale
