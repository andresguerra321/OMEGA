"""Prepara los recursos que el instalador Tauri incluye para el modo Self-Hosted.

La app de escritorio levanta PostgreSQL, el worker forense y el gateway Java con
`docker compose`, y el compose construye las imágenes desde fuentes. Un instalador
no tiene el repositorio, así que se empaqueta una copia limpia (sin artefactos de
build ni cachés) en `frontend/src-tauri/bundle-resources/omega/`.
"""
import argparse
from pathlib import Path
import shutil

OMEGA_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = OMEGA_ROOT / 'frontend' / 'src-tauri' / 'bundle-resources'

IGNORED = shutil.ignore_patterns(
    'node_modules', 'target', '__pycache__', '.pytest*', '.mypy_cache', '.ruff_cache',
    '.git', '.idea', '.vscode', '*.pyc', '*.log', '.env', '.env.*', '.venv', 'venv',
)

FOLDERS = ('api', 'backend-java', 'corpus_mvp')


def stage(source: Path, destination: Path) -> Path:
    source, destination = source.resolve(), destination.resolve()
    target = destination / 'omega'
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
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=OMEGA_ROOT)
    parser.add_argument('--destination', type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    print(stage(args.source, args.destination))
