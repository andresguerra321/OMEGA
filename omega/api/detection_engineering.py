import re
from datetime import datetime, timezone

from cti_db import fetch_campaign_detection_bundle


def _sanitize_rule_name(name: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    clean = re.sub(r"_+", "_", clean).strip("_")
    if not clean or clean[0].isdigit():
        clean = f"Omega_{clean}"
    return f"Omega_CTI_{clean[:55]}"


def generate_yara_for_campaign(campaign_id: str) -> dict | None:
    """Genera una regla YARA defensiva trazable a partir de IOCs públicos de una campaña (RNF7)."""
    camp, iocs, cves, sources = fetch_campaign_detection_bundle(campaign_id)
    if not camp:
        return None

    rule_name = _sanitize_rule_name(camp["name"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_desc = camp["name"].replace('"', "'")

    string_defs = []
    idx = 1
    for ioc_type, val in iocs:
        if ioc_type in {"domain", "url", "ip", "process", "package", "email"}:
            escaped = val.replace("\\", "\\\\").replace('"', '\\"')
            string_defs.append(f'        $ioc_{ioc_type}_{idx} = "{escaped}" ascii wide nocase')
            idx += 1

    if not string_defs:
        string_defs.append('        $placeholder = "NO_STRING_IOCS_INDEXED_FOR_CAMPAIGN" ascii')

    sha256_list = [val for t, val in iocs if t == "sha256"]
    hash_comment = ""
    if sha256_list:
        hash_comment = "\n    // Hashes SHA-256 documentados:\n" + "\n".join(
            f"    // - {h}" for h in sha256_list[:15]
        )

    yara_code = f"""/*
 * Regla YARA Defensiva generada por Omega CTI
 * Propósito: Búsqueda de indicadores públicos en volcados forenses / memoria (RNF7)
 * Campaña: {safe_desc}
 */

rule {rule_name} {{
    meta:
        author = "Omega Defensive CTI Platform"
        date = "{today}"
        campaign = "{safe_desc}"
        spyware_family = "{camp['spyware_family']}"
        suspected_actor = "{camp['suspected_actor']}"
        cves = "{', '.join(cves) if cves else 'N/A'}"
        reference = "{sources[0] if sources else 'Corpus público CTI'}"
        tlp = "TLP:CLEAR"
{hash_comment}
    strings:
{chr(10).join(string_defs)}

    condition:
        any of ($ioc_*)
}}
"""

    return {
        "campaign_id": campaign_id,
        "campaign_name": camp["name"],
        "rule_name": rule_name,
        "filename": f"{rule_name.lower()}.yar",
        "ioc_count": len(iocs),
        "yara_rule": yara_code,
    }


def generate_mvt_triage_script(campaign_id: str) -> dict | None:
    """Genera un script Bash defensivo de solo lectura para ejecutar MVT localmente (RNF7)."""
    camp, iocs, _cves, _sources = fetch_campaign_detection_bundle(campaign_id)
    if not camp:
        return None

    stix_objects = []
    for idx, (ioc_type, val) in enumerate(iocs, start=1):
        pattern = None
        if ioc_type == "domain":
            pattern = f"[domain-name:value = '{val}']"
        elif ioc_type == "ip":
            pattern = f"[ipv4-addr:value = '{val}']"
        elif ioc_type == "url":
            pattern = f"[url:value = '{val}']"
        elif ioc_type == "sha256":
            pattern = f"[file:hashes.'SHA-256' = '{val}']"
        elif ioc_type == "process":
            pattern = f"[process:name = '{val}']"

        if pattern:
            stix_objects.append(
                f'{{"type": "indicator", "spec_version": "2.1", "id": "indicator--00000000-0000-4000-8000-{idx:012d}", '
                f'"pattern": "{pattern}", "pattern_type": "stix"}}'
            )

    stix_bundle = (
        '{\n  "type": "bundle",\n  "id": "bundle--omega-cti-defensive",\n  "objects": [\n    '
        + ",\n    ".join(stix_objects)
        + "\n  ]\n}"
    )

    slug = _sanitize_rule_name(camp["name"]).lower()
    script_sh = f"""#!/usr/bin/env bash
# ==============================================================================
# Omega CTI — Script Defensivo de Extracción Local con Mobile Verification Toolkit
# Campaña: {camp["name"]} ({camp["spyware_family"]})
# Alcance Ético (RNF7): Ejecutar EXCLUSIVAMENTE sobre dispositivos propios con
# autorización explícita del titular. No realiza modificaciones en el dispositivo.
# ==============================================================================

set -euo pipefail

OUTPUT_DIR="./omega_mvt_evidence_$(date +%Y%m%d_%H%M%S)"
STIX_FILE="$OUTPUT_DIR/{slug}_indicators.stix2"

mkdir -p "$OUTPUT_DIR"

cat << 'EOF' > "$STIX_FILE"
{stix_bundle}
EOF

echo "[+] Indicadores STIX2 exportados en: $STIX_FILE"
echo "[+] Para analizar un respaldo de iPhone (previamente desencriptado con mvt-ios decrypt-backup):"
echo "    mvt-ios check-backup --iocs \\"$STIX_FILE\\" --output \\"$OUTPUT_DIR/ios_results\\" /ruta/al/backup_desencriptado"
echo ""
echo "[+] Para analizar un dispositivo Android vía ADB (solo lectura):"
echo "    mvt-android check-adb --iocs \\"$STIX_FILE\\" --output \\"$OUTPUT_DIR/android_results\\""
echo ""
echo "[+] Una vez finalizado, carga los archivos JSON resultantes (sms.json, safari_history.json, shutdown_log.json, timeline.json)"
echo "    en el Triage Paralelo de Omega para correlacionar hallazgos en memoria volátil (RNF4)."
"""

    return {
        "campaign_id": campaign_id,
        "campaign_name": camp[0],
        "filename": f"triage_{slug}.sh",
        "ioc_count": len(stix_objects),
        "script_content": script_sh,
    }

