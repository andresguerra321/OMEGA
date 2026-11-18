"""Read-only native host primitives. Never interpret artifact content as commands."""
from __future__ import annotations

import base64
import os
from pathlib import Path
import subprocess
import sys


def host_scope() -> str:
    if Path('/.dockerenv').exists() or os.getenv('OMEGA_HOST_SCOPE') == 'container':
        return 'container'
    return 'native-host'


def application_root() -> Path:
    return Path(sys.executable).resolve().parent.parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent.parent


def run_command(args: list[str], *, timeout: int = 15, env=None, input_text=None):
    return subprocess.run(args, capture_output=True, text=True, errors='replace',
                          timeout=timeout, check=False, env=env, input=input_text,
                          **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))


def powershell(script: str, *, env=None, input_text=None):
    encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
    return run_command(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env=env, input_text=input_text)


def start_sensor(endpoint, *, service=False, stop_event=None):
    """No CLI/env secret: a desktop child receives exactly 64 hex bytes on stdin."""
    import local_auth
    from local_transport import serve
    os.environ['OMEGA_NATIVE_SENSOR'] = '1'
    if service:
        local_auth.ACTIVE = local_auth.LocalAuthenticator()
    else:
        secret = sys.stdin.buffer.read(65)
        sys.stdin.close()
        local_auth.ACTIVE = local_auth.LocalAuthenticator(secret.decode('ascii'))
    # Verify before importing modules which can execute privileged work.
    from self_integrity import verify_release
    verify_release(application_root())
    from main import app
    serve(app, endpoint, service=service, stop_event=stop_event)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--service', action='store_true')
    args = parser.parse_args()
    start_sensor(args.endpoint, service=args.service)
