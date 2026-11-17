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


def run_command(args: list[str], *, timeout: int = 15, env=None, input_text=None):
    return subprocess.run(args, capture_output=True, text=True, errors='replace',
                          timeout=timeout, check=False, env=env, input=input_text,
                          **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))


def powershell(script: str, *, env=None, input_text=None):
    encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
    return run_command(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env=env, input_text=input_text)
