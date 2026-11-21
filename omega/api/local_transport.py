"""Bounded JSON-line RPC to ASGI over user-only UDS or a local Windows named pipe."""
import asyncio
import base64
import ctypes
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import threading
import signal
import errno

import httpx
import local_auth

MAX_FRAME = 2 * 1024 * 1024


class BootstrapGate:
    """Atomic single-use gate for {'bootstrap': True} in --service mode (C-05)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._consumed = False

    def try_consume(self) -> bool:
        with self._lock:
            if self._consumed:
                return False
            self._consumed = True
            return True


def _get_windows_pipe_client_pid(pipe) -> int:
    pid = ctypes.c_ulong(0)
    ok = ctypes.windll.kernel32.GetNamedPipeClientProcessId(int(pipe), ctypes.byref(pid))
    if not ok or pid.value <= 0:
        raise PermissionError('No se pudo verificar el PID del proceso cliente del Named Pipe')
    return int(pid.value)


def _verify_windows_client_process(pipe) -> int:
    client_pid = _get_windows_pipe_client_pid(pipe)
    expected_pid_raw = (os.environ.get('OMEGA_SENSOR_CLIENT_PID') or '').strip()
    if expected_pid_raw:
        if not expected_pid_raw.isdigit() or client_pid != int(expected_pid_raw):
            raise PermissionError('Proceso cliente no autorizado en Named Pipe')
    return client_pid


def _verify_unix_peer_cred(conn) -> tuple[int, int, int]:
    if not hasattr(socket, 'SO_PEERCRED'):
        raise PermissionError('SO_PEERCRED no disponible en esta plataforma')
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    pid, uid, gid = struct.unpack('3i', raw)
    expected_uid = int(os.environ['OMEGA_SENSOR_UID']) if os.environ.get('OMEGA_SENSOR_UID') else os.getuid()
    if pid <= 0 or uid != expected_uid:
        raise PermissionError('Credenciales de proceso cliente no autorizadas en socket Unix')
    expected_pid_raw = (os.environ.get('OMEGA_SENSOR_CLIENT_PID') or '').strip()
    if expected_pid_raw:
        if not expected_pid_raw.isdigit() or pid != int(expected_pid_raw):
            raise PermissionError('PID de proceso cliente no autorizado en socket Unix')
    return pid, uid, gid


async def dispatch(app, raw, service, bootstrap_gate=None, peer_verified=True):
    try:
        message = json.loads(raw)
        if service and message == {'bootstrap': True}:
            if not peer_verified:
                return b'{"status":403,"headers":{},"body":""}\n'
            gate = bootstrap_gate if bootstrap_gate is not None else BootstrapGate()
            if not gate.try_consume():
                return b'{"status":403,"headers":{},"body":""}\n'
            return json.dumps({'secret': local_auth.ACTIVE.secret}).encode() + b'\n'
        method, target = message['method'], message['target']
        if method not in ('GET', 'POST') or not target.startswith('/api/') or len(target) > 2048:
            raise ValueError('Ruta RPC inválida')
        body = base64.b64decode(message.get('body', ''), validate=True)
        headers = message.get('headers', {})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://sensor') as client:
            response = await client.request(method, target, headers=headers, content=body)
        result = {'status': response.status_code, 'headers': dict(response.headers),
                  'body': base64.b64encode(response.content).decode()}
    except Exception:
        result = {'status': 400, 'headers': {}, 'body': ''}
    encoded = json.dumps(result).encode() + b'\n'
    if len(encoded) > MAX_FRAME:
        return b'{"status":413,"headers":{},"body":""}\n'
    return encoded


def windows_pipe_security(sid):
    if not re.fullmatch(r'S-1-5-21-(?:\d+-){3}\d+', sid or ''):
        raise ValueError('Se requiere el SID explícito del usuario autorizado')
    import pywintypes
    import win32security
    attrs = pywintypes.SECURITY_ATTRIBUTES()
    attrs.SECURITY_DESCRIPTOR = win32security.ConvertStringSecurityDescriptorToSecurityDescriptor(
        f'D:P(A;;GA;;;SY)(A;;GRGW;;;{sid})', 1)
    return attrs


def _windows_server(endpoint, handle, stop):
    import pywintypes
    import win32event
    import win32file
    import win32pipe
    if not re.fullmatch(r'\\\\\.\\pipe\\omega-agent-[a-zA-Z0-9-]{1,80}', endpoint):
        raise ValueError('Nombre de pipe inválido')
    security = windows_pipe_security(os.environ.get('OMEGA_SENSOR_USER_SID'))
    # C-04: Crear el Named Pipe una sola vez fuera del bucle para eliminar pipe squatting
    pipe = win32pipe.CreateNamedPipe(endpoint, 0x40000000 | 0x00080000 | 3,
                                     0x8, 1, MAX_FRAME, MAX_FRAME, 3000, security)
    try:
        while not stop.is_set():
            try:
                pending = pywintypes.OVERLAPPED()
                pending.hEvent = win32event.CreateEvent(None, True, False, None)
                try:
                    win32pipe.ConnectNamedPipe(pipe, pending)
                except pywintypes.error as exc:
                    if exc.winerror != 535:  # ERROR_PIPE_CONNECTED
                        raise
                else:
                    while win32event.WaitForSingleObject(pending.hEvent, 500) == 258:
                        if stop.is_set():
                            win32file.CancelIoEx(pipe, pending)
                            return
                    win32file.GetOverlappedResult(pipe, pending, False)
                # C-05: Validar PID del proceso cliente antes de leer/despachar
                _verify_windows_client_process(pipe)
                raw = bytearray()
                while len(raw) <= MAX_FRAME:
                    read = pywintypes.OVERLAPPED()
                    read.hEvent = win32event.CreateEvent(None, True, False, None)
                    _, buffer = win32file.ReadFile(pipe, min(65536, MAX_FRAME + 1 - len(raw)), read)
                    if win32event.WaitForSingleObject(read.hEvent, 5000) != 0:
                        win32file.CancelIoEx(pipe, read)
                        raise TimeoutError('Tiempo RPC agotado')
                    size = win32file.GetOverlappedResult(pipe, read, False)
                    if not size:
                        break
                    raw.extend(buffer[:size])
                    if b'\n' in raw:
                        if raw.count(b'\n') != 1 or not raw.endswith(b'\n'):
                            raise ValueError('Solo se permite un mensaje')
                        if len(raw) > MAX_FRAME:
                            raise ValueError('Mensaje demasiado grande')
                        reply = handle(bytes(raw))
                        write = pywintypes.OVERLAPPED()
                        write.hEvent = win32event.CreateEvent(None, True, False, None)
                        win32file.WriteFile(pipe, reply, write)
                        if win32event.WaitForSingleObject(write.hEvent, 5000) != 0:
                            win32file.CancelIoEx(pipe, write)
                            raise TimeoutError('Tiempo RPC agotado')
                        win32file.GetOverlappedResult(pipe, write, False)
                        break
            except (OSError, ValueError, TimeoutError, PermissionError):
                pass
            finally:
                try:
                    win32pipe.DisconnectNamedPipe(pipe)
                except OSError:
                    pass
    finally:
        win32file.CloseHandle(pipe)


def _unix_server(endpoint, handle, stop):
    path = Path(endpoint)
    # The parent must be installer-created or a fresh private desktop directory.
    parent = path.parent.stat()
    if parent.st_mode & 0o022 or parent.st_uid not in (0, os.getuid()):
        raise PermissionError('Directorio de socket inseguro')
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not stat.S_ISSOCK(path.lstat().st_mode):
            raise FileExistsError('No se reemplaza un endpoint ajeno')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            try:
                probe.connect(str(path))
            except OSError as exc:
                if exc.errno != errno.ECONNREFUSED:
                    raise
                path.unlink()  # Private/trusted parent; recover only a dead socket.
            else:
                raise FileExistsError('El sensor ya está activo')
    old_mask = os.umask(0o177)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        server.bind(str(path))
        os.chmod(path, 0o600)
        if os.environ.get('OMEGA_SENSOR_UID'):
            os.chown(path, int(os.environ['OMEGA_SENSOR_UID']), -1)
        server.listen(4)
        server.settimeout(0.5)
        while not stop.is_set():
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            with conn:
                conn.settimeout(5)
                raw = bytearray()
                try:
                    # C-05: Validar UID/PID del proceso cliente mediante SO_PEERCRED
                    _verify_unix_peer_cred(conn)
                    while len(raw) <= MAX_FRAME:
                        chunk = conn.recv(min(65536, MAX_FRAME + 1 - len(raw)))
                        if not chunk:
                            break
                        raw.extend(chunk)
                        if b'\n' in raw:
                            if len(raw) <= MAX_FRAME and raw.count(b'\n') == 1 and raw.endswith(b'\n'):
                                conn.sendall(handle(bytes(raw)))
                            break
                except (OSError, ValueError, PermissionError):
                    pass
    finally:
        os.umask(old_mask)
        server.close()
        if path.exists() and stat.S_ISSOCK(path.lstat().st_mode):
            path.unlink()


def serve(app, endpoint, *, service=False, stop_event=None):
    stop = stop_event or threading.Event()
    bootstrap_gate = BootstrapGate()
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
    async def run():
        loop = asyncio.get_running_loop()
        def handle(raw):
            return asyncio.run_coroutine_threadsafe(
                dispatch(app, raw, service, bootstrap_gate=bootstrap_gate, peer_verified=True),
                loop,
            ).result(timeout=120)
        async with app.router.lifespan_context(app):
            await asyncio.to_thread(_windows_server if os.name == 'nt' else _unix_server, endpoint, handle, stop)
    asyncio.run(run())
