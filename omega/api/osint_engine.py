import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)


def register_osint_asset(
    asset_type: str, asset_value: str, explicit_consent: bool, owner_token: str
) -> dict:
    if explicit_consent is not True:
        raise ValueError("RNF8: El consentimiento explícito del titular es obligatorio.")

    clean_value = asset_value.strip().lower()
    if asset_type == "domain":
        clean_value = re.sub(r"^https?://", "", clean_value).split("/")[0]
    elif asset_type == "institutional_email" and "@" not in clean_value:
        raise ValueError("El correo institucional debe tener un formato válido (usuario@dominio).")

    safe_owner = (owner_token or "default_analyst")[:120]

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO osint_monitored_assets (owner_token, asset_type, asset_value, explicit_consent)
                VALUES (%s, %s, %s, TRUE)
                ON CONFLICT (owner_token, asset_value) DO UPDATE SET
                    asset_type = EXCLUDED.asset_type,
                    explicit_consent = TRUE,
                    consented_at = NOW()
                RETURNING id::text, asset_type, asset_value, explicit_consent,
                          consented_at::text, last_checked_at::text;
                """,
                (safe_owner, asset_type, clean_value),
            )
            row = cur.fetchone()
            conn.commit()

    return {
        "id": row[0],
        "asset_type": row[1],
        "asset_value": row[2],
        "explicit_consent": row[3],
        "consented_at": row[4],
        "last_checked_at": row[5],
    }


def list_osint_assets(owner_token: str) -> list[dict]:
    safe_owner = (owner_token or "default_analyst")[:120]
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, asset_type, asset_value, explicit_consent,
                       consented_at::text, last_checked_at::text
                FROM osint_monitored_assets
                WHERE owner_token = %s AND explicit_consent = TRUE
                ORDER BY consented_at DESC;
                """,
                (safe_owner,),
            )
            rows = cur.fetchall()

    return [
        {
            "id": r[0],
            "asset_type": r[1],
            "asset_value": r[2],
            "explicit_consent": r[3],
            "consented_at": r[4],
            "last_checked_at": r[5],
        }
        for r in rows
    ]


def delete_osint_asset(asset_id: str, owner_token: str) -> bool:
    safe_owner = (owner_token or "default_analyst")[:120]
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM osint_monitored_assets WHERE id = %s::uuid AND owner_token = %s;",
                (asset_id, safe_owner),
            )
            deleted = cur.rowcount > 0
            conn.commit()
    return deleted


def _fetch_json_passive(url: str, headers: dict | None = None, timeout: int = 8) -> tuple[int, dict | list | None]:
    req_headers = {"User-Agent": "Omega-CTI-Defensive-Research/1.0"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as err:
        return err.code, None
    except Exception:
        return 0, None


def _check_dns_txt(name: str) -> list[str]:
    encoded = urllib.parse.quote(name)
    status, data = _fetch_json_passive(
        f"https://cloudflare-dns.com/dns-query?name={encoded}&type=TXT",
        headers={"Accept": "application/dns-json"},
    )
    if status != 200 or not isinstance(data, dict) or "Answer" not in data:
        return []
    return [ans.get("data", "").strip('"') for ans in data["Answer"]]


def _check_email_breaches_passive(email: str) -> dict:
    """Consulta pasiva en base pública de brechas conocidas (XposedOrNot API v1) para correos propios."""
    encoded_email = urllib.parse.quote(email)
    status, data = _fetch_json_passive(
        f"https://api.xposedornot.com/v1/breach-analytics?email={encoded_email}",
        timeout=10,
    )

    if status == 404:
        return {
            "source": "XposedOrNot Public Breach Intelligence",
            "status": "clean",
            "breach_count": 0,
            "breaches": [],
        }

    if status == 200 and isinstance(data, dict):
        exposed = data.get("ExposedBreaches", {})
        details = exposed.get("breaches_details", []) if isinstance(exposed, dict) else []
        parsed_breaches = []
        for b in details[:20]:
            parsed_breaches.append(
                {
                    "breach_name": b.get("breach") or "Brecha documentada",
                    "breach_date": b.get("xposed_date") or "Fecha N/D",
                    "domain": b.get("domain") or "",
                    "exposed_data": b.get("xposed_data") or "Credenciales / Metadatos",
                }
            )
        return {
            "source": "XposedOrNot Public Breach Intelligence",
            "status": "exposed" if parsed_breaches else "clean",
            "breach_count": len(parsed_breaches),
            "breaches": parsed_breaches,
        }

    return {
        "source": "XposedOrNot Public Breach Intelligence",
        "status": "unavailable",
        "breach_count": 0,
        "breaches": [],
    }


def run_passive_osint_scan(asset_id: str, owner_token: str) -> dict | None:
    safe_owner = (owner_token or "default_analyst")[:120]

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, asset_type, asset_value, explicit_consent
                FROM osint_monitored_assets
                WHERE id = %s::uuid AND owner_token = %s AND explicit_consent = TRUE;
                """,
                (asset_id, safe_owner),
            )
            asset = cur.fetchone()
            if not asset:
                return None

            _, asset_type, asset_value, _ = asset

            target_domain = None
            email_breach_report = None

            if asset_type == "domain":
                target_domain = asset_value
            elif asset_type == "institutional_email" and "@" in asset_value:
                target_domain = asset_value.split("@", 1)[1]
                email_breach_report = _check_email_breaches_passive(asset_value)

            exposed_subdomains = []
            dns_posture = {"spf_configured": False, "dmarc_configured": False, "notes": []}

            if target_domain:
                q = urllib.parse.quote(f"%.{target_domain}")
                status, crt_data = _fetch_json_passive(f"https://crt.sh/?q={q}&output=json", timeout=10)
                if status == 200 and isinstance(crt_data, list):
                    subs = set()
                    for entry in crt_data[:120]:
                        for line in entry.get("name_value", "").splitlines():
                            clean_sub = line.strip().lower().lstrip("*.")
                            if clean_sub.endswith(target_domain):
                                subs.add(clean_sub)
                    exposed_subdomains = sorted(subs)[:25]

                root_txt = _check_dns_txt(target_domain)
                dmarc_txt = _check_dns_txt(f"_dmarc.{target_domain}")

                spf_records = [r for r in root_txt if "v=spf1" in r.lower()]
                dmarc_records = [r for r in dmarc_txt if "v=dmarc1" in r.lower()]

                dns_posture = {
                    "domain_evaluated": target_domain,
                    "spf_configured": len(spf_records) > 0,
                    "spf_record": spf_records[0] if spf_records else None,
                    "dmarc_configured": len(dmarc_records) > 0,
                    "dmarc_record": dmarc_records[0] if dmarc_records else None,
                }
            elif asset_type == "organization":
                q = urllib.parse.quote(asset_value)
                status, crt_data = _fetch_json_passive(f"https://crt.sh/?O={q}&output=json", timeout=10)
                if status == 200 and isinstance(crt_data, list):
                    subs = {
                        entry.get("common_name", "").strip().lower()
                        for entry in crt_data[:80]
                        if entry.get("common_name")
                    }
                    exposed_subdomains = sorted(subs)[:25]
                dns_posture = {"notes": ["Consulta pasiva por organización en Certificate Transparency."]}

            search_terms = {asset_value}
            if target_domain:
                search_terms.add(target_domain)
            search_terms.update(exposed_subdomains)

            cur.execute(
                """
                SELECT i.ioc_type, i.ioc_value, COALESCE(c.spyware_family, 'Desconocida'), r.title
                FROM iocs i
                JOIN reports r ON i.report_id = r.id
                LEFT JOIN campaigns c ON i.campaign_id = c.id
                WHERE i.ioc_value = ANY(%s);
                """,
                (list(search_terms),),
            )
            cti_matches = [
                {
                    "ioc_type": m[0],
                    "ioc_value": m[1],
                    "spyware_family": m[2],
                    "source_report": m[3],
                }
                for m in cur.fetchall()
            ]

            cur.execute(
                "UPDATE osint_monitored_assets SET last_checked_at = NOW() WHERE id = %s::uuid;",
                (asset_id,),
            )
            conn.commit()

    return {
        "asset_id": asset_id,
        "asset_type": asset_type,
        "asset_value": asset_value,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "exposed_subdomains": exposed_subdomains,
        "dns_posture": dns_posture,
        "email_breaches": email_breach_report,
        "cti_ioc_matches": cti_matches,
        "ethical_notice": "Consulta OSINT pasiva ejecutada exclusivamente sobre activo propio con consentimiento explícito registrado (RF8 / RNF8).",
    }
