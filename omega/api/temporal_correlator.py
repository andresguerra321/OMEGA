"""Motor de correlación temporal multi-artefacto y auditoría extendida de perfiles/PKI en RAM.

Normaliza marcas de tiempo dispares de iOS/Android (ISO-8601, Apple Cocoa CoreData
+978307200, nanosegundos iMessage, Unix ms/s y logs .ips) para reconstruir una línea
de tiempo unificada y detectar cadenas zero-click desconocidas (disparador -> crash
de memoria -> ejecución volátil / pico de red / reinicio).
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import json
import plistlib
import re
import sqlite3
from typing import Any

COCOA_EPOCH_OFFSET = 978307200.0
MIN_VALID_EPOCH = 1420070400.0  # 2015-01-01
MAX_VALID_EPOCH = 1956528000.0  # 2032-01-01

ZERO_CLICK_TARGETS = (
    "imtranscoderagent",
    "blastdoor",
    "mobilesms",
    "webcontent",
    "com.apple.webkit",
    "osanalyticshelper",
    "springboard",
    "assistantd",
    "mediaserverd",
)

MEMORY_CORRUPTION_MARKERS = (
    "exc_bad_access",
    "sigsegv",
    "kern_invalid_address",
    "pac failure",
    "exc_crash",
    "brk #",
    "heap",
    "abort",
)

SUSPICIOUS_PROC_HINTS = (
    "roleabout",
    "bridgehead",
    "libalien",
    "libpredator",
    "pcsd",
    "ckdiscretionaryd",
    "triangledb",
    "staging",
    "/var/tmp/",
    "/data/local/tmp/",
)

SQLITE_MAGIC = b"SQLite format 3\x00"


def normalize_epoch_ts(raw: Any, *, prefer_cocoa: bool = False) -> float | None:
    """Convierte ISO-8601, timestamps Cocoa (+978307200), nanosegundos o Unix s/ms a Unix epoch."""
    if raw is None or isinstance(raw, bool):
        return None

    if isinstance(raw, (int, float)):
        val = float(raw)
        if val <= 0:
            return None
        # Nanosegundos Apple (iMessage / High Sierra+) o picosegundos
        if val > 1e16:
            val = val / 1e9
        elif val > 1e14:
            val = val / 1e9
        elif val > 1e11:
            # Unix milisegundos (Android / JS)
            val = val / 1000.0

        # Apple Cocoa Absolute Time (segundos desde 2001-01-01)
        if 3.0e8 <= val < 1.25e9 and (prefer_cocoa or val + COCOA_EPOCH_OFFSET >= MIN_VALID_EPOCH):
            val = val + COCOA_EPOCH_OFFSET

        if MIN_VALID_EPOCH <= val <= MAX_VALID_EPOCH:
            return val
        return None

    text = str(raw).strip()
    if not text:
        return None

    if re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        try:
            return normalize_epoch_ts(float(text), prefer_cocoa=prefer_cocoa)
        except ValueError:
            return None

    # Apple .ips format: "2024-06-12 08:14:09.123 -0500"
    cleaned = text.replace("Z", "+00:00")
    cleaned = re.sub(r"\s+([+-]\d{2})(\d{2})$", r"\1:\2", cleaned)
    for candidate in (cleaned, cleaned[:19]):
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ep = dt.timestamp()
            if MIN_VALID_EPOCH <= ep <= MAX_VALID_EPOCH:
                return ep
        except ValueError:
            continue
    return None


def _epoch_to_iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_sqlite_timeline(raw_bytes: bytes, filename: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not raw_bytes or raw_bytes[:16] != SQLITE_MAGIC:
        return events

    conn = sqlite3.connect(":memory:")
    if not hasattr(conn, "deserialize"):
        conn.close()
        return events

    try:
        conn.deserialize(raw_bytes)
        tables = {
            str(r[0]).lower(): str(r[0])
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }

        # 1. DataUsage / NetUsage (ZLIVEUSAGE + ZPROCESS)
        if "zprocess" in tables and "zliveusage" in tables:
            zp = tables["zprocess"]
            zl = tables["zliveusage"]
            zcols = {r[1].lower() for r in conn.execute(f'PRAGMA table_info("{zl}")').fetchall()}
            ts_col = "l.ZTIMESTAMP" if "ztimestamp" in zcols else "p.ZTIMESTAMP" if "ztimestamp" in {
                r[1].lower() for r in conn.execute(f'PRAGMA table_info("{zp}")').fetchall()
            } else None
            if ts_col:
                rows = conn.execute(
                    f"""
                    SELECT p.ZPROCNAME, {ts_col},
                           COALESCE(l.ZWWANIN, 0) + COALESCE(l.ZWIFIIN, 0),
                           COALESCE(l.ZWWANOUT, 0) + COALESCE(l.ZWIFIOUT, 0)
                    FROM "{zl}" l
                    JOIN "{zp}" p ON l.ZHASPROCESS = p.Z_PK
                    ORDER BY {ts_col} DESC LIMIT 120;
                    """
                ).fetchall()
                for proc, ts_raw, b_in, b_out in rows:
                    ep = normalize_epoch_ts(ts_raw, prefer_cocoa=True)
                    if not ep:
                        continue
                    proc_str = str(proc or "unknown")
                    out_kb = round((float(b_out or 0) / 1024.0), 1)
                    in_kb = round((float(b_in or 0) / 1024.0), 1)
                    is_sus_proc = any(h in proc_str.lower() for h in SUSPICIOUS_PROC_HINTS)
                    if is_sus_proc or out_kb >= 50.0:
                        events.append(
                            {
                                "ts": ep,
                                "timestamp": _epoch_to_iso(ep),
                                "kind": "DATA_SPIKE" if out_kb >= 50.0 else "SUSPICIOUS_PROC_NET",
                                "actor": proc_str,
                                "artifact": filename,
                                "detail": f"{proc_str} transfirió {out_kb} KB salientes / {in_kb} KB entrantes.",
                                "bytes_out": float(b_out or 0),
                                "suspicious": is_sus_proc or out_kb >= 250.0,
                            }
                        )

        # 2. Safari History.db (history_visits + history_items)
        if "history_visits" in tables and "history_items" in tables:
            rows = conn.execute(
                """
                SELECT i.url, v.visit_time
                FROM history_visits v
                JOIN history_items i ON v.history_item = i.id
                ORDER BY v.visit_time DESC LIMIT 100;
                """
            ).fetchall()
            for url, vtime in rows:
                ep = normalize_epoch_ts(vtime, prefer_cocoa=True)
                if not ep:
                    continue
                url_str = str(url or "")
                events.append(
                    {
                        "ts": ep,
                        "timestamp": _epoch_to_iso(ep),
                        "kind": "WEB_VISIT",
                        "actor": "Safari",
                        "artifact": filename,
                        "detail": f"Navegación registrada: {url_str[:120]}",
                        "url": url_str,
                        "suspicious": any(x in url_str.lower() for x in (".onion", ".top/", "bit.ly/", "/payload", "stage")),
                    }
                )

        # 3. iOS SMS.db (message) — solo timestamps y dominios en URL si existen
        if "message" in tables:
            cols = {r[1].lower() for r in conn.execute('PRAGMA table_info("message")').fetchall()}
            date_col = "date" if "date" in cols else None
            txt_col = "text" if "text" in cols else None
            if date_col:
                sel = f"{date_col}" + (f", {txt_col}" if txt_col else ", ''")
                rows = conn.execute(
                    f"SELECT {sel} FROM message WHERE {date_col} IS NOT NULL ORDER BY {date_col} DESC LIMIT 120;"
                ).fetchall()
                for ts_raw, msg_txt in rows:
                    ep = normalize_epoch_ts(ts_raw, prefer_cocoa=True)
                    if not ep:
                        continue
                    urls = re.findall(r"https?://[^\s<>'\"]+", str(msg_txt or ""))
                    if urls:
                        events.append(
                            {
                                "ts": ep,
                                "timestamp": _epoch_to_iso(ep),
                                "kind": "MESSAGE_LINK",
                                "actor": "SMS/iMessage",
                                "artifact": filename,
                                "detail": f"Enlace recibido/registrado en mensajería ({urls[0][:80]}).",
                                "url": urls[0],
                                "suspicious": True,
                            }
                        )
    except Exception:
        pass
    finally:
        conn.close()

    return events


def _extract_text_json_timeline(text: str, filename: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not text or not text.strip():
        return events

    fname_low = filename.lower()

    # 1. Logs JSON / dict (MVT crash_logs, sms.json, safari_history.json, shutdown_log.json)
    stripped = text.strip()
    if stripped[:1] in ("{", "["):
        try:
            parsed = json.loads(stripped)
            records = parsed if isinstance(parsed, list) else (
                parsed.get("records")
                or parsed.get("events")
                or parsed.get("crashes")
                or ([parsed] if isinstance(parsed, dict) else [])
            )
            for item in records[:200]:
                if not isinstance(item, dict):
                    continue
                ep = None
                for k in ("timestamp", "isodate", "date", "captureTime", "visit_time", "time"):
                    if k in item and item[k]:
                        ep = normalize_epoch_ts(item[k], prefer_cocoa=("visit_time" in item))
                        if ep:
                            break
                if not ep:
                    continue

                proc = str(
                    item.get("proc_name")
                    or item.get("procName")
                    or item.get("process")
                    or item.get("service")
                    or ""
                )
                blob_low = json.dumps(item, default=str).lower()
                is_target_crash = (
                    (any(t in proc.lower() for t in ZERO_CLICK_TARGETS) or any(t in fname_low for t in ZERO_CLICK_TARGETS))
                    and any(m in blob_low for m in MEMORY_CORRUPTION_MARKERS)
                ) or (".ips" in fname_low or ".crash" in fname_low) and any(t in blob_low for t in ZERO_CLICK_TARGETS)

                if is_target_crash:
                    events.append(
                        {
                            "ts": ep,
                            "timestamp": _epoch_to_iso(ep),
                            "kind": "CRITICAL_CRASH",
                            "actor": proc or filename,
                            "artifact": filename,
                            "detail": f"Cierre inesperado de memoria en proceso sensible ({proc or filename}).",
                            "suspicious": True,
                        }
                    )
                elif "shutdown" in fname_low or "reboot" in blob_low:
                    events.append(
                        {
                            "ts": ep,
                            "timestamp": _epoch_to_iso(ep),
                            "kind": "REBOOT_EVENT",
                            "actor": proc or "shutdown.log",
                            "artifact": filename,
                            "detail": "Reinicio / apagado del sistema registrado en log.",
                            "suspicious": any(s in blob_low for s in SUSPICIOUS_PROC_HINTS),
                        }
                    )
                elif "url" in item or "domain" in item or "text" in item:
                    url_v = str(item.get("url") or item.get("domain") or "")
                    if not url_v and "text" in item:
                        found = re.findall(r"https?://[^\s<>'\"]+", str(item["text"]))
                        url_v = found[0] if found else ""
                    if url_v:
                        events.append(
                            {
                                "ts": ep,
                                "timestamp": _epoch_to_iso(ep),
                                "kind": "MESSAGE_LINK" if "sms" in fname_low or "message" in fname_low else "WEB_VISIT",
                                "actor": "SMS/iMessage" if "sms" in fname_low else "Browser",
                                "artifact": filename,
                                "detail": f"Actividad con URL: {url_v[:100]}",
                                "url": url_v,
                                "suspicious": "sms" in fname_low or any(x in url_v.lower() for x in (".top/", ".xyz/", "bit.ly/", "/payload")),
                            }
                        )
        except Exception:
            pass

    # 2. Apple crashlog texto plano (.ips multi-JSON o .crash clásico)
    if not events and (".ips" in fname_low or ".crash" in fname_low or "exc_bad_access" in text.lower() or "sigsegv" in text.lower()):
        ts_match = re.search(
            r"(?:Date/Time|captureTime|timestamp)\s*[:\"]+\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[T\s][0-9:.+\-\sZ]+)",
            text,
            re.IGNORECASE,
        )
        ep = normalize_epoch_ts(ts_match.group(1).strip()) if ts_match else None
        low = text.lower()
        proc_match = re.search(r"(?:Process|procName)\s*[:\"]+\s*([A-Za-z0-9._-]+)", text)
        proc = proc_match.group(1) if proc_match else filename
        if ep and any(t in low for t in ZERO_CLICK_TARGETS) and any(m in low for m in MEMORY_CORRUPTION_MARKERS):
            events.append(
                {
                    "ts": ep,
                    "timestamp": _epoch_to_iso(ep),
                    "kind": "CRITICAL_CRASH",
                    "actor": proc,
                    "artifact": filename,
                    "detail": f"Fallo crítico de memoria en {proc} registrado en crashlog.",
                    "suspicious": True,
                }
            )

    # 3. shutdown.log texto plano (ej. SIGTERM process lines con epoch timestamp)
    if "shutdown" in fname_low and not events:
        for line in text.splitlines()[:250]:
            ep_m = re.search(r"\b(1[5-9]\d{8})(?:\.\d+)?\b", line)
            iso_m = re.search(r"([0-9]{4}-[0-9]{2}-[0-9]{2}[T\s][0-9:]{8})", line)
            ep = normalize_epoch_ts(iso_m.group(1)) if iso_m else (normalize_epoch_ts(float(ep_m.group(1))) if ep_m else None)
            if ep:
                events.append(
                    {
                        "ts": ep,
                        "timestamp": _epoch_to_iso(ep),
                        "kind": "REBOOT_EVENT",
                        "actor": "shutdown.log",
                        "artifact": filename,
                        "detail": f"Evento de cierre/reinicio: {line.strip()[:100]}",
                        "suspicious": any(s in line.lower() for s in SUSPICIOUS_PROC_HINTS),
                    }
                )

    return events


def correlate_temporal_chains(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Reconstruye timeline multi-artefacto en RAM y detecta cadenas 0-day sin firma previa."""
    all_events: list[dict[str, Any]] = []

    for art in artifacts or []:
        filename = str(art.get("filename") or "artefacto")
        raw_bytes: bytes | None = art.get("raw_bytes")
        if raw_bytes is None and isinstance(art.get("bytes"), (bytes, bytearray)):
            raw_bytes = bytes(art["bytes"])
        content = art.get("content")
        if raw_bytes is None and art.get("content_b64"):
            try:
                raw_bytes = base64.b64decode(str(art["content_b64"]))
            except Exception:
                raw_bytes = None

        if raw_bytes and raw_bytes[:16] == SQLITE_MAGIC:
            all_events.extend(_extract_sqlite_timeline(raw_bytes, filename))
            continue

        text = ""
        if isinstance(content, str):
            text = content
        elif isinstance(content, bytes):
            text = content.decode("utf-8", errors="ignore")
        elif raw_bytes:
            text = raw_bytes.decode("utf-8", errors="ignore")

        if text:
            all_events.extend(_extract_text_json_timeline(text, filename))

    all_events.sort(key=lambda e: e["ts"])

    crashes = [e for e in all_events if e["kind"] == "CRITICAL_CRASH"]
    triggers = [e for e in all_events if e["kind"] in ("MESSAGE_LINK", "WEB_VISIT")]
    impacts = [
        e
        for e in all_events
        if e["kind"] in ("DATA_SPIKE", "SUSPICIOUS_PROC_NET", "REBOOT_EVENT") and e.get("suspicious")
    ]
    data_spikes = [e for e in all_events if e["kind"] in ("DATA_SPIKE", "SUSPICIOUS_PROC_NET")]

    temporal_anomalies: list[dict[str, Any]] = []
    seen_chains: set[str] = set()

    for crash in crashes:
        c_ts = crash["ts"]
        c_actor = str(crash["actor"])
        nearby_trigger = next(
            (t for t in triggers if -300.0 <= (t["ts"] - c_ts) <= 60.0),
            None,
        )
        nearby_impact = next(
            (
                i
                for i in (impacts or data_spikes)
                if -120.0 <= (i["ts"] - c_ts) <= 900.0
                and (i.get("suspicious") or float(i.get("bytes_out") or 0) >= 50 * 1024)
            ),
            None,
        )
        is_imessage_surface = any(
            k in c_actor.lower() for k in ("imtranscoderagent", "blastdoor", "mobilesms", "osanalyticshelper")
        )

        # Para reducir falsos positivos en crashes normales de Safari (WebContent):
        # WebContent requiere impacto de exfiltración (>=250 KB o proceso sospechoso) cerca;
        # iMessage/BlastDoor con trigger o pico de datos dispara cadena zero-click crítica.
        if (is_imessage_surface and (nearby_trigger or nearby_impact)) or (nearby_trigger and nearby_impact):
            chain_key = f"{c_actor}:{int(c_ts // 300)}"
            if chain_key in seen_chains:
                continue
            seen_chains.add(chain_key)

            steps = [crash["detail"]]
            if nearby_trigger:
                delta_t = round(c_ts - nearby_trigger["ts"], 1)
                steps.insert(0, f"T-{abs(delta_t)}s Disparador ({nearby_trigger['actor']}): {nearby_trigger['detail']}")
            if nearby_impact:
                delta_i = round(nearby_impact["ts"] - c_ts, 1)
                steps.append(f"T+{delta_i}s Efecto ({nearby_impact['actor']}): {nearby_impact['detail']}")

            temporal_anomalies.append(
                {
                    "category": "TEMPORAL_ZERO_DAY_CHAIN",
                    "severity": "CRITICAL",
                    "indicator": f"{c_actor} @ {crash['timestamp']}",
                    "artifact": crash["artifact"],
                    "detail": (
                        "Secuencia temporal compatible con ataque zero-click o 0-day sin firma previa: "
                        + " -> ".join(steps)
                    ),
                }
            )

    clean_timeline = [
        {k: v for k, v in ev.items() if k != "ts"}
        for ev in all_events[-120:]
    ]

    return {
        "timeline": clean_timeline,
        "temporal_anomalies": temporal_anomalies,
        "timeline_summary": {
            "events_total": len(all_events),
            "crashes_detected": len(crashes),
            "chains_detected": len(temporal_anomalies),
        },
    }


def inspect_mobile_profiles_and_certs(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Audita perfiles .mobileconfig (iOS) y hashes APK / CA certificados / Proxy (Android)."""
    alerts: list[dict[str, Any]] = []
    seen: set[str] = set()

    for art in artifacts or []:
        fname = str(art.get("filename") or "")
        fname_low = fname.lower()
        raw_bytes: bytes | None = art.get("raw_bytes")
        if raw_bytes is None and isinstance(art.get("bytes"), (bytes, bytearray)):
            raw_bytes = bytes(art["bytes"])
        text = ""
        if isinstance(art.get("content"), str):
            text = art["content"]
        elif raw_bytes:
            text = raw_bytes.decode("utf-8", errors="ignore")

        if not text:
            continue

        # 1. Perfiles .mobileconfig / MDM de iOS
        if fname_low.endswith(".mobileconfig") or ("<key>PayloadType</key>" in text and "PayloadContent" in text):
            lower_t = text.lower()
            has_root_ca = "com.apple.security.root" in lower_t or "com.apple.security.pkcs1" in lower_t
            has_mdm = "com.apple.mdm" in lower_t
            has_proxy = "httpproxy" in lower_t or "com.apple.vpn.managed" in lower_t
            if has_root_ca or has_mdm or has_proxy:
                kinds = []
                if has_root_ca:
                    kinds.append("Certificado Raíz CA")
                if has_mdm:
                    kinds.append("MDM Control Remoto")
                if has_proxy:
                    kinds.append("Proxy/VPN forzado")
                key = f"mobileconfig:{fname}"
                if key not in seen:
                    seen.add(key)
                    alerts.append(
                        {
                            "category": "IOS_PROFILE_INTERCEPTION_RISK",
                            "severity": "HIGH" if (has_root_ca or has_mdm) else "MEDIUM",
                            "indicator": fname,
                            "artifact": fname,
                            "detail": (
                                f"Perfil .mobileconfig con capacidades sensibles ({', '.join(kinds)}). "
                                "Un certificado raíz no oficial o MDM desconocido permite leer tráfico HTTPS o controlar el iPhone."
                            ),
                        }
                    )

        # 2. Android User CA Certs (/data/misc/user/0/cacerts-added)
        if "cacerts_added" in fname_low or "cacerts-added" in text.lower():
            certs = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#") and ln.strip() != "NONE"]
            if certs:
                key = f"android_user_ca:{len(certs)}"
                if key not in seen:
                    seen.add(key)
                    alerts.append(
                        {
                            "category": "ANDROID_USER_ROOT_CA_INSTALLED",
                            "severity": "HIGH",
                            "indicator": f"{len(certs)} certificado(s) raíz de usuario ({certs[0]})",
                            "artifact": fname,
                            "detail": (
                                "Android tiene certificados CA instalados por el usuario/tercero. Esto permite "
                                "interceptar o descifrar tráfico HTTPS en el equipo."
                            ),
                        }
                    )

        # 3. Android Global HTTP Proxy anómalo
        if "net_proxy" in fname_low or "http_proxy:" in text.lower():
            m = re.search(r"http_proxy\s*=\s*([^\s\r\n]+)", text, re.IGNORECASE)
            if m:
                proxy_val = m.group(1).strip()
                if proxy_val and proxy_val.lower() not in ("null", ":0", "none"):
                    key = f"android_proxy:{proxy_val}"
                    if key not in seen:
                        seen.add(key)
                        alerts.append(
                            {
                                "category": "ANDROID_HTTP_PROXY_ACTIVE",
                                "severity": "MEDIUM",
                                "indicator": f"http_proxy={proxy_val}",
                                "artifact": fname,
                                "detail": (
                                    f"El teléfono Android desvía tráfico HTTP por un proxy configurado ({proxy_val})."
                                ),
                            }
                        )

    return alerts
