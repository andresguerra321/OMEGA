"""Prepara los recursos que el instalador Tauri incluye para el modo Self-Hosted.

La app de escritorio levanta PostgreSQL, el worker forense y el gateway Java con
`docker compose`, y el compose construye las imágenes desde fuentes. Un instalador
no tiene el repositorio, así que se empaqueta una copia limpia (sin artefactos de
build ni cachés) en `frontend/src-tauri/bundle-resources/omega/`.
"""
import argparse
from pathlib import Path
import shutil
import hashlib
import json
import os
import secrets
import subprocess

OMEGA_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = OMEGA_ROOT / 'frontend' / 'src-tauri' / 'bundle-resources'

IGNORED = shutil.ignore_patterns(
    'node_modules', 'target', '__pycache__', '.pytest*', '.mypy_cache', '.ruff_cache',
    '.git', '.idea', '.vscode', '*.pyc', '*.log', '.env', '.env.*', '.venv', 'venv', 'jdk-*',
)

FOLDERS = ('api', 'backend-java', 'corpus_mvp')


def stage(source: Path, destination: Path, with_images: bool = False) -> Path:
    source, destination = source.resolve(), destination.resolve()
    target = destination / 'omega'
    if target == source or source.is_relative_to(target):
        raise ValueError('El destino de empaquetado no puede reemplazar el código fuente')
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for folder in FOLDERS:
        if not (source / folder).is_dir():
            raise RuntimeError(f'Falta {folder}/ en {source}')
        shutil.copytree(source / folder, target / folder, ignore=IGNORED)
    (target / 'db').mkdir()
    shutil.copy2(source / 'db' / 'init.sql', target / 'db' / 'init.sql')
    shutil.copy2(source / 'docker-compose.yml', target / 'docker-compose.yml')
    for required in ('docker-compose.yml', 'db/init.sql', 'api/Dockerfile', 'backend-java/Dockerfile'):
        if not (target / required).is_file():
            raise RuntimeError(f'El paquete Self-Hosted quedó incompleto: falta {required}')
    digest = hashlib.sha256()
    for file in sorted(target.rglob('*')):
        if file.is_file():
            digest.update(file.relative_to(target).as_posix().encode())
            digest.update(b'\0')
            with file.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
    release_id = digest.hexdigest()
    if with_images:
        image_bundle = os.environ.get('OMEGA_PREBUILT_IMAGES_DIR')
        if image_bundle:
            bundle = Path(image_bundle).resolve()
            archive = bundle / 'desktop-images.tar'
            manifest = bundle / 'desktop-release.json'
            metadata = json.loads(manifest.read_text(encoding='utf-8'))
            if not archive.is_file() or archive.stat().st_size == 0 or not metadata.get('release_id'):
                raise RuntimeError('El paquete de imágenes precompiladas está incompleto')
            if os.environ.get('GITHUB_SHA') and metadata.get('commit') != os.environ['GITHUB_SHA']:
                raise RuntimeError('Las imágenes Docker no corresponden al commit de esta compilación')
            shutil.copy2(archive, target / archive.name)
            shutil.copy2(manifest, target / manifest.name)
            return target
        env = {**os.environ, 'INTERNAL_SERVICE_TOKEN': secrets.token_hex(32)}
        # Build on the packaging machine; end users do not need Maven, pip or a source build.
        subprocess.run(['docker', 'compose', '-p', 'omega-package', '-f',
                        str(target / 'docker-compose.yml'), 'build', 'forensic-worker', 'backend-java'],
                       check=True, env=env)
        subprocess.run(['docker', 'pull', 'pgvector/pgvector:pg16'], check=True)
        subprocess.run(['docker', 'save', '--output', str(target / 'desktop-images.tar'),
                        'omega-forensic-worker:latest', 'omega-backend-java:latest',
                        'pgvector/pgvector:pg16'], check=True)
        (target / 'desktop-release.json').write_text(
            json.dumps({'release_id': release_id, 'commit': os.environ.get('GITHUB_SHA')}), encoding='utf-8')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=OMEGA_ROOT)
    parser.add_argument('--destination', type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument('--with-images', action='store_true', help='Incluir servicios Docker precompilados')
    args = parser.parse_args()
    print(stage(args.source, args.destination, args.with_images))
