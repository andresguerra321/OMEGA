"""Installer checksums and optional detached OpenSSL SHA-256 signature (RSA/ECDSA PEM)."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import base64
import json

INSTALLERS = {'.exe', '.msi', '.dmg', '.appimage', '.deb'}


def sign_source_tree(root: Path, private_key_pem: bytes):
    """Called on the staged release, with a CI/offline Ed25519 key (never generated here)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import importlib.util
    # Never execute Python from the staged tree before authenticating/signing it.
    spec = importlib.util.spec_from_file_location('_omega_release_inventory', Path(__file__).resolve().parents[1] / 'api/self_integrity.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    inventory = verifier.inventory
    private = serialization.load_pem_private_key(private_key_pem, password=None)
    if not isinstance(private, Ed25519PrivateKey):
        raise ValueError('La clave de integridad debe ser Ed25519')
    public = base64.b64encode(private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    # Embed the trust anchor before hashing Python source. Never read a key supplied with a manifest.
    import re
    for filename in ('api/self_integrity.py',):
        target = root / filename
        source = target.read_text(encoding='utf-8')
        source, count = re.subn(r"TRUSTED_PUBLIC_KEY = '[^']*'", f"TRUSTED_PUBLIC_KEY = '{public}'", source)
        if count != 1:
            raise ValueError('No se encontró el ancla de confianza única')
        target.write_text(source, encoding='utf-8', newline='\n')
    raw = json.dumps({'version': 1, 'files': inventory(root)}, sort_keys=True, separators=(',', ':')).encode()
    (root / 'integrity-manifest.json').write_bytes(raw)
    (root / 'integrity-manifest.sig').write_bytes(base64.b64encode(private.sign(raw)))
    private.public_key().verify(private.sign(raw), raw)
    return root / 'integrity-manifest.json'


def openssl_path():
    executable = shutil.which('openssl')
    if not executable:
        git_openssl = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/usr/bin/openssl.exe'
        if git_openssl.is_file():
            executable = str(git_openssl)
    if not executable:
        raise RuntimeError('OpenSSL es obligatorio cuando RELEASE_SIGNING_KEY está configurada.')
    return executable


def _normalize_pem_material(raw_material: str) -> str:
    text = raw_material.strip().replace('\r\n', '\n').replace('\\n', '\n')
    if '-----BEGIN ' not in text:
        try:
            decoded = base64.b64decode(text, validate=True).decode('utf-8')
            if '-----BEGIN ' in decoded:
                text = decoded.strip().replace('\r\n', '\n')
        except Exception:
            pass
    if not text.endswith('\n'):
        text += '\n'
    return text


def _run_openssl(args: list[str], env: dict[str, str], context: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, check=True, timeout=30, capture_output=True, text=True, env=env)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or '').strip().splitlines()
        summary = detail[-1] if detail else f'exit code {exc.returncode}'
        raise RuntimeError(f'Error de OpenSSL ({context}): {summary}') from exc


def generate(source: Path, output: Path, recursive=False):
    files = sorted((item for item in (source.rglob('*') if recursive else source.iterdir())
                    if item.is_file() and item.suffix.lower() in INSTALLERS), key=lambda item: item.name)
    if not files:
        raise RuntimeError('No se generó ningún instalador; no se publicará un manifiesto vacío.')
    if len({item.name.replace(' ', '.') for item in files}) != len(files):
        raise RuntimeError('Hay instaladores con el mismo nombre; se cancela para evitar sobrescribir evidencia.')
    output.mkdir(parents=True, exist_ok=True)
    lines = []
    for item in files:
        if '\n' in item.name or '\r' in item.name or '\\' in item.name:
            raise RuntimeError('Nombre de instalador no permitido en el manifiesto.')
        # GitHub converts spaces to dots in release asset names.
        target = output / item.name.replace(' ', '.')
        if item.resolve() != target.resolve():
            shutil.copy2(item, target)
        with target.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        lines.append(f'{digest}  {target.name}\n')
    manifest = output / 'SHA256SUMS.txt'
    manifest.write_bytes(''.join(lines).encode('utf-8'))
    signature, public_key = output / 'SHA256SUMS.txt.sig', output / 'RELEASE_SIGNING_PUBLIC_KEY.pem'
    signature.unlink(missing_ok=True)
    public_key.unlink(missing_ok=True)
    material = os.environ.get('RELEASE_SIGNING_KEY', '').strip()
    if material:
        executable = openssl_path()
        normalized_pem = _normalize_pem_material(material)
        fd, temporary = tempfile.mkstemp(prefix='.omega-release-key-', dir=output)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as private:
                private.write(normalized_pem)
            environment = {name: value for name, value in os.environ.items() if name != 'RELEASE_SIGNING_KEY'}
            _run_openssl(
                [executable, 'pkey', '-in', temporary, '-passin', 'pass:', '-pubout', '-out', str(public_key)],
                environment,
                'al extraer clave pública de RELEASE_SIGNING_KEY',
            )
            key_info = _run_openssl(
                [executable, 'pkey', '-in', temporary, '-passin', 'pass:', '-text', '-noout'],
                environment,
                'al inspeccionar algoritmo de RELEASE_SIGNING_KEY',
            )
            is_eddsa = 'ED25519' in key_info.stdout.upper() or 'ED448' in key_info.stdout.upper()
            if is_eddsa:
                _run_openssl(
                    [executable, 'pkeyutl', '-sign', '-rawin', '-in', str(manifest), '-inkey', temporary, '-passin', 'pass:', '-out', str(signature)],
                    environment,
                    'al firmar manifiesto con EdDSA',
                )
                _run_openssl(
                    [executable, 'pkeyutl', '-verify', '-pubin', '-inkey', str(public_key), '-rawin', '-in', str(manifest), '-sigfile', str(signature)],
                    environment,
                    'al verificar firma EdDSA',
                )
            else:
                _run_openssl(
                    [executable, 'dgst', '-sha256', '-sign', temporary, '-passin', 'pass:', '-out', str(signature), str(manifest)],
                    environment,
                    'al firmar manifiesto SHA-256',
                )
                _run_openssl(
                    [executable, 'dgst', '-sha256', '-verify', str(public_key), '-signature', str(signature), str(manifest)],
                    environment,
                    'al verificar firma SHA-256',
                )
        finally:
            Path(temporary).unlink(missing_ok=True)
    else:
        print('::warning::RELEASE_SIGNING_KEY no configurada: SHA256SUMS.txt no tiene firma privada separada; se conserva la atestación de procedencia de GitHub.')
    print(f'Manifiesto SHA-256 verificado para {len(files)} instalador(es). Firma separada: {bool(material)}')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--source-tree', type=Path, help='Firmar árbol preparado usando OMEGA_INTEGRITY_SIGNING_KEY en RAM')
    parser.add_argument('--recursive', action='store_true')
    arguments = parser.parse_args()
    if arguments.source_tree:
        material = os.environ.pop('OMEGA_INTEGRITY_SIGNING_KEY', '')
        if not material:
            parser.error('Falta OMEGA_INTEGRITY_SIGNING_KEY (PEM Ed25519)')
        sign_source_tree(arguments.source_tree, material.replace('\\n', '\n').encode())
    elif arguments.source and arguments.output:
        generate(arguments.source, arguments.output, arguments.recursive)
    else:
        parser.error('Usa --source-tree o --source y --output')
