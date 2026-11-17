"""Installer checksums and optional detached OpenSSL SHA-256 signature (RSA/ECDSA PEM)."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

INSTALLERS = {'.exe', '.msi', '.dmg', '.appimage', '.deb'}


def openssl_path():
    executable = shutil.which('openssl')
    if not executable:
        git_openssl = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/usr/bin/openssl.exe'
        if git_openssl.is_file():
            executable = str(git_openssl)
    if not executable:
        raise RuntimeError('OpenSSL es obligatorio cuando RELEASE_SIGNING_KEY está configurada.')
    return executable


def generate(source: Path, output: Path, recursive=False):
    files = sorted((item for item in (source.rglob('*') if recursive else source.iterdir())
                    if item.is_file() and item.suffix.lower() in INSTALLERS), key=lambda item: item.name)
    if not files:
        raise RuntimeError('No se generó ningún instalador; no se publicará un manifiesto vacío.')
    if len({item.name for item in files}) != len(files):
        raise RuntimeError('Hay instaladores con el mismo nombre; se cancela para evitar sobrescribir evidencia.')
    output.mkdir(parents=True, exist_ok=True)
    lines = []
    for item in files:
        if '\n' in item.name or '\r' in item.name or '\\' in item.name:
            raise RuntimeError('Nombre de instalador no permitido en el manifiesto.')
        target = output / item.name
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
        fd, temporary = tempfile.mkstemp(prefix='.omega-release-key-', dir=output)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as private:
                private.write(material.replace('\\n', '\n'))
            environment = {name: value for name, value in os.environ.items() if name != 'RELEASE_SIGNING_KEY'}
            subprocess.run([executable, 'dgst', '-sha256', '-sign', temporary, '-passin', 'pass:', '-out', str(signature), str(manifest)],
                           check=True, timeout=30, capture_output=True, env=environment)
            subprocess.run([executable, 'pkey', '-in', temporary, '-passin', 'pass:', '-pubout', '-out', str(public_key)],
                           check=True, timeout=30, capture_output=True, env=environment)
            subprocess.run([executable, 'dgst', '-sha256', '-verify', str(public_key), '-signature', str(signature), str(manifest)],
                           check=True, timeout=30, capture_output=True, env=environment)
        finally:
            Path(temporary).unlink(missing_ok=True)
    else:
        print('::warning::RELEASE_SIGNING_KEY no configurada: SHA256SUMS.txt no tiene firma privada separada; se conserva la atestación de procedencia de GitHub.')
    print(f'Manifiesto SHA-256 verificado para {len(files)} instalador(es). Firma separada: {bool(material)}')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--recursive', action='store_true')
    arguments = parser.parse_args()
    generate(arguments.source, arguments.output, arguments.recursive)
