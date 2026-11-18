"""Opt-in, host-native incident response with sealed recovery journals.

No action terminates a process. No rollback overwrites a file changed by someone
else. Partial OS failures remain visible and recoverable, never reported as success.
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import ipaddress
import json
import math
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse
import uuid

import psutil
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from host_forensics import sha256_file, verify_binary_signature
from host_runtime import host_scope, powershell, run_command
from persistence_auditor import collect_windows, collect_macos, collect_linux, entry_target

CRITICAL_NAMES = {'system', 'system idle process', 'registry', 'csrss.exe', 'lsass.exe', 'wininit.exe',
                  'winlogon.exe', 'services.exe', 'smss.exe', 'svchost.exe', 'launchd', 'windowserver',
                  'kernel_task', 'systemd', 'init', 'sshd'}
MAX_FILE_BYTES = 64 * 1024 * 1024
_PREVIEW_KEY = secrets.token_bytes(32)
_LOCK = threading.RLock()


def _sync_directory(path: Path):
    if sys.platform != 'win32':
        handle = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


@contextmanager
def _locked_evidence(path: Path, target: dict):
    """Remove the measured object, never a path replaced after inspection."""
    parent_fd = None
    if sys.platform == 'win32':
        import ctypes
        import msvcrt
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetFileInformationByHandle.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.CreateFileW(str(path), 0x80000000 | 0x00010000, 1, None, 3, 0x00200000 | 0x08000000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), 'No se pudo bloquear el archivo para una captura segura.')
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except Exception:
            kernel.CloseHandle(handle)
            raise
        def remove(info):
            # FILE_DISPOSITION_INFO.DeleteFile is a one-byte BOOLEAN, not BOOL.
            disposition = ctypes.c_ubyte(1)
            if not kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
                raise OSError(ctypes.get_last_error(), 'No se pudo retirar el archivo medido; se conserva la copia cifrada.')
    else:
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        parent = os.fstat(parent_fd)
        if parent.st_uid not in (0, os.getuid()) or parent.st_mode & 0o022:
            os.close(parent_fd)
            raise ValueError('El directorio puede ser modificado por otra cuenta; requiere una captura especializada antes de retirar el archivo.')
        try:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except Exception:
            os.close(parent_fd)
            raise
        def remove(info):
            current = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                raise ValueError('El nombre del archivo fue sustituido después de capturarlo.')
            os.unlink(path.name, dir_fd=parent_fd)
    try:
        with os.fdopen(fd, 'rb') as stream:
            measured = os.fstat(stream.fileno())
            expected_id = target.get('fileMetadata', {}).get('fileId', measured.st_ino)
            if not stat.S_ISREG(measured.st_mode) or measured.st_ino != expected_id or measured.st_size > MAX_FILE_BYTES:
                raise ValueError('La identidad o el tamaño del archivo cambió antes de la captura.')
            yield stream, lambda: remove(measured)
    finally:
        if parent_fd is not None:
            os.close(parent_fd)


def emergency_guidance(vector: str = '') -> list[str]:
    guidance = ['Si sospechas vigilancia dirigida, evita abrir enlaces o responder mensajes relacionados.',
                'Desde un equipo confiable, revisa sesiones abiertas y cambia las credenciales que puedan estar expuestas.',
                'Conserva el informe y contacta a un equipo de respuesta a incidentes. No borres ni restablezcas el dispositivo si necesitas preservar evidencia.']
    if any(word in vector.lower() for word in ('ios', 'iphone', 'pegasus', 'spyware')):
        guidance.insert(0, 'En iPhone: Ajustes → Privacidad y seguridad → Modo de aislamiento. Valora con soporte el reinicio requerido si se necesita preservar memoria volátil.')
    else:
        guidance.insert(0, 'Si el riesgo es inmediato, desconecta la red sin apagar el equipo; apagarlo elimina evidencia que solo existe en memoria.')
    return guidance


def secure_os_key(identity: str) -> bytes:
    import keyring
    backend = keyring.get_keyring()
    module = type(backend).__module__
    allowed = ('keyring.backends.Windows', 'keyring.backends.macOS', 'keyring.backends.SecretService', 'keyring.backends.kwallet')
    if not module.startswith(allowed):
        raise RuntimeError('No hay un almacén seguro del SO disponible; no se usará una clave en texto plano.')
    stored = keyring.get_password('OMEGA-Containment-v1', identity)
    if stored is None:
        stored = base64.b64encode(secrets.token_bytes(32)).decode('ascii')
        keyring.set_password('OMEGA-Containment-v1', identity, stored)
    material = base64.b64decode(stored, validate=True)
    if len(material) != 32:
        raise RuntimeError('La clave del almacén seguro no es válida')
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=('OMEGA-vault-v1|' + identity).encode()).derive(material)


def _public_ip(value: str) -> str:
    address = ipaddress.ip_address(value)
    if not address.is_global or address.is_multicast or address.is_unspecified or address.is_reserved:
        raise ValueError('No se permite bloquear loopback, redes privadas, especiales o no enrutables públicamente.')
    if address.version == 6 and (address.ipv4_mapped or address.sixtofour or address.teredo):
        raise ValueError('No se permiten direcciones de transición IPv6 para contención.')
    return str(address)


def protected_addresses() -> set[str]:
    protected = {address.address.split('%')[0] for addresses in psutil.net_if_addrs().values()
                 for address in addresses if address.family in (socket.AF_INET, socket.AF_INET6)}
    if sys.platform == 'win32':
        response = powershell("$ErrorActionPreference='Stop'; @(Get-DnsClientServerAddress | ForEach-Object {$_.ServerAddresses}) | ConvertTo-Json -Compress")
        if response.returncode:
            raise RuntimeError('No se pudieron verificar los servidores DNS protegidos.')
        values = json.loads(response.stdout.lstrip('\ufeff') or '[]')
        protected.update([values] if isinstance(values, str) else values)
    else:
        resolver = Path('/etc/resolv.conf')
        if not resolver.exists():
            raise RuntimeError('No se pudo verificar la configuración DNS local.')
        protected.update(re.findall(r'^nameserver\s+(\S+)', resolver.read_text(), re.M))
    hosts = os.getenv('OMEGA_PROTECTED_HOSTS', '').split(',')
    for name in ('OMEGA_HOST_WORKER_URL', 'OMEGA_FORENSIC_WORKER_URL', 'OMEGA_BACKEND_URL', 'POSTGRES_HOST'):
        value = os.getenv(name, '')
        if value:
            hosts.append(urlparse(value).hostname if '://' in value else value)
    for host in filter(None, (str(value or '').strip() for value in hosts)):
        try:
            protected.update(record[4][0] for record in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM))
        except OSError as exc:
            raise RuntimeError('No se pudo resolver un servidor protegido de OMEGA; se cancela el bloqueo.') from exc
    return {str(ipaddress.ip_address(value.split('%')[0])) for value in protected if value}


class NativeFirewall:
    def __init__(self, platform_name=None, runner=run_command, *, anchor_file=None):
        self.platform = platform_name or sys.platform
        self.run = runner
        self.anchor_file = Path(anchor_file) if anchor_file else Path('/etc/pf.anchors/com.omega.shield')

    def _pf_file(self, plan):
        name = plan['anchor'].rsplit('/', 1)[-1]
        if not re.fullmatch(r'[a-z0-9-]{1,64}', name):
            raise ValueError('Identificador de ancla no válido')
        return Path(str(self.anchor_file) + '.d') / (name + '.conf')

    def _refresh_pf_file(self):
        marker = '# OMEGA managed containment anchors\n'
        if self.anchor_file.is_symlink() or (self.anchor_file.exists() and not self.anchor_file.read_text().startswith(marker)):
            raise ValueError('El archivo de anclas no pertenece a OMEGA; no se sobrescribirá.')
        directory = Path(str(self.anchor_file) + '.d')
        lines = [marker]
        for path in sorted(directory.glob('*.conf')):
            if not re.fullmatch(r'[a-z0-9-]{1,64}', path.stem) or path.is_symlink():
                raise ValueError('Archivo de ancla no válido')
            lines.append(f'anchor "{path.stem}"\nload anchor "{path.stem}" from "{path}"\n')
        temporary = self.anchor_file.with_suffix('.tmp-' + uuid.uuid4().hex)
        with temporary.open('x') as stream:
            stream.write(''.join(lines)); stream.flush(); os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, self.anchor_file)

    def _checked(self, args, **kwargs):
        response = self.run(args, **kwargs)
        if response.returncode:
            raise RuntimeError(f'El firewall rechazó la operación ({args[0]}).')
        return response

    def plan(self, action_id: str, addresses: list[str]) -> dict:
        prefix = 'OMEGA_SHIELD_' + action_id
        if self.platform == 'win32':
            return {'backend': 'netsh', 'prefix': prefix, 'addresses': addresses}
        if self.platform == 'darwin':
            config = Path('/etc/pf.conf').read_text()
            if not re.search(r'^\s*anchor\s+"com\.omega\.shield/\*"', config, re.M):
                raise ValueError('Configura previamente el ancla com.omega.shield/* en pf.conf; OMEGA no reemplazará el firewall global.')
            if not self.anchor_file.is_file() or not self.anchor_file.read_text().startswith('# OMEGA managed containment anchors\n'):
                raise ValueError('Prepara el archivo dedicado de anclas OMEGA antes de aplicar reglas.')
            state = self._checked(['pfctl', '-s', 'info'])
            if 'Status: Enabled' not in state.stdout:
                raise ValueError('PF no está activo; OMEGA no habilitará ni reemplazará el firewall global.')
            return {'backend': 'pfctl', 'prefix': prefix, 'anchor': 'com.omega.shield/' + action_id, 'addresses': addresses}
        backend = 'nft' if shutil.which('nft') else 'iptables' if shutil.which('iptables') else ''
        if not backend:
            raise ValueError('No se encontró nft ni iptables en el equipo.')
        if backend == 'iptables' and any(':' in address for address in addresses):
            raise ValueError('El fallback iptables solo admite IPv4; usa nft para IPv6.')
        return {'backend': backend, 'prefix': prefix, 'chain': 'omega_' + action_id.replace('-', '')[:20], 'addresses': addresses}

    def apply(self, plan: dict):
        backend, addresses = plan['backend'], plan['addresses']
        if backend == 'netsh':
            for index, address in enumerate(addresses):
                for direction in ('in', 'out'):
                    self._checked(['netsh', 'advfirewall', 'firewall', 'add', 'rule',
                                   f"name={plan['prefix']}_{index}_{direction}", f'dir={direction}', 'action=block', f'remoteip={address}', 'enable=yes'])
        elif backend == 'pfctl':
            rules = '\n'.join(f'block drop quick from {address} to any label "{plan["prefix"]}"\nblock drop quick from any to {address} label "{plan["prefix"]}"' for address in addresses)
            path = self._pf_file(plan)
            if path.parent.is_symlink():
                raise ValueError('Directorio de anclas no válido')
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with path.open('x') as stream:
                stream.write(rules + '\n'); stream.flush(); os.fsync(stream.fileno())
            path.chmod(0o600)
            self._refresh_pf_file()
            self._checked(['pfctl', '-a', plan['anchor'], '-f', str(path)])
        elif backend == 'nft':
            # A single nft batch is atomic. Never flush another table or chain.
            exists = self.run(['nft', 'list', 'table', 'inet', 'omega_shield']).returncode == 0
            lines = [] if exists else ['add table inet omega_shield']
            for direction, field in (('input', 'saddr'), ('output', 'daddr')):
                chain = plan['chain'] + '_' + direction
                lines.append(f'add chain inet omega_shield {chain} {{ type filter hook {direction} priority -10; policy accept; }}')
                for address in addresses:
                    family = 'ip6' if ':' in address else 'ip'
                    lines.append(f'add rule inet omega_shield {chain} {family} {field} {address} counter drop comment "{plan["prefix"]}"')
            self._checked(['nft', '-f', '-'], input_text='\n'.join(lines) + '\n')
        else:
            for direction, flag in (('INPUT', '-s'), ('OUTPUT', '-d')):
                for address in addresses:
                    self._checked(['iptables', '-w', '-I', direction, '1', flag, address, '-m', 'comment', '--comment', plan['prefix'], '-j', 'DROP'])

    def rollback(self, plan: dict):
        backend = plan['backend']
        if backend == 'netsh':
            for index, _ in enumerate(plan['addresses']):
                for direction in ('in', 'out'):
                    # Ignore only the documented missing-rule case through a separate query.
                    name = f"name={plan['prefix']}_{index}_{direction}"
                    query = self.run(['netsh', 'advfirewall', 'firewall', 'show', 'rule', name])
                    if query.returncode == 0:
                        self._checked(['netsh', 'advfirewall', 'firewall', 'delete', 'rule', name])
                    elif not any(message in (query.stdout + query.stderr).lower() for message in ('no rules match', 'no hay reglas', 'ninguna regla')):
                        raise RuntimeError('No se pudo comprobar la regla del firewall antes de retirarla.')
        elif backend == 'pfctl':
            self._checked(['pfctl', '-a', plan['anchor'], '-F', 'rules'])
            path = self._pf_file(plan)
            if path.is_symlink():
                raise ValueError('Archivo de ancla no válido')
            if path.exists():
                path.unlink()
            self._refresh_pf_file()
        elif backend == 'nft':
            for direction in ('input', 'output'):
                chain = plan['chain'] + '_' + direction
                query = self.run(['nft', 'list', 'chain', 'inet', 'omega_shield', chain])
                if query.returncode == 0:
                    self._checked(['nft', '-f', '-'], input_text=f'flush chain inet omega_shield {chain}\ndelete chain inet omega_shield {chain}\n')
                elif 'no such file or directory' not in query.stderr.lower():
                    raise RuntimeError('No se pudo comprobar la cadena nft antes de retirarla.')
        else:
            for direction, flag in (('INPUT', '-s'), ('OUTPUT', '-d')):
                for address in plan['addresses']:
                    rule = [direction, flag, address, '-m', 'comment', '--comment', plan['prefix'], '-j', 'DROP']
                    query = self.run(['iptables', '-w', '-C', *rule])
                    if query.returncode == 0:
                        self._checked(['iptables', '-w', '-D', *rule])
                    elif query.returncode != 1:
                        raise RuntimeError('No se pudo comprobar la regla iptables antes de retirarla.')

    def observed_state(self, plan: dict) -> str:
        deadline = time.monotonic() + 2
        def probe(args):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Comprobación de estado agotada')
            return self.run(args, timeout=min(1, remaining))
        try:
            backend = plan['backend']
            if backend == 'netsh':
                queries = [probe(['netsh', 'advfirewall', 'firewall', 'show', 'rule', f"name={plan['prefix']}_{index}_{direction}"])
                           for index in range(len(plan['addresses'])) for direction in ('in', 'out')]
                if all(query.returncode == 0 and plan['prefix'] in query.stdout for query in queries):
                    return 'VERIFIED_ACTIVE'
                return 'DRIFTED' if any('no rules match' in query.stdout.lower() for query in queries) else 'UNKNOWN'
            if backend == 'pfctl':
                query = probe(['pfctl', '-a', plan['anchor'], '-sr'])
                return 'UNKNOWN' if query.returncode else 'VERIFIED_ACTIVE' if plan['prefix'] in query.stdout else 'DRIFTED'
            if backend == 'nft':
                queries = [probe(['nft', 'list', 'chain', 'inet', 'omega_shield', plan['chain'] + '_' + direction]) for direction in ('input', 'output')]
                if all(query.returncode == 0 and plan['prefix'] in query.stdout for query in queries):
                    return 'VERIFIED_ACTIVE'
                return 'DRIFTED' if any('no such file or directory' in query.stderr.lower() for query in queries) else 'UNKNOWN'
            queries = [probe(['iptables', '-w', '-C', direction, flag, address, '-m', 'comment', '--comment', plan['prefix'], '-j', 'DROP'])
                       for direction, flag in (('INPUT', '-s'), ('OUTPUT', '-d')) for address in plan['addresses']]
            return 'VERIFIED_ACTIVE' if all(query.returncode == 0 for query in queries) else 'DRIFTED' if any(query.returncode == 1 for query in queries) else 'UNKNOWN'
        except (OSError, RuntimeError, subprocess.SubprocessError):
            return 'UNKNOWN'


class ContainmentEngine:
    def __init__(self, root=None, *, key_provider=secure_os_key, firewall=None):
        self.root = Path(root) if root else Path(os.environ.get('OMEGA_CONTAINMENT_DIR') or Path.home() / '.omega/quarantine')
        self.key_provider = key_provider
        self.firewall = firewall or NativeFirewall()

    def _key(self, owner: str):
        return self.key_provider(owner + '|' + str(self.root.resolve()))

    def _prepare_root(self):
        if self.root.is_symlink() or any(parent.is_symlink() for parent in self.root.parents):
            raise ValueError('La bóveda no puede estar dentro de enlaces simbólicos.')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if sys.platform != 'win32':
            if self.root.stat().st_uid != os.getuid():
                raise ValueError('La bóveda pertenece a otro usuario.')
            self.root.chmod(0o700)
        else:
            # DPAPI-backed credentials secure the key; restrict the ciphertext/journal directory too.
            sid = powershell("[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value")
            if sid.returncode or not re.fullmatch(r'S-1-[0-9-]+', sid.stdout.strip()):
                raise RuntimeError('No se pudo verificar el propietario de la bóveda.')
            permissions = powershell("$ErrorActionPreference='Stop'; $a=New-Object System.Security.AccessControl.DirectorySecurity; "
                                    "$a.SetAccessRuleProtection($true,$false); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $a.SetOwner($sid); "
                                    "foreach($s in @($sid.Value,'S-1-5-18')) { $id=New-Object System.Security.Principal.SecurityIdentifier($s); "
                                    "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($rule) }; "
                                    "Set-Acl -LiteralPath $env:OMEGA_VAULT_PATH -AclObject $a", env=dict(os.environ, OMEGA_VAULT_PATH=str(self.root)))
            if permissions.returncode:
                raise RuntimeError('No se pudieron proteger los permisos de la bóveda.')

    @contextmanager
    def _exclusive(self):
        with _LOCK:
            self._prepare_root()
            lock_path = self.root / '.lock'
            if lock_path.is_symlink():
                raise ValueError('Archivo de bloqueo inválido')
            with lock_path.open('a+b') as lock:
                lock.seek(0)
                if lock.read(1) == b'':
                    lock.write(b'0')
                    lock.flush()
                lock.seek(0)
                if sys.platform == 'win32':
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                try:
                    yield
                finally:
                    if sys.platform == 'win32':
                        lock.seek(0)
                        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)

    def _write_record(self, record: dict, owner: str):
        action_id = str(uuid.UUID(record['actionId']))
        nonce = secrets.token_bytes(12)
        raw = json.dumps(record, sort_keys=True).encode()
        if len(raw) > 2 * 1024 * 1024 - 4096:
            raise ValueError('El diario excede el límite recuperable; no se aplica la operación.')
        sealed = nonce + AESGCM(self._key(owner)).encrypt(nonce, raw, (owner + action_id).encode())
        destination = self.root / (action_id + '.manifest')
        temp = self.root / (action_id + '.tmp-' + uuid.uuid4().hex)
        if destination.is_symlink() or temp.exists():
            raise ValueError('Ruta de diario no válida; se conserva para recuperación.')
        with temp.open('xb') as stream:
            stream.write(sealed)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, destination)
        _sync_directory(self.root)

    def _read_record(self, action_id: str, owner: str):
        action_id = str(uuid.UUID(action_id))
        path = self.root / (action_id + '.manifest')
        if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Diario no válido')
        sealed = path.read_bytes()
        return json.loads(AESGCM(self._key(owner)).decrypt(sealed[:12], sealed[12:], (owner + action_id).encode()))

    def history(self, owner: str) -> list[dict]:
        if not self.root.exists():
            return []
        with self._exclusive():
            rows, checks = [], 0
            for path in sorted(self.root.glob('*.manifest'), key=lambda item: item.stat().st_mtime, reverse=True)[:500]:
                try:
                    record = self._read_record(path.stem, owner)
                    if record['status'] == 'ACTIVE' and record['actionType'] == 'BLOCK_NETWORK_INDICATOR':
                        record['observedState'] = self.firewall.observed_state(record['target']['firewall']) if checks < 5 else 'NOT_CHECKED'
                        checks += 1
                    rows.append(record)
                except Exception:
                    rows.append({'actionId': path.stem, 'status': 'RECOVERY_REQUIRED', 'message': 'No se pudo autenticar el diario o recuperar su clave. No se ha modificado la evidencia.'})
            return sorted(rows, key=lambda row: row.get('timestamp', ''), reverse=True)

    def _process_target(self, target: dict, *, with_process=False):
        pid = int(target['pid'])
        if target.get('mode', 'suspend') != 'suspend':
            raise ValueError('Terminar un proceso no es reversible; solo se admite suspender y reanudar.')
        own = psutil.Process()
        protected = {os.getpid(), *(parent.pid for parent in own.parents()), *(child.pid for child in own.children(recursive=True))}
        protected.update(int(value) for value in os.getenv('OMEGA_PROTECTED_PIDS', '').split(',') if value.strip().isdigit())
        proc = psutil.Process(pid)
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
        if proc.status() in (psutil.STATUS_STOPPED, psutil.STATUS_ZOMBIE, psutil.STATUS_DEAD):
            raise ValueError('El proceso ya está suspendido o finalizado; no se cambiará su estado previo.')
        measured = {'pid': pid, 'createTime': started, 'sha256': digest, 'originalPath': path, 'name': proc.name()}
        return (measured, proc) if with_process else measured

    def _network_target(self, target: dict) -> dict:
        indicator = str(target['indicator']).strip().lower().rstrip('.')
        try:
            addresses = [_public_ip(indicator)]
        except ValueError:
            if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', indicator):
                raise ValueError('Usa una IP pública individual o un dominio válido, sin rangos ni comandos.')
            addresses = sorted({_public_ip(row[4][0]) for row in socket.getaddrinfo(indicator, None, type=socket.SOCK_STREAM)})
        if not addresses or len(addresses) > 16:
            raise ValueError('El destino no se pudo resolver de forma acotada.')
        if set(addresses).intersection(protected_addresses()):
            raise ValueError('No se permite bloquear DNS configurados, interfaces locales ni servidores de OMEGA.')
        return {'indicator': indicator, 'addresses': addresses}

    def _persistence_target(self, target: dict) -> dict:
        entries, _ = collect_windows() if sys.platform == 'win32' else collect_macos(Path.home()) if sys.platform == 'darwin' else collect_linux(Path.home())
        entry = next((entry for entry in entries if entry.get('location') == target['location'] and entry.get('persistenceType') == target['persistenceType']), None)
        if not entry or entry['persistenceType'] not in ('Run', 'RunOnce', 'ScheduledTask', 'LaunchAgents', 'LaunchDaemons', 'Systemd'):
            raise ValueError('El elemento no pertenece al inventario nativo de persistencia soportado.')
        path = Path(entry_target(entry, sys.platform))
        if not path.is_absolute() or path.is_symlink() or not path.is_file() or any(parent.is_symlink() for parent in path.parents):
            raise ValueError('El objetivo debe ser un archivo regular absoluto sin enlaces simbólicos.')
        resolved = path.resolve()
        if str(resolved) != str(Path(target['targetPath']).resolve()):
            raise ValueError('La ruta ya no coincide con la persistencia observada.')
        normalized = str(resolved).replace('\\', '/').lower()
        protected = [str(Path(__file__).resolve().parents[1]).replace('\\', '/').lower(), str(self.root.resolve()).replace('\\', '/').lower()]
        protected += [os.getenv('SystemRoot', 'C:/Windows').replace('\\', '/').lower()] if sys.platform == 'win32' else ['/system', '/sbin', '/usr', '/bin', '/lib', '/boot']
        if any(normalized == prefix or normalized.startswith(prefix + '/') for prefix in protected) or path.name.lower() in CRITICAL_NAMES:
            raise ValueError('El archivo pertenece a una ruta protegida del SO o de OMEGA.')
        if path.stat().st_size > MAX_FILE_BYTES or path.stat().st_nlink != 1:
            raise ValueError('La cuarentena admite archivos de hasta 64 MiB y sin enlaces duros adicionales.')
        signature = verify_binary_signature(str(path))
        if signature['status'] == 'Valid' and any(vendor in signature.get('publisher', '').lower() for vendor in ('microsoft', 'apple')):
            raise ValueError('No se pone en cuarentena código del fabricante del SO.')
        digest = sha256_file(str(path))
        if not hmac.compare_digest(digest, target['sha256'].lower()):
            raise ValueError('El hash del elemento cambió; repite el diagnóstico.')
        metadata = self._file_metadata(path)
        configuration = Path(entry['location'])
        configuration_hash = sha256_file(str(configuration)) if configuration.is_absolute() and configuration.is_file() else ''
        return {'originalPath': str(resolved), 'sha256': digest, 'mode': stat.S_IMODE(path.stat().st_mode),
                'mtimeNs': path.stat().st_mtime_ns, 'fileMetadata': metadata, 'configurationHash': configuration_hash,
                'entry': entry, 'persistence': self._persistence_snapshot(entry)}

    def _file_metadata(self, path: Path):
        info = path.stat()
        if sys.platform == 'win32':
            if ':' in str(path)[2:] or getattr(path, 'is_junction', lambda: False)():
                raise ValueError('No se ponen en cuarentena flujos alternativos ni uniones del sistema de archivos.')
            response = powershell("$ErrorActionPreference='Stop'; $p=$env:OMEGA_EVIDENCE_PATH; "
                                  "$streams=@(Get-Item -LiteralPath $p -Stream * | Select-Object -ExpandProperty Stream); "
                                  "@{sddl=(Get-Acl -LiteralPath $p).Sddl;streams=$streams}|ConvertTo-Json -Compress",
                                  env=dict(os.environ, OMEGA_EVIDENCE_PATH=str(path)))
            if response.returncode:
                raise ValueError('No se pudieron preservar los permisos y flujos del archivo.')
            metadata = json.loads(response.stdout.lstrip('\ufeff'))
            if any(stream != ':$DATA' for stream in metadata['streams']):
                raise ValueError('El archivo contiene flujos NTFS adicionales. Requiere captura forense antes de retirarlo.')
            return {'sddl': metadata['sddl'], 'fileId': info.st_ino, 'ctimeNs': info.st_ctime_ns}
        attributes = {}
        if hasattr(os, 'listxattr'):
            for name in os.listxattr(path):
                raw = os.getxattr(path, name)
                if len(raw) > 64000 or sum(len(value) for value in attributes.values()) > 256000:
                    raise ValueError('Metadatos extendidos demasiado grandes; requiere captura forense.')
                attributes[name] = base64.b64encode(raw).decode('ascii')
        return {'uid': info.st_uid, 'gid': info.st_gid, 'fileId': info.st_ino, 'ctimeNs': info.st_ctime_ns, 'xattrs': attributes}

    def _restore_file_metadata(self, path: Path, metadata: dict):
        if not metadata:
            return
        if sys.platform == 'win32':
            response = powershell("$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:OMEGA_EVIDENCE_PATH; "
                                  "$a.SetSecurityDescriptorSddlForm($env:OMEGA_EVIDENCE_SDDL); Set-Acl -LiteralPath $env:OMEGA_EVIDENCE_PATH -AclObject $a",
                                  env=dict(os.environ, OMEGA_EVIDENCE_PATH=str(path), OMEGA_EVIDENCE_SDDL=metadata['sddl']))
            if response.returncode:
                raise RuntimeError('El contenido fue restaurado pero falta recuperar sus permisos originales.')
        else:
            current = path.stat()
            if (current.st_uid, current.st_gid) != (metadata['uid'], metadata['gid']):
                os.chown(path, metadata['uid'], metadata['gid'])
            for name, value in metadata.get('xattrs', {}).items():
                os.setxattr(path, name, base64.b64decode(value, validate=True))

    def _persistence_snapshot(self, entry: dict) -> dict:
        kind = entry['persistenceType']
        if kind in ('Run', 'RunOnce'):
            import winreg
            hive, view, subkey, name = entry['location'].split('/', 3)
            root = winreg.HKEY_CURRENT_USER if hive == 'HKCU' else winreg.HKEY_LOCAL_MACHINE
            flag = winreg.KEY_WOW64_64KEY if view == 'Registry64' else winreg.KEY_WOW64_32KEY
            key = 'Software\\Microsoft\\Windows\\CurrentVersion\\' + subkey
            with winreg.OpenKey(root, key, 0, winreg.KEY_READ | flag) as registry:
                value, value_type = winreg.QueryValueEx(registry, name)
            if value_type not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                raise ValueError('Tipo de registro no soportado para restauración.')
            return {'hive': hive, 'view': view, 'key': key, 'name': name, 'value': value, 'valueType': value_type}
        if kind == 'ScheduledTask':
            response = run_command(['schtasks', '/Query', '/TN', entry['location'], '/XML'])
            if response.returncode:
                raise ValueError('No se pudo guardar el estado de la tarea.')
            normalized = re.sub(r'<Enabled>\s*(?:true|false)\s*</Enabled>', '<Enabled>STATE</Enabled>', response.stdout)
            return {'enabled': not bool(re.search(r'<Enabled>\s*false\s*</Enabled>', response.stdout)), 'task': entry['location'],
                    'configurationHash': hashlib.sha256(normalized.encode()).hexdigest()}
        if kind == 'Systemd':
            props = entry.get('evidence') or {}
            unit = props.get('Id', '')
            if not re.fullmatch(r'[a-zA-Z0-9_.@:-]+\.(?:service|timer)', unit):
                raise ValueError('Unidad systemd inválida')
            prefix = ['systemctl'] + (['--user'] if props.get('userMode') else [])
            enabled = run_command(prefix + ['is-enabled', '--', unit]).stdout.strip()
            if enabled not in ('enabled', 'disabled'):
                raise ValueError('La unidad no admite una reversión segura de su estado de arranque.')
            return {'unit': unit, 'userMode': bool(props.get('userMode')), 'enabled': enabled == 'enabled'}
        plist = plistlib.loads(Path(entry['location']).read_bytes())
        label = plist.get('Label', '')
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+', label):
            raise ValueError('Etiqueta launchd inválida')
        domain = 'system' if kind == 'LaunchDaemons' else 'gui/' + str(os.getuid())
        response = run_command(['launchctl', 'print-disabled', domain])
        if response.returncode:
            raise ValueError('No se pudo guardar el estado de launchd')
        disabled = bool(re.search('"' + re.escape(label) + r'"\s*=>\s*true', response.stdout))
        return {'service': domain + '/' + label, 'enabled': not disabled}

    def _set_persistence(self, target: dict, restore: bool):
        if target.get('configurationHash') and sha256_file(target['entry']['location']) != target['configurationHash']:
            raise ValueError('La configuración de arranque cambió; no se modificará automáticamente.')
        snapshot, kind = target['persistence'], target['entry']['persistenceType']
        if kind in ('Run', 'RunOnce'):
            import winreg
            root = winreg.HKEY_CURRENT_USER if snapshot['hive'] == 'HKCU' else winreg.HKEY_LOCAL_MACHINE
            flag = winreg.KEY_WOW64_64KEY if snapshot['view'] == 'Registry64' else winreg.KEY_WOW64_32KEY
            with winreg.OpenKey(root, snapshot['key'], 0, winreg.KEY_READ | winreg.KEY_SET_VALUE | flag) as registry:
                try:
                    value, value_type = winreg.QueryValueEx(registry, snapshot['name'])
                except FileNotFoundError:
                    value, value_type = None, None
                if restore:
                    if value is not None and (value, value_type) != (snapshot['value'], snapshot['valueType']):
                        raise ValueError('La entrada de inicio fue modificada; no se sobrescribirá.')
                    winreg.SetValueEx(registry, snapshot['name'], 0, snapshot['valueType'], snapshot['value'])
                elif value == snapshot['value'] and value_type == snapshot['valueType']:
                    winreg.DeleteValue(registry, snapshot['name'])
                else:
                    raise ValueError('La entrada cambió después de la previsualización.')
            return
        enabled = snapshot['enabled'] if restore else False
        if kind == 'ScheduledTask':
            current = run_command(['schtasks', '/Query', '/TN', snapshot['task'], '/XML'])
            normalized = re.sub(r'<Enabled>\s*(?:true|false)\s*</Enabled>', '<Enabled>STATE</Enabled>', current.stdout)
            if current.returncode or hashlib.sha256(normalized.encode()).hexdigest() != snapshot['configurationHash']:
                raise ValueError('La tarea fue modificada; no se reactivará una configuración distinta.')
            args = ['schtasks', '/Change', '/TN', snapshot['task'], '/Enable' if enabled else '/Disable']
        elif kind == 'Systemd':
            args = ['systemctl'] + (['--user'] if snapshot['userMode'] else []) + ['enable' if enabled else 'disable', '--', snapshot['unit']]
        else:
            args = ['launchctl', 'enable' if enabled else 'disable', snapshot['service']]
        if run_command(args).returncode:
            raise RuntimeError('No se pudo cambiar el estado del arranque; la evidencia se conserva en la bóveda.')

    def _plan(self, action_type: str, target: dict, action_id: str) -> dict:
        if host_scope() != 'native-host':
            raise ValueError('La contención requiere un sensor nativo; no se ejecuta contra el contenedor.')
        if action_type == 'BLOCK_NETWORK_INDICATOR':
            measured = self._network_target(target)
            measured['firewall'] = self.firewall.plan(action_id, measured['addresses'])
            impact = 'Se crearán reglas para bloquear estas IPs en ambas direcciones. Una IP compartida puede afectar otros servicios. No sigue cambios DNS ni garantiza cortar conexiones ya establecidas; verifica el resultado.'
        elif action_type == 'SUSPEND_OR_TERMINATE_PROCESS':
            measured = self._process_target(target)
            impact = 'El proceso quedará suspendido, conservando su memoria. Podrás reanudarlo mientras siga existiendo con la misma identidad.'
        elif action_type == 'QUARANTINE_PERSISTENCE_ITEM':
            measured = self._persistence_target(target)
            impact = 'Se deshabilitará el inicio futuro y se guardará una copia cifrada antes de retirar el archivo original. Un proceso ya en ejecución no se detiene con esta acción.'
        else:
            raise ValueError('Acción de contención no soportada')
        return {'actionId': action_id, 'actionType': action_type, 'target': measured, 'impact': impact,
                'hostname': socket.gethostname(), 'platform': sys.platform,
                'executionEnabled': os.getenv('OMEGA_CONTAINMENT_ENABLED', '').lower() == 'true'}

    def execute_containment(self, action_type: str, target: dict, *, owner: str, dry_run=True, preview_token=None, actor_user_id=None) -> dict:
        if not owner:
            raise ValueError('Falta el tenant propietario')
        if dry_run:
            plan = self._plan(action_type, target, str(uuid.uuid4()))
            payload = json.dumps({'owner': owner, 'actor': actor_user_id, 'expires': time.time() + 180, 'request': [action_type, target], 'plan': plan}, sort_keys=True).encode()
            token = base64.urlsafe_b64encode(payload + hmac.digest(_PREVIEW_KEY, payload, 'sha256')).decode()
            if len(token) > 250000:
                raise ValueError('El plan excede el límite de metadatos admitido para contención automática.')
            return {**plan, 'dryRun': True, 'status': 'PREVIEW', 'previewToken': token, 'guidance': emergency_guidance(str(target.get('vector', '')))}
        if os.getenv('OMEGA_CONTAINMENT_ENABLED', '').lower() != 'true':
            raise ValueError('La contención está deshabilitada en este sensor (OMEGA_CONTAINMENT_ENABLED).')
        try:
            packed = base64.urlsafe_b64decode(preview_token or '')
            payload, signature = packed[:-32], packed[-32:]
            if not hmac.compare_digest(signature, hmac.digest(_PREVIEW_KEY, payload, 'sha256')):
                raise ValueError('Previsualización no válida')
            preview = json.loads(payload)
            if preview['owner'] != owner or preview.get('actor') != actor_user_id or preview['expires'] < time.time() or preview['request'] != [action_type, target]:
                raise ValueError('La previsualización expiró o no corresponde a este objetivo.')
        except (ValueError, KeyError, TypeError) as exc:
            raise ValueError('Previsualiza nuevamente antes de aplicar la contención.') from exc
        with self._exclusive():
            if preview['expires'] < time.time():
                raise ValueError('La previsualización expiró mientras esperaba; revisa un plan nuevo.')
            action_id = preview['plan']['actionId']
            if (self.root / (action_id + '.manifest')).exists():
                return self._read_record(action_id, owner)
            plan = self._plan(action_type, target, preview['plan']['actionId'])
            if plan != preview['plan']:
                raise ValueError('El objetivo cambió desde la previsualización; revisa un plan nuevo.')
            record = {**plan, 'timestamp': datetime.now(timezone.utc).isoformat(), 'dryRun': False,
                      'status': 'PREPARED', 'owner': owner, 'actorUserId': actor_user_id, 'steps': {}, 'guidance': emergency_guidance(str(target.get('vector', '')))}
            self._write_record(record, owner)
            try:
                if action_type == 'BLOCK_NETWORK_INDICATOR':
                    record['steps']['firewallAttempted'] = True
                    self._write_record(record, owner)
                    self.firewall.apply(plan['target']['firewall'])
                elif action_type == 'SUSPEND_OR_TERMINATE_PROCESS':
                    measured, proc = self._process_target(target, with_process=True)
                    if measured != plan['target']:
                        raise ValueError('El proceso cambió antes de suspenderlo.')
                    record['steps']['suspendAttempted'] = True
                    self._write_record(record, owner)
                    proc.suspend()
                else:
                    self._quarantine(record, owner)
                record['status'] = 'ACTIVE'
                self._write_record(record, owner)
            except Exception as exc:
                record['status'], record['error'] = 'RECOVERY_REQUIRED', type(exc).__name__
                record['errorMessage'] = str(exc)[:500] if isinstance(exc, (ValueError, RuntimeError)) else 'El SO o el almacén seguro impidió completar la operación.'
                try:
                    self._restore_steps(record, owner)
                    record['status'] = 'ROLLED_BACK'
                    record['result'] = 'FAILED_COMPENSATED'
                except Exception as recovery_error:
                    record['recoveryError'] = type(recovery_error).__name__
                self._write_record(record, owner)
            return record

    def _quarantine(self, record: dict, owner: str):
        target, action_id = record['target'], record['actionId']
        source = Path(target['originalPath'])
        with _locked_evidence(source, target) as (locked, remove_source):
            content = locked.read(MAX_FILE_BYTES + 1)
            if len(content) > MAX_FILE_BYTES or hashlib.sha256(content).hexdigest() != target['sha256']:
                raise ValueError('El archivo cambió antes de cifrarlo.')
            nonce = secrets.token_bytes(12)
            ciphertext = nonce + AESGCM(self._key(owner)).encrypt(nonce, content, (owner + action_id + target['sha256']).encode())
            vault = self.root / (action_id + '.quar')
            with vault.open('xb') as stream:
                stream.write(ciphertext)
                stream.flush()
                os.fsync(stream.fileno())
            _sync_directory(self.root)
            # Authenticate the stored copy before touching the source or its startup entry.
            self._decrypt_file(record, owner)
            record['steps']['sealed'] = True
            record['steps']['persistenceAttempted'] = True
            self._write_record(record, owner)
            self._set_persistence(target, restore=False)
            locked.seek(0)
            if hashlib.sha256(locked.read(MAX_FILE_BYTES + 1)).hexdigest() != target['sha256']:
                raise ValueError('El archivo cambió antes de retirarlo; la entrada queda deshabilitada y el estado es recuperable.')
            remove_source()
            record['steps']['originalRemoved'] = True
            self._write_record(record, owner)

    def _decrypt_file(self, record, owner):
        path = self.root / (record['actionId'] + '.quar')
        if path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES + 64:
            raise ValueError('Archivo de cuarentena inválido')
        sealed = path.read_bytes()
        raw = AESGCM(self._key(owner)).decrypt(sealed[:12], sealed[12:], (owner + record['actionId'] + record['target']['sha256']).encode())
        if hashlib.sha256(raw).hexdigest() != record['target']['sha256']:
            raise ValueError('El hash de la evidencia no coincide')
        return raw

    def _restore_steps(self, record: dict, owner: str):
        target, steps = record['target'], record['steps']
        if record['actionType'] == 'BLOCK_NETWORK_INDICATOR' and steps.get('firewallAttempted'):
            self.firewall.rollback(target['firewall'])
        elif record['actionType'] == 'SUSPEND_OR_TERMINATE_PROCESS' and steps.get('suspendAttempted'):
            proc = psutil.Process(target['pid'])
            if abs(proc.create_time() - target['createTime']) > 0.001 or sha256_file(proc.exe()) != target['sha256']:
                raise ValueError('La identidad del proceso cambió; no se reanudará otro proceso.')
            proc.resume()
        elif record['actionType'] == 'QUARANTINE_PERSISTENCE_ITEM':
            source = Path(target['originalPath'])
            if source.is_symlink() or any(parent.is_symlink() for parent in source.parents):
                raise ValueError('La ruta original cambió a un enlace simbólico.')
            if source.exists():
                if sha256_file(str(source)) != target['sha256']:
                    raise ValueError('Existe un archivo diferente en la ruta original; no se sobrescribirá.')
            elif steps.get('sealed'):
                raw = self._decrypt_file(record, owner)
                with source.open('xb') as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
            if steps.get('sealed'):
                self._restore_file_metadata(source, target.get('fileMetadata', {}))
                source.chmod(target['mode'])
                os.utime(source, ns=(target['mtimeNs'], target['mtimeNs']))
            if steps.get('persistenceAttempted'):
                self._set_persistence(target, restore=True)

    def rollback_containment(self, action_id: str, *, owner: str) -> dict:
        if host_scope() != 'native-host':
            raise ValueError('La restauración debe realizarse en el equipo nativo propietario de la bóveda.')
        with self._exclusive():
            record = self._read_record(action_id, owner)
            if record['status'] == 'ROLLED_BACK':
                return record
            try:
                self._restore_steps(record, owner)
                record['status'] = 'ROLLED_BACK'
                record['rolledBackAt'] = datetime.now(timezone.utc).isoformat()
                record.pop('error', None)
                record.pop('errorMessage', None)
            except Exception as exc:
                record['status'], record['error'] = 'RECOVERY_REQUIRED', type(exc).__name__
                record['errorMessage'] = str(exc)[:500] if isinstance(exc, (ValueError, RuntimeError)) else 'No se pudo autenticar la copia o recuperar el estado del SO. La operación no se declara restaurada.'
            self._write_record(record, owner)
            return record


engine = ContainmentEngine()
