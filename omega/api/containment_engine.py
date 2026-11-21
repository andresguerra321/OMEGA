"""Opt-in, host-native incident response orchestrator with sealed recovery journals.

Delegates OS-specific firewall operations to `firewall_adapters.py`, encrypted vault
persistence to `quarantine_vault.py`, and process suspension to `process_controller.py`.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import socket
import stat
import sys
import time
import uuid

import psutil

from firewall_adapters import NativeFirewall, protected_addresses, public_ip as _public_ip
from host_forensics import sha256_file, verify_binary_signature
from host_runtime import host_scope, run_command
from persistence_auditor import collect_linux, collect_macos, collect_windows, entry_target
from process_controller import CRITICAL_NAMES, resume_verified_process, validate_and_measure_process
from quarantine_vault import (
    MAX_FILE_BYTES,
    QuarantineVault,
    capture_file_metadata,
    locked_evidence as _locked_evidence,
    restore_file_metadata,
    secure_os_key,
    sync_directory as _sync_directory,
)

_PREVIEW_KEY = secrets.token_bytes(32)


def emergency_guidance(vector: str = '') -> list[str]:
    guidance = [
        'Si sospechas vigilancia dirigida, evita abrir enlaces o responder mensajes relacionados.',
        'Desde un equipo confiable, revisa sesiones abiertas y cambia las credenciales que puedan estar expuestas.',
        'Conserva el informe y contacta a un equipo de respuesta a incidentes. No borres ni restablezcas el dispositivo si necesitas preservar evidencia.',
    ]
    if any(word in vector.lower() for word in ('ios', 'iphone', 'pegasus', 'spyware')):
        guidance.insert(0, 'En iPhone: Ajustes → Privacidad y seguridad → Modo de aislamiento. Valora con soporte el reinicio requerido si se necesita preservar memoria volátil.')
    else:
        guidance.insert(0, 'Si el riesgo es inmediato, desconecta la red sin apagar el equipo; apagarlo elimina evidencia que solo existe en memoria.')
    return guidance


class ContainmentEngine:
    def __init__(self, root=None, *, key_provider=secure_os_key, firewall=None):
        self.root = Path(root) if root else Path(os.environ.get('OMEGA_CONTAINMENT_DIR') or Path.home() / '.omega/quarantine')
        self.key_provider = key_provider
        self.vault = QuarantineVault(self.root, key_provider=key_provider)
        self.firewall = firewall or NativeFirewall()

    _prepare_root = QuarantineVault.prepare_root
    _file_metadata = staticmethod(capture_file_metadata)
    _restore_file_metadata = staticmethod(restore_file_metadata)

    def _key(self, owner: str):
        return self.vault.derive_key(owner)

    def _exclusive(self):
        return self.vault.exclusive(prepare_fn=self._prepare_root)

    def _write_record(self, record: dict, owner: str):
        return self.vault.write_record(record, owner)

    def _read_record(self, action_id: str, owner: str):
        return self.vault.read_record(action_id, owner)

    def _decrypt_file(self, record, owner):
        return self.vault.decrypt_file(record, owner)

    def _process_target(self, target: dict, *, with_process=False):
        return validate_and_measure_process(target, with_process=with_process, psutil_mod=psutil)

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
            self.vault.seal_bytes(action_id, target['sha256'], content, owner)
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

    def _restore_file_metadata_fd(self, source: Path, metadata: dict, fd: int):
        if self._restore_file_metadata is restore_file_metadata:
            restore_file_metadata(source, metadata, fd=fd)
        else:
            self._restore_file_metadata(source, metadata)

    def _restore_steps(self, record: dict, owner: str):
        target, steps = record['target'], record['steps']
        if record['actionType'] == 'BLOCK_NETWORK_INDICATOR' and steps.get('firewallAttempted'):
            self.firewall.rollback(target['firewall'])
        elif record['actionType'] == 'SUSPEND_OR_TERMINATE_PROCESS' and steps.get('suspendAttempted'):
            resume_verified_process(target, psutil_mod=psutil)
        elif record['actionType'] == 'QUARANTINE_PERSISTENCE_ITEM':
            source = Path(target['originalPath'])
            if source.is_symlink() or any(parent.is_symlink() for parent in source.parents):
                raise ValueError('La ruta original cambió a un enlace simbólico.')
            metadata = target.get('fileMetadata', {})
            mode = target['mode']
            mtime_ns = target['mtimeNs']
            if source.exists():
                if sha256_file(str(source)) != target['sha256']:
                    raise ValueError('Existe un archivo diferente en la ruta original; no se sobrescribirá.')
                if steps.get('sealed'):
                    if sys.platform != 'win32' and hasattr(os, 'O_NOFOLLOW'):
                        fd = os.open(str(source), os.O_RDONLY | os.O_NOFOLLOW)
                        try:
                            self._restore_file_metadata_fd(source, metadata, fd)
                            os.fchmod(fd, mode)
                            os.utime(fd, ns=(mtime_ns, mtime_ns))
                        finally:
                            os.close(fd)
                    else:
                        self._restore_file_metadata(source, metadata)
                        source.chmod(mode)
                        os.utime(source, ns=(mtime_ns, mtime_ns))
            elif steps.get('sealed'):
                raw = self._decrypt_file(record, owner)
                if sys.platform != 'win32' and hasattr(os, 'O_DIRECTORY') and hasattr(os, 'O_NOFOLLOW'):
                    # C-02: Abrir directorio destino con O_DIRECTORY|O_NOFOLLOW y aplicar metadatos sobre el fd abierto
                    parent_fd = os.open(str(source.parent), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        file_fd = os.open(source.name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
                        try:
                            with os.fdopen(file_fd, 'wb', closefd=False) as stream:
                                stream.write(raw)
                                stream.flush()
                                os.fsync(file_fd)
                            self._restore_file_metadata_fd(source, metadata, file_fd)
                            os.fchmod(file_fd, mode)
                            os.utime(file_fd, ns=(mtime_ns, mtime_ns))
                        finally:
                            os.close(file_fd)
                    finally:
                        os.close(parent_fd)
                else:
                    # Fallback Windows con validación explícita de reparse points/symlinks antes y después
                    if source.is_symlink() or any(parent.is_symlink() for parent in source.parents):
                        raise ValueError('La ruta original cambió a un enlace simbólico.')
                    with source.open('xb') as stream:
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if source.is_symlink():
                        raise ValueError('La ruta restaurada fue reemplazada por un enlace simbólico.')
                    self._restore_file_metadata(source, metadata)
                    source.chmod(mode)
                    os.utime(source, ns=(mtime_ns, mtime_ns))
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
