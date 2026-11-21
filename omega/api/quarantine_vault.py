"""Encrypted AES-256-GCM quarantine vault, locked evidence capture, and OS metadata preservation."""
from __future__ import annotations

import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import threading
import uuid

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from host_runtime import powershell

MAX_FILE_BYTES = 64 * 1024 * 1024
_LOCK = threading.RLock()


def sync_directory(path: Path):
    if sys.platform != 'win32':
        handle = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


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


@contextmanager
def locked_evidence(path: Path, target: dict):
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


def capture_file_metadata(path: Path) -> dict:
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


def restore_file_metadata(path: Path, metadata: dict, *, fd: int | None = None):
    if not metadata:
        return
    if sys.platform == 'win32':
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
            raise ValueError('No se restauran metadatos sobre enlaces simbólicos.')
        response = powershell("$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:OMEGA_EVIDENCE_PATH; "
                              "$a.SetSecurityDescriptorSddlForm($env:OMEGA_EVIDENCE_SDDL); Set-Acl -LiteralPath $env:OMEGA_EVIDENCE_PATH -AclObject $a",
                              env=dict(os.environ, OMEGA_EVIDENCE_PATH=str(path), OMEGA_EVIDENCE_SDDL=metadata['sddl']))
        if response.returncode:
            raise RuntimeError('El contenido fue restaurado pero falta recuperar sus permisos originales.')
    else:
        # C-02: Preferir operaciones sobre el descriptor abierto (fstat/fchown/setxattr(fd)) para evitar TOCTOU
        if fd is not None:
            current = os.fstat(fd)
            if (current.st_uid, current.st_gid) != (metadata['uid'], metadata['gid']):
                os.fchown(fd, metadata['uid'], metadata['gid'])
            for name, value in metadata.get('xattrs', {}).items():
                os.setxattr(fd, name, base64.b64decode(value, validate=True))
        else:
            if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
                raise ValueError('No se restauran metadatos sobre enlaces simbólicos.')
            current = os.lstat(path)
            if (current.st_uid, current.st_gid) != (metadata['uid'], metadata['gid']):
                os.chown(path, metadata['uid'], metadata['gid'], follow_symlinks=False)
            for name, value in metadata.get('xattrs', {}).items():
                os.setxattr(path, name, base64.b64decode(value, validate=True), follow_symlinks=False)


class QuarantineVault:
    def __init__(self, root: Path, key_provider=secure_os_key):
        self.root = root
        self.key_provider = key_provider

    def derive_key(self, owner: str) -> bytes:
        return self.key_provider(owner + '|' + str(self.root.resolve()))

    def prepare_root(self):
        if self.root.is_symlink() or any(parent.is_symlink() for parent in self.root.parents):
            raise ValueError('La bóveda no puede estar dentro de enlaces simbólicos.')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if sys.platform != 'win32':
            if self.root.stat().st_uid != os.getuid():
                raise ValueError('La bóveda pertenece a otro usuario.')
            self.root.chmod(0o700)
        else:
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
    def exclusive(self, prepare_fn=None):
        with _LOCK:
            (prepare_fn or self.prepare_root)()
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

    def write_record(self, record: dict, owner: str):
        action_id = str(uuid.UUID(record['actionId']))
        nonce = secrets.token_bytes(12)
        raw = json.dumps(record, sort_keys=True).encode()
        if len(raw) > 2 * 1024 * 1024 - 4096:
            raise ValueError('El diario excede el límite recuperable; no se aplica la operación.')
        sealed = nonce + AESGCM(self.derive_key(owner)).encrypt(nonce, raw, (owner + action_id).encode())
        destination = self.root / (action_id + '.manifest')
        temp = self.root / (action_id + '.tmp-' + uuid.uuid4().hex)
        if destination.is_symlink() or temp.exists():
            raise ValueError('Ruta de diario no válida; se conserva para recuperación.')
        with temp.open('xb') as stream:
            stream.write(sealed)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, destination)
        sync_directory(self.root)

    def read_record(self, action_id: str, owner: str) -> dict:
        action_id = str(uuid.UUID(action_id))
        path = self.root / (action_id + '.manifest')
        if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Diario no válido')
        sealed = path.read_bytes()
        return json.loads(AESGCM(self.derive_key(owner)).decrypt(sealed[:12], sealed[12:], (owner + action_id).encode()))

    def seal_bytes(self, action_id: str, expected_sha256: str, content: bytes, owner: str) -> Path:
        nonce = secrets.token_bytes(12)
        ciphertext = nonce + AESGCM(self.derive_key(owner)).encrypt(nonce, content, (owner + action_id + expected_sha256).encode())
        vault = self.root / (action_id + '.quar')
        with vault.open('xb') as stream:
            stream.write(ciphertext)
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(self.root)
        return vault

    def decrypt_file(self, record: dict, owner: str) -> bytes:
        path = self.root / (record['actionId'] + '.quar')
        if path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES + 64:
            raise ValueError('Archivo de cuarentena inválido')
        sealed = path.read_bytes()
        raw = AESGCM(self.derive_key(owner)).decrypt(sealed[:12], sealed[12:], (owner + record['actionId'] + record['target']['sha256']).encode())
        if hashlib.sha256(raw).hexdigest() != record['target']['sha256']:
            raise ValueError('El hash de la evidencia no coincide')
        return raw
