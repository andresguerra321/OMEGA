"""Bounded JSON-line RPC to ASGI over user-only UDS or a local Windows named pipe."""
import asyncio
import base64
import json
import os
from pathlib import Path
import re
import socket
import stat
import threading
import signal
import errno

import httpx
import local_auth

MAX_FRAME = 2 * 1024 * 1024


async def dispatch(app, raw, service):
    try:
        message = json.loads(raw)
        if service and message == {'bootstrap': True}:
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
    while not stop.is_set():
        pipe = win32pipe.CreateNamedPipe(endpoint, 0x40000000 | 0x00080000 | 3,
                                        0x8, 1, MAX_FRAME, MAX_FRAME, 3000, security)
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
        except (OSError, ValueError, TimeoutError):
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
                    while len(raw) <= MAX_FRAME:
                        chunk = conn.recv(min(65536, MAX_FRAME + 1 - len(raw)))
                        if not chunk:
                            break
                        raw.extend(chunk)
                        if b'\n' in raw:
                            if len(raw) <= MAX_FRAME and raw.count(b'\n') == 1 and raw.endswith(b'\n'):
                                conn.sendall(handle(bytes(raw)))
                            break
                except (OSError, ValueError):
                    pass
    finally:
        os.umask(old_mask)
        server.close()
        if path.exists() and stat.S_ISSOCK(path.lstat().st_mode):
            path.unlink()


def serve(app, endpoint, *, service=False, stop_event=None):
    stop = stop_event or threading.Event()
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
    async def run():
        loop = asyncio.get_running_loop()
        def handle(raw):
            return asyncio.run_coroutine_threadsafe(dispatch(app, raw, service), loop).result(timeout=120)
        async with app.router.lifespan_context(app):
            await asyncio.to_thread(_windows_server if os.name == 'nt' else _unix_server, endpoint, handle, stop)
    asyncio.run(run())
