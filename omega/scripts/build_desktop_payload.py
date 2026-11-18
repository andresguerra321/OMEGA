"""Build-time only: stage a signed release and bundle the sensor's Python runtime."""
import argparse
import base64
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from release_integrity import sign_source_tree


def smoke_sensor(source, destination):
    """A release must run without the build interpreter before it can be packaged."""
    executable = destination / 'sensor_runtime' / ('omega-sensor.exe' if sys.platform == 'win32' else 'omega-sensor')
    subprocess.run([str(executable), '--verify-only'], check=True, timeout=30)
    tenant = str(uuid.uuid4())
    environment = {**os.environ, 'OMEGA_HOST_OWNER_TENANT_ID': tenant,
                   'OMEGA_REALTIME_ENABLED': 'false', 'OMEGA_CONTAINMENT_ENABLED': 'false'}
    environment.pop('INTERNAL_SERVICE_TOKEN', None)
    with tempfile.TemporaryDirectory(prefix='omega-sensor-smoke-') as directory:
        if sys.platform == 'win32':
            import re
            identity = subprocess.check_output(['whoami.exe', '/user', '/fo', 'csv', '/nh'], text=True)
            environment['OMEGA_SENSOR_USER_SID'] = re.search(r'S-1-5-21-(?:\d+-){3}\d+', identity).group()
            endpoint = r'\\.\pipe\omega-agent-' + uuid.uuid4().hex
        else:
            endpoint = str(Path(directory) / 'sensor.sock')
        process = subprocess.Popen([str(executable), '--service', '--endpoint', endpoint], env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))
        try:
            script = '''const {connectHostSensor}=await import(process.argv[1]);
let sensor; for(let i=0;i<80;i++){try{sensor=await connectHostSensor({endpoint:process.argv[2],tenant:process.argv[3]});break;}catch(e){if(i===79)throw e;await new Promise(r=>setTimeout(r,100));}}
const health=await sensor.request('GET','/api/health'); if(health.service!=='omega-forensic-worker'||!health.integrity_verified)throw Error('Invalid bundled sensor');
const status=await sensor.request('GET','/api/host/realtime/status'); if(status.scope!=='native-host')throw Error('Invalid host scope'); sensor.close();'''
            subprocess.run(['node', '--input-type=module', '-e', script,
                (source / 'frontend/electron/hostSensor.js').as_uri(), endpoint, tenant], check=True, timeout=30)
        finally:
            process.terminate()
            try:
                output, error = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                output, error = process.communicate()
            if error:
                print(error.decode(errors='replace')[-3000:], file=sys.stderr)


def build(source, destination):
    source, destination = source.resolve(), destination.resolve()
    if destination.exists():
        raise RuntimeError('Se requiere un directorio de staging nuevo')
    destination.mkdir(parents=True)
    ignored = shutil.ignore_patterns('node_modules', 'target', '__pycache__', '.pytest*', '.git',
                                    '*.pyc', '*.log', '.env', '.venv', 'venv')
    for folder in ('api', 'backend-java', 'rag_engine', 'corpus_mvp', 'scripts', 'db'):
        if (source / folder).exists():
            shutil.copytree(source / folder, destination / folder, ignore=ignored)
    for filename in ('docker-compose.yml', 'docker-compose.prod.yml', '.env.example'):
        shutil.copy2(source / filename, destination / filename)
    target = destination / 'frontend/electron'
    target.mkdir(parents=True)
    shutil.copy2(source / 'frontend/electron/securityHardening.js', target)
    material = os.environ.pop('OMEGA_INTEGRITY_SIGNING_KEY', '').replace('\\n', '\n').encode()
    if not material:
        if os.environ.get('GITHUB_REF', '').startswith('refs/tags/'):
            raise RuntimeError('La publicación requiere OMEGA_INTEGRITY_SIGNING_KEY en CI')
        key = Ed25519PrivateKey.generate()
        material = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        print('Build de prueba: ancla Ed25519 efímera, sin guardar la clave privada.', file=sys.stderr)
    # Freeze the already embedded anchor into the binary, then sign the complete payload.
    sign_source_tree(destination, material)
    if sys.platform != 'win32':
        print(str(destination))
        return
    work = destination.parent / 'freeze-work'
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir', '--console',
        '--name', 'omega-sensor', '--distpath', str(work / 'dist'), '--workpath', str(work / 'build'),
        '--specpath', str(work), '--paths', str(destination / 'api'),
        '--collect-submodules', 'keyring.backends', '--collect-all', 'tldextract',
        str(destination / 'api/sensor_entry.py')], check=True)
    shutil.copytree(work / 'dist/omega-sensor', destination / 'sensor_runtime')
    sign_source_tree(destination, material)
    smoke_sensor(source, destination)
    print(str(destination))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.destination)
