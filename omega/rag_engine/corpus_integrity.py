"""Verificación fail-closed de integridad SHA-256 y procedencia confiable para el corpus CTI (PDF y STIX 2.1)."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")

DEFAULT_TRUSTED_ORGANIZATIONS = frozenset({
    "citizen lab",
    "amnesty tech",
    "amnesty international security lab",
    "google tag",
    "google threat analysis group",
    "google threat analysis group (tag)",
})

DEFAULT_TRUSTED_DOMAINS = (
    "citizenlab.ca",
    "amnesty.org",
    "securitylab.amnesty.org",
    "blog.google",
    "github.com",
    "raw.githubusercontent.com",
)


class ManifestIntegrityError(RuntimeError):
    """Error bloqueante cuando un artefacto del corpus carece de hash confiable o no supera verificación SHA-256."""


def compute_file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def validate_trusted_source(
    organization: str | None,
    source_url: str | None,
    trusted_orgs: set[str] | frozenset[str] = DEFAULT_TRUSTED_ORGANIZATIONS,
) -> None:
    org_clean = str(organization or "").strip().lower()
    if not org_clean or org_clean not in trusted_orgs:
        raise ManifestIntegrityError(
            f"Organización no incluida en la lista de confianza CTI: {organization!r}."
        )

    url_clean = str(source_url or "").strip()
    parsed = urlparse(url_clean)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise ManifestIntegrityError(
            f"source_url debe usar HTTPS verificable para fuentes CTI públicas (recibido: {url_clean!r})."
        )
    if not any(host == dom or host.endswith(f".{dom}") for dom in DEFAULT_TRUSTED_DOMAINS):
        raise ManifestIntegrityError(
            f"Dominio de origen no autorizado en allowlist CTI: {host!r}."
        )


def load_pdf_manifest(manifest_path: Path) -> dict[str, dict]:
    if not manifest_path.exists():
        raise ManifestIntegrityError(
            f"Falta corpus_manifest.json requerido para verificación fail-closed: {manifest_path}"
        )
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("reports", [])
    index: dict[str, dict] = {}
    for item in items:
        if isinstance(item, dict) and item.get("local_filename"):
            index[str(item["local_filename"])] = item
    return index


def verify_pdf_file(pdf_path: Path, manifest_index: dict[str, dict]) -> str:
    meta = manifest_index.get(pdf_path.name)
    if not meta:
        raise ManifestIntegrityError(
            f"PDF no registrado en corpus_manifest.json (rechazo fail-closed): {pdf_path.name}"
        )

    expected = str(meta.get("expected_sha256") or "").strip().lower()
    if not SHA256_HEX_RE.match(expected):
        raise ManifestIntegrityError(
            f"Entrada sin 'expected_sha256' SHA-256 válido en corpus_manifest.json: {pdf_path.name}"
        )

    validate_trusted_source(meta.get("organization"), meta.get("source_url"))

    actual = compute_file_sha256(pdf_path)
    if actual != expected:
        raise ManifestIntegrityError(
            f"Integridad SHA-256 comprometida para {pdf_path.name}: esperado {expected}, obtenido {actual}"
        )
    return actual


def verify_pdf_corpus(pdfs_dir: Path, manifest_path: Path) -> dict[str, str]:
    manifest_index = load_pdf_manifest(manifest_path)
    pdf_files = sorted(pdfs_dir.glob("*.pdf"))
    if not pdf_files:
        raise ManifestIntegrityError(f"No se encontraron PDFs en {pdfs_dir}")

    verified: dict[str, str] = {}
    for pdf_path in pdf_files:
        verified[pdf_path.name] = verify_pdf_file(pdf_path, manifest_index)
    return verified


def verify_stix_corpus(iocs_dir: Path, manifest_path: Path | None = None) -> dict[str, object]:
    stix_manifest = manifest_path or (iocs_dir / "stix_manifest.json")
    if not stix_manifest.exists():
        raise ManifestIntegrityError(
            f"Falta stix_manifest.json requerido para verificación STIX fail-closed: {stix_manifest}"
        )

    data = json.loads(stix_manifest.read_text(encoding="utf-8"))
    bundles = data.get("bundles")
    if not isinstance(bundles, dict) or not bundles:
        raise ManifestIntegrityError("stix_manifest.json no contiene el mapa requerido 'bundles'.")

    raw_orgs = data.get("trusted_organizations") or []
    trusted_orgs = (
        {str(o).strip().lower() for o in raw_orgs if str(o).strip()}
        if raw_orgs
        else set(DEFAULT_TRUSTED_ORGANIZATIONS)
    )

    feed_files = sorted(
        f for f in (list(iocs_dir.glob("*.stix2")) + list(iocs_dir.glob("*.json")))
        if f.name != "stix_manifest.json"
    )
    if not feed_files:
        raise ManifestIntegrityError(f"No se encontraron bundles STIX/JSON en {iocs_dir}")

    verified: dict[str, str] = {}
    for feed_path in feed_files:
        meta = bundles.get(feed_path.name)
        if not isinstance(meta, dict):
            raise ManifestIntegrityError(
                f"Feed IOC no listado en stix_manifest.json (rechazo fail-closed): {feed_path.name}"
            )
        expected = str(meta.get("expected_sha256") or "").strip().lower()
        if not SHA256_HEX_RE.match(expected):
            raise ManifestIntegrityError(
                f"Feed STIX sin 'expected_sha256' válido en stix_manifest.json: {feed_path.name}"
            )
        validate_trusted_source(meta.get("organization"), meta.get("source_url"), trusted_orgs)

        actual = compute_file_sha256(feed_path)
        if actual != expected:
            raise ManifestIntegrityError(
                f"Integridad SHA-256 comprometida en STIX '{feed_path.name}': esperado {expected}, obtenido {actual}"
            )
        verified[feed_path.name] = actual

    return {
        "catalog_cutoff_date": str(data.get("catalog_cutoff_date") or ""),
        "verified_bundles": verified,
        "manifest_sha256": compute_file_sha256(stix_manifest),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verificador fail-closed del corpus CTI de OMEGA")
    default_corpus = Path(__file__).resolve().parent.parent / "corpus_mvp"
    parser.add_argument("--corpus-dir", type=Path, default=default_corpus)
    args = parser.parse_args(argv)

    pdfs_dir = args.corpus_dir / "pdfs"
    pdf_manifest = args.corpus_dir / "corpus_manifest.json"
    iocs_dir = args.corpus_dir / "iocs"

    verified_pdfs = verify_pdf_corpus(pdfs_dir, pdf_manifest)
    verified_stix = verify_stix_corpus(iocs_dir)
    print(
        json.dumps(
            {
                "status": "VERIFIED",
                "pdfs_verified": len(verified_pdfs),
                "stix_bundles_verified": len(verified_stix["verified_bundles"]),
                "catalog_cutoff_date": verified_stix["catalog_cutoff_date"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ManifestIntegrityError as exc:
        print(f"[FAIL-CLOSED INTEGRITY ERROR] {exc}", file=sys.stderr)
        raise SystemExit(2)
