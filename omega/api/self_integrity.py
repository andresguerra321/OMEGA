"""Signed release inventory. The trust anchor is shipped in the application, never in the manifest."""
import base64
import hashlib
import json
from pathlib import Path
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

# Release engineering replaces this anchor with its offline signing key's public half.
TRUSTED_PUBLIC_KEY = ''


class IntegrityError(RuntimeError):
    pass


def inventory(root):
    root = Path(root)
    files = {}
    for folder in ('api', 'rag_engine', 'corpus_mvp', 'sensor_runtime', 'scripts'):
        for path in (root / folder).rglob('*'):
            if path.is_symlink():
                raise IntegrityError(f'Enlace no permitido: {path}')
            if path.is_file() and (folder in ('corpus_mvp', 'sensor_runtime', 'scripts') or path.suffix in ('.py', '.pth')):
                files[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files


def verify_release(root, *, public_key=None, search_paths=None):
    root = Path(root)
    try:
        key = base64.b64decode(public_key if public_key is not None else TRUSTED_PUBLIC_KEY, validate=True)
        raw = (root / 'integrity-manifest.json').read_bytes()
        sig = base64.b64decode((root / 'integrity-manifest.sig').read_bytes(), validate=True)
        Ed25519PublicKey.from_public_bytes(key).verify(sig, raw)
        manifest = json.loads(raw)
        if manifest.get('version') != 1 or manifest['files'] != inventory(root):
            raise IntegrityError('Archivo modificado, inyectado o faltante')
        # Only hash-approved .pth files may be present in the interpreter search path.
        approved = manifest['files']
        for entry in (sys.path if search_paths is None else search_paths):
            directory = Path(entry or '.').resolve()
            for pth in directory.glob('*.pth'):
                try:
                    relative = pth.resolve().relative_to(root.resolve()).as_posix()
                except ValueError:
                    raise IntegrityError(f'.pth no autorizado: {pth}') from None
                if pth.is_symlink() or approved.get(relative) != hashlib.sha256(pth.read_bytes()).hexdigest():
                    raise IntegrityError(f'.pth no autorizado: {pth}')
        return manifest
    except IntegrityError:
        raise
    except Exception as exc:
        raise IntegrityError('Integridad comprometida: manifiesto, firma o clave de confianza inválidos') from exc
