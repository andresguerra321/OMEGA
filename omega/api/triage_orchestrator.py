import asyncio
import gc
import json
import os
import re
import sqlite3
from urllib.parse import urlparse

from behavioral_forensics import run_behavioral_forensics, unpack_forensic_archives_in_ram
from cti_db import lookup_iocs_detailed
from deep_forensics import (
    inspect_ios_manifest_db,
    parse_kernel_network_sockets,
    run_kernel_and_posture_forensics,
    run_live_yara_hunt,
)
from temporal_correlator import correlate_temporal_chains, inspect_mobile_profiles_and_certs
from yara_engine import get_yara_engine_status

DEFANG_RULES = [
    (re.compile(r"hxxps://", re.IGNORECASE), "https://"),
    (re.compile(r"hxxp://", re.IGNORECASE), "http://"),
    (re.compile(r"\[\.\]|\(\.\)|\{\.\}|\\\."), "."),
    (re.compile(r"\[:\]|\(:\)"), ":"),
]

URL_RE = re.compile(r"https?://[^\s\"'<>\]\)]+", re.IGNORECASE)
DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,15}\b", re.IGNORECASE)
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SHA256_RE = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)
PACKAGE_ID_RE = re.compile(r"\b(?:com|org|net|io|me|dev|info|biz|ru|rs|il)\.[a-z0-9_]+(?:\.[a-z0-9_]+){1,6}\b", re.IGNORECASE)
STAGING_PATH_RE = re.compile(r"(?:/private/var/tmp/|/private/var/logs/|/data/local/tmp/|/var/tmp/)[A-Za-z0-9._/\-]{1,120}")

# Procesos y servicios críticos asociados a cadenas zero-click (FORCEDENTRY, BLASTPASS, Pegasus)
KNOWN_CRASH_TARGETS = {
    "imtranscoderagent",
    "imagetranscoder",
    "blastpass",
    "imagent",
    "identityservicesd",
    "webkit",
    "mobilemail",
    "springboard",
}

NOISE_DOMAINS = {
    "apple.com",
    "icloud.com",
    "mzstatic.com",
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "android.com",
    "whatsapp.com",
    "whatsapp.net",
    "cloudflare.com",
    "akamai.net",
    "amazonaws.com",
}


def _refang(text: str) -> str:
    for pat, repl in DEFANG_RULES:
        text = pat.sub(repl, text)
    return text


def _root_domain(domain: str) -> str | None:
    parts = domain.lower().strip(".").split(".")
    if len(parts) < 3:
        return None
    root = ".".join(parts[-2:])
    return None if root in NOISE_DOMAINS else root


def _collect_tokens(text: str, origin: str, bucket: dict[str, dict]):
    clean = _refang(text)
    for u in URL_RE.findall(clean):
        u_low = u.lower()
        bucket.setdefault(u_low, {"type": "url", "origin": origin, "derived": False})
        host = (urlparse(u_low).hostname or "").lower()
        if host and host not in NOISE_DOMAINS:
            bucket.setdefault(host, {"type": "domain", "origin": origin, "derived": False})
            rd = _root_domain(host)
            if rd:
                bucket.setdefault(rd, {"type": "domain", "origin": f"{origin} (subdominio: {host})", "derived": True})

    for d in DOMAIN_RE.findall(clean):
        d_low = d.lower().rstrip(".")
        if d_low in NOISE_DOMAINS or any(d_low.endswith(f".{n}") for n in NOISE_DOMAINS):
            continue
        bucket.setdefault(d_low, {"type": "domain", "origin": origin, "derived": False})
        rd = _root_domain(d_low)
        if rd:
            bucket.setdefault(rd, {"type": "domain", "origin": f"{origin} (subdominio: {d_low})", "derived": True})

    for ip in IPV4_RE.findall(clean):
        if not ip.startswith(("127.", "10.", "192.168.", "0.")):
            bucket.setdefault(ip, {"type": "ip", "origin": origin, "derived": False})

    for sha in SHA256_RE.findall(clean):
        bucket.setdefault(sha.lower(), {"type": "sha256", "origin": origin, "derived": False})

    for pkg in PACKAGE_ID_RE.findall(clean):
        pkg_low = pkg.lower()
        if not any(pkg_low.endswith(f".{n}") or pkg_low == n for n in NOISE_DOMAINS):
            bucket.setdefault(pkg_low, {"type": "package", "origin": origin, "derived": False})

    for st_path in STAGING_PATH_RE.findall(clean):
        bucket.setdefault(st_path.lower().rstrip(".,;:\"'`)"), {"type": "file_path", "origin": origin, "derived": False})


# =====================================================================
# SUBAGENTE A: Respaldos de Mensajes (SMS/iMessage) y SQLite en RAM
# =====================================================================
def _worker_a_messaging_sqlite(artifacts: list[dict]) -> dict:
    tokens: dict[str, dict] = {}
    notes: list[str] = []
    processed_files = 0

    for art in artifacts:
        fname = art["filename"].lower()
        raw_bytes: bytes = art["bytes"]

        # Soporte binario SQLite en RAM (sms.db, History.db) sin tocar disco (RNF4)
        if raw_bytes[:16] == b"SQLite format 3\x00" or fname.endswith((".db", ".sqlite", ".sqlite3")):
            processed_files += 1
            try:
                mem_conn = sqlite3.connect(":memory:")
                mem_conn.deserialize(raw_bytes)
                cur = mem_conn.cursor()
                cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [r[0] for r in cur.fetchall()]

                extracted_rows = 0
                for tbl in tables:
                    if tbl.startswith("sqlite_"):
                        continue
                    cur.execute(f'SELECT * FROM "{tbl}" LIMIT 1500;')
                    for row in cur.fetchall():
                        row_str = " ".join(str(col) for col in row if isinstance(col, str) and len(col) > 4)
                        if row_str:
                            _collect_tokens(row_str, f"SQLite [{art['filename']}:{tbl}]", tokens)
                            extracted_rows += 1
                mem_conn.close()
                notes.append(f"SQLite '{art['filename']}' deserializado en RAM ({len(tables)} tablas, {extracted_rows} registros).")
            except Exception as exc:
                notes.append(f"SQLite '{art['filename']}' ilegible o cifrado ({exc}). Ejecute mvt-ios decrypt-backup primero.")
            continue

        # Archivos JSON/TXT de mensajes o historial web
        if any(k in fname for k in ("sms", "message", "chat", "whatsapp", "safari", "history", "browser")):
            processed_files += 1
            text = raw_bytes.decode("utf-8", errors="ignore")
            _collect_tokens(text, f"Mensajería/Web [{art['filename']}]", tokens)
            notes.append(f"Artefacto conversacional/web '{art['filename']}' analizado.")

    return {
        "agent_id": "subagent_a_messaging",
        "agent_name": "Subagente A — Mensajería, Historial Web y SQLite",
        "files_processed": processed_files,
        "tokens": tokens,
        "notes": notes,
    }


# =====================================================================
# SUBAGENTE B: Telemetría de Red, Logs DNS y Tráfico Saliente
# =====================================================================
def _worker_b_network_dns(artifacts: list[dict]) -> dict:
    tokens: dict[str, dict] = {}
    notes: list[str] = []
    processed_files = 0

    for art in artifacts:
        fname = art["filename"].lower()
        raw_bytes: bytes = art["bytes"]
        if raw_bytes[:16] == b"SQLite format 3\x00":
            continue

        if any(k in fname for k in ("dns", "net", "pcap", "traffic", "flow", "proxy", "conn", "timeline")):
            processed_files += 1
            text = raw_bytes.decode("utf-8", errors="ignore")
            _collect_tokens(text, f"Red/DNS [{art['filename']}]", tokens)
            notes.append(f"Telemetría de red/DNS '{art['filename']}' procesada.")

    return {
        "agent_id": "subagent_b_network",
        "agent_name": "Subagente B — Logs de Red, DNS y Tráfico Saliente",
        "files_processed": processed_files,
        "tokens": tokens,
        "notes": notes,
    }


# =====================================================================
# SUBAGENTE C: Procesos Activos, Shutdown.log y CrashLogs (.ips/.crash)
# =====================================================================
def _worker_c_process_crashlogs(artifacts: list[dict]) -> dict:
    tokens: dict[str, dict] = {}
    notes: list[str] = []
    crash_anomalies: list[str] = []
    processed_files = 0

    for art in artifacts:
        fname = art["filename"].lower()
        raw_bytes: bytes = art["bytes"]
        if raw_bytes[:16] == b"SQLite format 3\x00":
            continue

        is_proc_or_crash = any(
            k in fname for k in ("process", "shutdown", "crash", "ips", "package", "ps", "sysdiagnose", "test_mvt")
        )
        # Fallback: si un archivo no encajó en A ni B (y no es postura JSON/admin), Subagente C lo inspecciona
        is_posture_meta = "device_posture" in fname or "device_policy" in fname or "proc_net" in fname
        is_unclassified = not is_posture_meta and not any(
            k in fname
            for k in ("sms", "message", "chat", "whatsapp", "safari", "history", "browser", "dns", "net", "pcap", "traffic", "flow", "proxy", "conn", "timeline")
        )

        if is_proc_or_crash or is_unclassified:
            processed_files += 1
            text = raw_bytes.decode("utf-8", errors="ignore")
            _collect_tokens(text, f"Procesos/Crash [{art['filename']}]", tokens)

            # Extraer nombres de procesos de JSON (shutdown.log / packages.json) o texto plano
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    for entry in parsed:
                        if isinstance(entry, dict):
                            for p in entry.get("processes", []) or []:
                                base_p = str(p).split("/")[-1].strip().lower()
                                if base_p:
                                    tokens.setdefault(base_p, {"type": "process", "origin": f"Shutdown.log [{art['filename']}]", "derived": False})
                            pkg = str(entry.get("package_name") or "").strip().lower()
                            if pkg:
                                tokens.setdefault(pkg, {"type": "package", "origin": f"Packages [{art['filename']}]", "derived": False})
                        elif isinstance(entry, str) and len(entry) < 120:
                            tokens.setdefault(entry.strip().lower(), {"type": "process", "origin": f"Lista [{art['filename']}]", "derived": False})
            except json.JSONDecodeError:
                for line in text.splitlines():
                    clean_l = line.strip().lower()
                    if clean_l and " " not in clean_l and len(clean_l) < 100:
                        tokens.setdefault(clean_l, {"type": "process", "origin": f"Dump [{art['filename']}]", "derived": False})

            # Detección heurística de CrashLogs asociados a exploits zero-click
            low_text = text.lower()
            for target_proc in KNOWN_CRASH_TARGETS:
                if target_proc in low_text and ("exception type" in low_text or "crashed" in low_text or "exc_bad_access" in low_text):
                    crash_anomalies.append(
                        f"Crash detectado en servicio crítico '{target_proc}' dentro de '{art['filename']}' (vector típico de exploits zero-click)."
                    )

            notes.append(f"Artefacto de ejecución/sistema '{art['filename']}' analizado.")

    return {
        "agent_id": "subagent_c_processes",
        "agent_name": "Subagente C — Procesos Activos, Shutdown.log y CrashLogs",
        "files_processed": processed_files,
        "tokens": tokens,
        "crash_anomalies": crash_anomalies,
        "notes": notes,
    }


def _correlate_with_cti_db(tokens: dict[str, dict]) -> list[dict]:
    if not tokens:
        return []

    rows = lookup_iocs_detailed(list(tokens.keys()))
    matches = []
    for row in rows:
        val = row["ioc_value"]
        meta = tokens.get(val, {})
        matches.append(
            {
                **row,
                "match_precision": "Dominio Raíz Relacionado" if meta.get("derived") else "Exacto",
                "artifact_origin": meta.get("origin", "Artefacto"),
            }
        )
    return matches


def _diagnose_verdict(
    agent_reports: list[dict],
    crash_anomalies: list[str],
    host_signals: list[str] | None = None,
) -> dict:
    """Evalúa patrones multi-vectoriales para distinguir falsos positivos de infecciones reales."""
    active_agents_with_hits = [ag for ag in agent_reports if len(ag["matches"]) > 0]
    all_matches = [m for ag in agent_reports for m in ag["matches"]]
    exact_matches = [m for m in all_matches if m["match_precision"] == "Exacto"]
    families = sorted({m["spyware_family"] for m in all_matches if m["spyware_family"] != "Desconocida"})
    extra_signals = list(host_signals or [])
    all_host_anomalies = [*crash_anomalies, *extra_signals]

    # Caso 1: Sin coincidencias CTI ni anomalías críticas en host/logs
    if not all_matches and not all_host_anomalies:
        return {
            "verdict_code": "CLEAN",
            "verdict_label": "Sin Indicadores de Compromiso Conocidos",
            "confidence": "Alta",
            "is_likely_false_positive": False,
            "rationale": "Ninguno de los tres subagentes detectó indicadores asociados a campañas documentadas de spyware comercial ni anomalías de crash zero-click.",
            "recommended_actions": [
                "Mantener el sistema operativo y aplicaciones de mensajería actualizados.",
                "Activar el Modo de Aislamiento (Lockdown Mode) si el titular pertenece a un perfil de alto riesgo.",
            ],
        }

    # Caso 2: Patrón corroborado en múltiples capas (ej. Red + Mensajes o CTI Exacto + Señal Conductual/Kernel/YARA)
    if len(active_agents_with_hits) >= 2 or (len(exact_matches) >= 1 and len(all_host_anomalies) >= 1):
        signal_notes: list[str] = []
        if crash_anomalies:
            signal_notes.append(f"{len(crash_anomalies)} anomalía(s) conductuales/crash")
        if extra_signals:
            signal_notes.append(f"{len(extra_signals)} señal(es) de postura kernel/abuso/YARA")
        return {
            "verdict_code": "CORROBORATED_INFECTION_PATTERN",
            "verdict_label": "Patrón de Infección Correlacionado (Alta Prioridad)",
            "confidence": "Alta",
            "is_likely_false_positive": False,
            "rationale": (
                f"Se detectó convergencia de evidencia en {len(active_agents_with_hits)} vectores independientes "
                f"({', '.join(a['agent_name'] for a in active_agents_with_hits)})"
                + (f" junto con {' y '.join(signal_notes)}." if signal_notes else ".")
                + (f" Familias vinculadas: {', '.join(families)}." if families else "")
            ),
            "recommended_actions": [
                "Preservar una copia forense completa del dispositivo antes de reiniciarlo o restaurarlo.",
                "Aislar el dispositivo de redes Wi-Fi/celulares y rotar credenciales desde un equipo limpio.",
                "Escalar los hallazgos a un equipo especializado de Respuesta a Incidentes (CERT / Access Now Digital Security Helpline).",
            ],
        }

    # Caso 3: Coincidencia única aislada o anomalías sin IOCs conocidos
    only_derived = len(all_matches) > 0 and len(exact_matches) == 0
    if not active_agents_with_hits or len(all_matches) == 1 or only_derived:
        sample = all_matches[0] if all_matches else None
        reason_detail = (
            f"Coincidencia única en '{sample['ioc_value']}' ({sample['match_precision']}) detectada únicamente por {active_agents_with_hits[0]['agent_name']}, sin corroboración en procesos activos ni tráfico de red adicional."
            if sample and active_agents_with_hits
            else "Solo se observaron anomalías heurísticas en logs o CrashLogs sin coincidencias contra IOCs públicos conocidos."
        )
        return {
            "verdict_code": "LIKELY_FALSE_POSITIVE",
            "verdict_label": "Coincidencia Aislada — Posible Falso Positivo / Exposición Pasiva",
            "confidence": "Media",
            "is_likely_false_positive": True,
            "rationale": (
                f"{reason_detail} En análisis forense MVT, un enlace aislado en historial web o caché DNS suele deberse a navegación incidental, "
                "lectura de reportes periodísticos que citan dominios maliciosos o reutilización de infraestructura CDN."
            ),
            "recommended_actions": [
                "Exportar e incluir el registro de procesos activos (shutdown.log) y logs de red para descartar ejecución secundaria.",
                "Verificar si el usuario abrió artículos de prensa o repositorios CTI en la fecha registrada.",
            ],
        }

    # Caso 4: Múltiples IOCs exactos dentro de un mismo vector
    return {
        "verdict_code": "SUSPICIOUS_SINGLE_VECTOR",
        "verdict_label": "Actividad Sospechosa Concentrada en Un Vector",
        "confidence": "Media-Alta",
        "is_likely_false_positive": False,
        "rationale": (
            f"Se identificaron {len(exact_matches)} indicadores exactos dentro de {active_agents_with_hits[0]['agent_name']}. "
            "Se recomienda aportar artefactos de los otros subagentes (procesos/red) para confirmar persistencia."
        ),
        "recommended_actions": [
            "Ejecutar una extracción completa con mvt-ios / mvt-android incluyendo shutdown.log y timeline.json.",
            "Revisar las campañas vinculadas en el módulo de Dossiers de Omega para verificar CVEs aplicables a la versión del SO.",
        ],
    }


def _run_ios_manifests_in_ram(expanded_artifacts: list[dict]) -> list[dict]:
    """Deserializa archivos Manifest.db (y respaldos SQLite) en RAM para detectar artefactos iOS."""
    findings: list[dict] = []
    for art in expanded_artifacts:
        raw_bytes = art.get("bytes") or b""
        if len(raw_bytes) >= 16 and raw_bytes.startswith(b"SQLite format 3\x00"):
            findings.extend(inspect_ios_manifest_db(art.get("filename", "Manifest.db"), raw_bytes))
    return findings


def _inject_decoded_kernel_telemetries(expanded_artifacts: list[dict]) -> list[dict]:
    """Decodifica /proc/net/tcp* hex en RAM como texto visible para Subagente B y caza YARA."""
    raw_proc_chunks: list[str] = []
    for art in expanded_artifacts:
        fname = str(art.get("filename") or "").lower()
        if "proc_net" in fname or "net_tcp" in fname or "tcp_sockets" in fname:
            raw_bytes: bytes = art.get("bytes") or b""
            if raw_bytes:
                raw_proc_chunks.append(raw_bytes.decode("utf-8", errors="ignore"))

    if not raw_proc_chunks:
        return expanded_artifacts

    decoded_sockets = parse_kernel_network_sockets("\n".join(raw_proc_chunks))
    if not decoded_sockets:
        return expanded_artifacts

    lines = [f"{s['remote_ip']}:{s['remote_port']} ({s['state']})" for s in decoded_sockets]
    return [
        *expanded_artifacts,
        {
            "filename": "adb_live_net4_sockets.txt",
            "bytes": "\n".join(lines).encode("utf-8"),
        },
    ]


async def run_parallel_forensic_triage(artifacts: list[dict]) -> dict:
    """Capa 2 unificada: desempaqueta en RAM y ejecuta CTI, conductual, kernel/Manifest.db y YARA."""
    expanded_artifacts = await asyncio.to_thread(unpack_forensic_archives_in_ram, artifacts)

    try:
        expanded_artifacts = await asyncio.to_thread(_inject_decoded_kernel_telemetries, expanded_artifacts)

        res_a, res_b, res_c, behavioral_raw, manifest_findings, kernel_posture, yara_hits, temporal_res, profile_alerts = await asyncio.gather(
            asyncio.to_thread(_worker_a_messaging_sqlite, expanded_artifacts),
            asyncio.to_thread(_worker_b_network_dns, expanded_artifacts),
            asyncio.to_thread(_worker_c_process_crashlogs, expanded_artifacts),
            asyncio.to_thread(run_behavioral_forensics, expanded_artifacts),
            asyncio.to_thread(_run_ios_manifests_in_ram, expanded_artifacts),
            asyncio.to_thread(run_kernel_and_posture_forensics, expanded_artifacts),
            asyncio.to_thread(run_live_yara_hunt, expanded_artifacts),
            asyncio.to_thread(correlate_temporal_chains, expanded_artifacts),
            asyncio.to_thread(inspect_mobile_profiles_and_certs, expanded_artifacts),
        )

        # Fusionar hallazgos de Manifest.db, cadenas temporales y perfiles sin duplicados
        behavioral_anomalies = list(behavioral_raw)
        seen_anom = {
            (a.get("category"), str(a.get("indicator", "")).lower(), str(a.get("artifact", "")).lower())
            for a in behavioral_anomalies
        }
        for mf in (
            manifest_findings
            + temporal_res.get("temporal_anomalies", [])
            + [p for p in profile_alerts if not str(p.get("category", "")).startswith("ANDROID_")]
        ):
            key = (mf.get("category"), str(mf.get("indicator", "")).lower(), str(mf.get("artifact", "")).lower())
            if key not in seen_anom:
                seen_anom.add(key)
                behavioral_anomalies.append(mf)

        raw_agents = [res_a, res_b, res_c]
        agent_summaries = []
        total_unique_tokens = 0

        for ag in raw_agents:
            matches = await asyncio.to_thread(_correlate_with_cti_db, ag["tokens"])
            unique_count = len([v for v in ag["tokens"].values() if not v.get("derived")])
            total_unique_tokens += unique_count
            agent_summaries.append(
                {
                    "agent_id": ag["agent_id"],
                    "agent_name": ag["agent_name"],
                    "files_processed": ag["files_processed"],
                    "indicators_extracted": unique_count,
                    "matches_count": len(matches),
                    "matches": matches,
                    "notes": ag["notes"],
                }
            )

        crash_anomalies = list(res_c.get("crash_anomalies", []))
        for anom in behavioral_anomalies:
            summary_line = f"[{anom['severity']}] {anom['category']} ({anom['artifact']}): {anom['indicator']} — {anom['detail']}"
            if summary_line not in crash_anomalies:
                crash_anomalies.append(summary_line)

        hardening_checks = kernel_posture.get("hardening_checks", [])
        abuse_alerts = list(kernel_posture.get("abuse_alerts", [])) + [
            p for p in profile_alerts if p.get("category", "").startswith("ANDROID_")
        ]
        live_sockets = kernel_posture.get("live_sockets", [])
        cached_dns_domains = kernel_posture.get("cached_dns_domains", [])

        critical_posture = [c for c in hardening_checks if c.get("status") == "CRITICAL"] + [
            a for a in abuse_alerts if a.get("severity") == "CRITICAL"
        ]
        host_signals = (
            [f"[YARA] {y['rule_name']} ({y.get('family', 'Spyware')})" for y in yara_hits]
            + [f"[ABUSE:{a.get('severity', 'HIGH')}] {a.get('category')}: {a.get('indicator')}" for a in abuse_alerts]
            + [f"[POSTURE CRITICAL] {c.get('control')}: {c.get('value')}" for c in hardening_checks if c.get("status") == "CRITICAL"]
        )

        diagnosis = _diagnose_verdict(agent_summaries, crash_anomalies, host_signals=host_signals)
        critical_behavioral = [a for a in behavioral_anomalies if a.get("severity") == "CRITICAL"]
        total_cti_matches = sum(a["matches_count"] for a in agent_summaries)

        if total_cti_matches == 0 and (critical_behavioral or yara_hits or critical_posture) and diagnosis.get("verdict_code") in (
            "CLEAN",
            "LIKELY_FALSE_POSITIVE",
        ):
            previews = list(dict.fromkeys(a["category"] for a in critical_behavioral[:3]))
            for yh in yara_hits[:2]:
                if yh["rule_name"] not in previews:
                    previews.append(yh["rule_name"])
            for cp in critical_posture[:2]:
                label = cp.get("category") or cp.get("control")
                if label and label not in previews:
                    previews.append(label)
            categories_preview = ", ".join(previews)
            diagnosis = {
                "verdict_code": "BEHAVIORAL_ZERO_DAY_SUSPICION",
                "verdict_label": "Detección Forense Crítica — Firma YARA / Anomalía en RAM",
                "confidence": "Alta",
                "is_likely_false_positive": False,
                "rationale": (
                    f"El motor en RAM detectó {len(critical_behavioral) + len(critical_posture)} señal(es) crítica(s) "
                    f"y {len(yara_hits)} coincidencia(s) YARA ({categories_preview}). "
                    "Este patrón sugiere persistencia o vector de explotación activo."
                ),
                "recommended_actions": [
                    "Preservar el respaldo completo (sysdiagnose y dump MVT) sin reiniciar ni restaurar el dispositivo.",
                    "Activar Modo de Aislamiento (Lockdown Mode) o DNS cifrado DoT y rotar credenciales desde un dispositivo limpio.",
                    "Escalar la evidencia conductual/YARA a un equipo forense especializado (CERT / Citizen Lab / Amnesty Tech).",
                ],
            }

        total_files = len(expanded_artifacts)
    finally:
        # Garantía RNF4: limpiar explícitamente todos los buffers en memoria volátil
        for art in expanded_artifacts:
            art["bytes"] = b""
        expanded_artifacts.clear()
        for src_art in artifacts:
            src_art["bytes"] = b""
        artifacts.clear()
        gc.collect()

    return {
        "pipeline_mode": "Unified In-RAM Triage (CTI + Behavioral + Kernel/Manifest.db + YARA)",
        "total_files": total_files,
        "total_indicators_analyzed": total_unique_tokens,
        "total_matches": total_cti_matches,
        "crash_anomalies": crash_anomalies,
        "behavioral_anomalies": behavioral_anomalies,
        "manifest_findings": manifest_findings,
        "yara_hits": yara_hits,
        "device_summary": kernel_posture.get("device_summary", {}),
        "hardening_checks": hardening_checks,
        "abuse_alerts": abuse_alerts,
        "live_sockets": live_sockets[:40],
        "live_sockets_total": len(live_sockets),
        "cached_dns_count": len(cached_dns_domains),
        "cached_dns_sample": cached_dns_domains[:25],
        "timeline": temporal_res.get("timeline", []),
        "timeline_summary": temporal_res.get("timeline_summary", {}),
        "yara_engine": get_yara_engine_status(),
        "diagnosis": diagnosis,
        "subagents": agent_summaries,
        "ephemeral_notice": "Triage paralelo, análisis conductual/kernel, Manifest.db y caza YARA ejecutados 100% en memoria volátil (RAM) sin persistencia en disco (RNF4).",
    }

