"""Process identity validation and reversible suspend/resume controls."""
from __future__ import annotations

import hmac
import math
import os
from pathlib import Path
import sys

import psutil

from host_forensics import sha256_file

CRITICAL_NAMES = {
    'system', 'system idle process', 'registry', 'csrss.exe', 'lsass.exe', 'wininit.exe',
    'winlogon.exe', 'services.exe', 'smss.exe', 'svchost.exe', 'launchd', 'windowserver',
    'kernel_task', 'systemd', 'init', 'sshd',
}


def validate_and_measure_process(target: dict, *, with_process: bool = False, psutil_mod=psutil):
    pid = int(target['pid'])
    if target.get('mode', 'suspend') != 'suspend':
        raise ValueError('Terminar un proceso no es reversible; solo se admite suspender y reanudar.')
    own = psutil_mod.Process()
    protected = {
        os.getpid(),
        *(parent.pid for parent in own.parents()),
        *(child.pid for child in own.children(recursive=True)),
    }
    protected.update(int(value) for value in os.getenv('OMEGA_PROTECTED_PIDS', '').split(',') if value.strip().isdigit())
    proc = psutil_mod.Process(pid)
    if pid <= 4 or pid in protected or proc.name().lower() in CRITICAL_NAMES or 'omega' in proc.name().lower():
        raise ValueError('OMEGA no suspende procesos críticos, propios ni de su cadena de ejecución.')
    path = proc.exe()
    if not path or Path(path).resolve() == Path(sys.executable).resolve():
        raise ValueError('No se puede suspender el entorno de ejecución de OMEGA.')
    started = proc.create_time()
    digest = sha256_file(path)
    expected_created = float(target['createTime'])
    if not math.isfinite(expected_created) or abs(started - expected_created) > 0.001 or not hmac.compare_digest(digest, target['sha256'].lower()):
        raise ValueError('La identidad del proceso cambió (PID, fecha de inicio o SHA-256).')
    if proc.status() in (psutil_mod.STATUS_STOPPED, psutil_mod.STATUS_ZOMBIE, psutil_mod.STATUS_DEAD):
        raise ValueError('El proceso ya está suspendido o finalizado; no se cambiará su estado previo.')
    measured = {'pid': pid, 'createTime': started, 'sha256': digest, 'originalPath': path, 'name': proc.name()}
    return (measured, proc) if with_process else measured


def resume_verified_process(target: dict, *, psutil_mod=psutil):
    proc = psutil_mod.Process(target['pid'])
    if abs(proc.create_time() - target['createTime']) > 0.001 or sha256_file(proc.exe()) != target['sha256']:
        raise ValueError('La identidad del proceso cambió; no se reanudará otro proceso.')
    proc.resume()
