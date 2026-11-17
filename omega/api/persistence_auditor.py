"""Bounded, read-only persistence inventory for the machine executing this worker."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import socket
import subprocess
import sys
import threading

from cti_db import lookup_iocs_detailed
from host_forensics import sha256_file, verify_binary_signature, prime_windows_signature_cache, inspect_process_identity
from host_runtime import host_scope, powershell, run_command

MAX_ENTRIES = 1500
HIGH_PERMISSIONS = {'<all_urls>', 'webRequest', 'nativeMessaging', 'cookies', 'debugger'}
_AUDIT_LOCK = threading.Lock()


def _read_json(path: Path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Archivo de metadatos superior a 16 MiB')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def command_target(command: str, platform_name: str) -> str:
    """Parse only; never invoke a command found in persistence metadata."""
    command = command.strip()
    if not command:
        return ''
    if platform_name == 'win32':
        match = re.match(r'^"([^"]+)"|^(.+?\.(?:exe|com|bat|cmd|ps1|vbs|js))(?=\s|$)', command, re.I)
        return os.path.expandvars((match[1] or match[2]) if match else command.split()[0])
    try:
        return shlex.split(command)[0]
    except (ValueError, IndexError):
        return ''


def entry_target(entry: dict, platform_name: str) -> str:
    target = entry.get('targetPath') or command_target(entry.get('command', ''), platform_name)
    launcher = str(target).replace('\\', '/').rsplit('/', 1)[-1].lower()
    if launcher in ('powershell.exe', 'pwsh.exe', 'powershell', 'pwsh', 'wscript.exe', 'cscript.exe', 'cmd.exe',
                    'bash', 'sh', 'python', 'python3', 'node', 'osascript'):
        try:
            tokens = shlex.split(entry.get('command', ''), posix=platform_name != 'win32')
            for token in tokens[1:]:
                candidate = os.path.expandvars(token.strip('"'))
                if Path(candidate).is_absolute() and Path(candidate).suffix.lower() in ('.ps1', '.bat', '.cmd', '.vbs', '.js', '.py', '.sh', '.scpt'):
                    return candidate
        except ValueError:
            pass
    return target


def collect_windows() -> tuple[list[dict], list[str]]:
    # The script is static; registry and task values are returned as data only.
    script = r"""
$ErrorActionPreference='Stop'; $out=@(); $errors=@()
foreach($hive in @('HKCU','HKLM')) { foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
 foreach($key in @('Run','RunOnce')) { try {
  $h=if($hive -eq 'HKCU'){[Microsoft.Win32.RegistryHive]::CurrentUser}else{[Microsoft.Win32.RegistryHive]::LocalMachine}
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($h,$view)
  $r=$base.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\$key")
  if($r){foreach($name in $r.GetValueNames()){ $out+=@{persistenceType=$key;location="$hive/$view/$key/$name";command=[string]$r.GetValue($name)} };$r.Dispose()};$base.Dispose()
 }catch{$errors+="Registry/$hive/$view/$key : $($_.Exception.Message)"} }
} }
try {
 foreach($t in Get-ScheduledTask) {
  foreach($a in $t.Actions) {
   if($a.Execute) {
    $out+=@{persistenceType='ScheduledTask';location="$($t.TaskPath)$($t.TaskName)";targetPath=[string]$a.Execute;command="$($a.Execute) $($a.Arguments)"}
   }
  }
 }
} catch {$errors+="ScheduledTask: $($_.Exception.Message)"}
try { foreach($s in Get-CimInstance Win32_Service -Filter "State='Running'"){$out+=@{persistenceType='Service';location=[string]$s.Name;command=[string]$s.PathName}} }catch{$errors+="Services: $($_.Exception.Message)"}
try { foreach($f in Get-CimInstance -Namespace root\subscription -ClassName __EventFilter){$out+=@{persistenceType='WMI';location=[string]$f.Name;command='';evidence=[string]$f.Query}}
 foreach($c in Get-CimInstance -Namespace root\subscription -ClassName CommandLineEventConsumer){$out+=@{persistenceType='WMI';location=[string]$c.Name;command=[string]$c.CommandLineTemplate;targetPath=[string]$c.ExecutablePath}}
}catch{$errors+="WMI: $($_.Exception.Message)"}
@{entries=@($out);limitations=@($errors)}|ConvertTo-Json -Depth 5 -Compress
"""
    output = powershell(script)
    if output.returncode:
        raise OSError('No se pudo enumerar la persistencia Windows')
    data = json.loads(output.stdout.lstrip('\ufeff'))
    return data['entries'], data['limitations']


def collect_macos(home: Path) -> tuple[list[dict], list[str]]:
    entries, limitations = [], []
    for folder in (home / 'Library/LaunchAgents', Path('/Library/LaunchAgents'), Path('/Library/LaunchDaemons'),
                   Path('/System/Library/LaunchAgents'), Path('/System/Library/LaunchDaemons')):
        if not folder.exists():
            continue
        for path in sorted(folder.glob('*.plist'))[:300]:
            try:
                if path.stat().st_size > 1024 * 1024:
                    raise ValueError('Plist demasiado grande')
                data = plistlib.loads(path.read_bytes())
                argv = data.get('ProgramArguments') or []
                entries.append({'persistenceType': folder.name, 'location': str(path),
                                'targetPath': data.get('Program') or (argv[0] if argv else ''),
                                'evidence': {'label': data.get('Label'), 'runAtLoad': data.get('RunAtLoad')}})
            except (OSError, ValueError, plistlib.InvalidFileException) as exc:
                limitations.append(f'{path}: {type(exc).__name__}')
    for args, kind in ((['profiles', 'list', '-output', 'stdout-xml'], 'MDMProfile'),
                       (['sfltool', 'dumpbtm'], 'LoginItems')):
        try:
            result = run_command(args)
            if result.returncode:
                limitations.append(f'{kind}: permisos o herramienta no disponibles')
            elif result.stdout.strip():
                # Inventory output is evidence; no inference of malware from enrollment/login items alone.
                entries.append({'persistenceType': kind, 'location': kind, 'evidence': result.stdout[:32000]})
        except (OSError, subprocess.SubprocessError):
            limitations.append(f'{kind}: no disponible')
    return entries, limitations


def parse_cron(text: str, location: str, system: bool = False) -> list[dict]:
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or re.match(r'^\w+\s*=', line):
            continue
        fields = line.split(None, (2 if system else 1) if line.startswith('@') else (6 if system else 5))
        expected = (3 if system else 2) if line.startswith('@') else (7 if system else 6)
        if len(fields) == expected:
            entries.append({'persistenceType': 'Cron', 'location': location, 'command': fields[-1]})
    return entries


def collect_linux(home: Path) -> tuple[list[dict], list[str]]:
    entries, limitations = [], []
    for user_mode in (False, True):
        prefix = ['systemctl'] + (['--user'] if user_mode else [])
        try:
            units = run_command(prefix + ['list-units', '--type=service', '--type=timer', '--state=active', '--no-legend', '--plain', '--no-pager'])
            if units.returncode:
                limitations.append(f'systemd {"usuario" if user_mode else "sistema"}: no disponible')
                continue
            names = [line.split()[0] for line in units.stdout.splitlines() if line.split()]
            if len(names) > 200:
                limitations.append('systemd: inventario limitado a 200 unidades por ámbito')
            # One process per scope, rather than one process for every unit.
            if not names:
                continue
            details = run_command(prefix + ['show', '--no-pager', '--property=Id,ExecStart,FragmentPath,Triggers', '--', *names[:200]])
            for block in details.stdout.split('\n\n'):
                props = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
                target = re.search(r'path=([^ ;}]+)', props.get('ExecStart', ''))
                if props.get('Id'):
                    entries.append({'persistenceType': 'Systemd', 'location': props.get('FragmentPath') or props['Id'],
                                    'targetPath': target[1] if target else '', 'evidence': {**props, 'userMode': user_mode}})
        except (OSError, subprocess.SubprocessError):
            limitations.append('systemd: no disponible')
    for path in [Path('/etc/crontab'), *sorted(Path('/etc/cron.d').glob('*'))[:100]]:
        if path.is_file():
            try:
                entries.extend(parse_cron(path.read_text()[:128000], str(path), system=True))
            except OSError:
                limitations.append(f'{path}: sin permiso')
    for directory in ('/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly'):
        for path in sorted(Path(directory).glob('*'))[:100]:
            if path.is_file():
                entries.append({'persistenceType': 'CronScript', 'location': str(path), 'targetPath': str(path)})
    preload = Path('/etc/ld.so.preload')
    if preload.exists():
        try:
            for line in preload.read_text()[:64000].splitlines():
                for library in line.split('#', 1)[0].split():
                    entries.append({'persistenceType': 'LibraryPreload', 'location': str(preload), 'targetPath': library})
        except OSError:
            limitations.append('/etc/ld.so.preload: sin permiso')
    keys = home / '.ssh/authorized_keys'
    if keys.exists():
        try:
            stat = keys.stat()
            # Key contents are not returned; recent changes alone do not prove compromise.
            entries.append({'persistenceType': 'SSHAuthorizedKeys', 'location': str(keys), 'targetPath': str(keys),
                            'suspicious': bool(stat.st_mode & 0o022) or stat.st_uid != os.getuid(),
                            'evidence': {'mode': oct(stat.st_mode & 0o777), 'mtime': stat.st_mtime, 'owner': stat.st_uid}})
        except OSError:
            limitations.append('authorized_keys: sin permiso')
    return entries, limitations


def browser_roots(home: Path, platform_name: str) -> list[Path]:
    if platform_name == 'win32':
        local = Path(os.environ.get('LOCALAPPDATA', str(home / 'AppData/Local')))
        roaming = Path(os.environ.get('APPDATA', str(home / 'AppData/Roaming')))
        return [local / p for p in ('Google/Chrome/User Data', 'Microsoft/Edge/User Data', 'BraveSoftware/Brave-Browser/User Data')] + [roaming / 'Mozilla/Firefox/Profiles']
    if platform_name == 'darwin':
        base = home / 'Library/Application Support'
        return [base / p for p in ('Google/Chrome', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Firefox/Profiles')]
    return [home / p for p in ('.config/google-chrome', '.config/microsoft-edge', '.config/BraveSoftware/Brave-Browser', '.mozilla/firefox')]


def collect_browser_extensions(home: Path, platform_name: str) -> tuple[list[dict], list[str]]:
    entries, limitations = [], []
    for root in browser_roots(home, platform_name):
        if not root.exists():
            continue
        try:
            profiles = [p for p in root.iterdir() if p.is_dir()][:100]
        except OSError:
            limitations.append(f'{root}: sin permiso')
            continue
        for profile in profiles:
            try:
                if (profile / 'extensions.json').exists():
                    for addon in _read_json(profile / 'extensions.json').get('addons', [])[:300]:
                        if addon.get('type') != 'extension' or not addon.get('active', True):
                            continue
                        perms = addon.get('userPermissions') or {}
                        permissions = perms.get('permissions', []) + perms.get('origins', [])
                        entries.append({'persistenceType': 'BrowserExtension', 'location': str(profile / 'extensions.json'),
                                        'extensionId': addon.get('id'), 'targetPath': addon.get('path', ''),
                                        'sideloaded': (isinstance(addon.get('signedState'), int) and addon['signedState'] < 2) or bool(addon.get('foreignInstall')),
                                        'permissions': permissions, 'evidence': {'signedState': addon.get('signedState')}})
                settings = {}
                for name in ('Preferences', 'Secure Preferences'):
                    if (profile / name).exists():
                        settings.update(_read_json(profile / name).get('extensions', {}).get('settings', {}))
                for manifest_path in sorted((profile / 'Extensions').glob('*/*/manifest.json'))[:300]:
                    manifest = _read_json(manifest_path)
                    ext_id = manifest_path.parent.parent.name
                    meta = settings.get(ext_id, {})
                    entries.append({'persistenceType': 'BrowserExtension', 'location': str(manifest_path),
                                    'targetPath': str(manifest_path), 'extensionId': ext_id,
                                    'sideloaded': meta.get('location') in (4, 8) or meta.get('from_webstore') is False,
                                    'permissions': manifest.get('permissions', []) + manifest.get('host_permissions', []),
                                    'evidence': {'name': manifest.get('name'), 'version': manifest.get('version'), 'installLocation': meta.get('location')}})
                # Unpacked extensions may live outside Extensions/. Inspect metadata without executing code.
                for ext_id, meta in settings.items():
                    if meta.get('location') in (4, 8) and meta.get('path'):
                        manifest = meta.get('manifest') or {}
                        entries.append({'persistenceType': 'BrowserExtension', 'location': str(profile / 'Preferences'),
                                        'targetPath': str(Path(meta['path']) / 'manifest.json'), 'extensionId': ext_id,
                                        'sideloaded': True, 'permissions': manifest.get('permissions', []) + manifest.get('host_permissions', [])})
            except (OSError, ValueError, TypeError) as exc:
                limitations.append(f'{profile}: metadatos de extensiones incompletos ({type(exc).__name__})')
    return entries, limitations


def evaluate_entries(entries: list[dict], platform_name: str, ioc_lookup=lookup_iocs_detailed) -> tuple[list[dict], list[str]]:
    findings, limitations, measured = [], [], {}
    prime_windows_signature_cache([entry_target(e, platform_name) for e in entries[:MAX_ENTRIES]])
    hash_budget = 256 * 1024 * 1024
    for entry in entries[:MAX_ENTRIES]:
        target = entry_target(entry, platform_name)
        if target and not Path(target).is_absolute():
            limitations.append(f"{entry['location']}: destino relativo no resuelto; se conserva el comando como evidencia.")
            target = ''  # Relative targets depend on working directory/PATH; never guess.
        signature = {'status': 'Unknown', 'publisher': ''}
        sha = ''
        if target:
            if target not in measured:
                signature = verify_binary_signature(target, platform_name)
                try:
                    size = Path(target).stat().st_size
                    if size > hash_budget:
                        raise ValueError('Presupuesto de hash de 256 MiB agotado')
                    sha = sha256_file(target)
                    hash_budget -= size
                except (OSError, ValueError):
                    limitations.append(f'{target}: hash no disponible')
                measured[target] = (signature, sha)
            signature, sha = measured[target]
        kind = entry['persistenceType']
        severity, category = 'LOW', 'STARTUP'
        title = 'Programa configurado para iniciarse automáticamente'
        explanation = 'Se encontró una configuración de inicio; su presencia por sí sola no indica una infección.'
        if signature['status'] == 'Unsigned':
            severity, title = 'MEDIUM', 'Programa sin firma configurado para iniciar automáticamente al encender el equipo'
            explanation = 'No se pudo identificar un editor mediante firma digital. Puede ser legítimo; verifica si reconoces este programa.'
        if signature['status'] == 'Tampered':
            severity, title = 'HIGH', 'Un archivo de inicio no supera su comprobación de integridad'
            explanation = 'El archivo no coincide con su firma o con los metadatos del paquete instalado.'
        if kind == 'Service' and signature['status'] == 'Valid' and 'microsoft' in signature.get('publisher', '').lower():
            continue
        if kind == 'BrowserExtension':
            category = 'BROWSER'
            risky = sorted(HIGH_PERMISSIONS.intersection(entry.get('permissions', [])))
            severity = 'HIGH' if entry.get('sideloaded') and risky else 'MEDIUM' if entry.get('sideloaded') or risky else 'LOW'
            title = 'Extensión del navegador con acceso que conviene revisar' if severity != 'LOW' else 'Extensión del navegador inventariada'
            explanation = f"Instalación externa detectada: {bool(entry.get('sideloaded'))}. Permisos sensibles: {', '.join(risky) or 'ninguno de los evaluados'}. Estos permisos no demuestran abuso."
        if kind in ('LibraryPreload', 'WMI') or entry.get('suspicious'):
            severity = 'HIGH' if kind == 'LibraryPreload' or entry.get('suspicious') else 'MEDIUM'
            title = 'Configuración de ejecución automática que requiere revisión'
        location = entry['location']
        findings.append({'id': hashlib.sha256(f'{kind}|{location}|{target}'.encode()).hexdigest()[:24],
                         'category': category, 'persistenceType': kind, 'location': location,
                         'targetPath': target, 'sha256': sha, 'signatureStatus': signature['status'],
                         'publisher': signature.get('publisher', ''), 'severity': severity,
                         'userFriendlyTitle': title, 'userFriendlyExplanation': explanation,
                         'recommendedAction': 'Confirma si reconoces este elemento. Si no, consulta a soporte antes de deshabilitarlo.',
                         'evidence': {**entry, 'signature': signature}, 'ctiMatches': []})
    hashes = list({f['sha256'] for f in findings if f['sha256']})
    try:
        matches = ioc_lookup(hashes) if hashes else []
        by_hash = {}
        for match in matches:
            by_hash.setdefault(str(match['ioc_value']).lower(), []).append(match)
        for finding in findings:
            finding['ctiMatches'] = by_hash.get(finding['sha256'], [])
            if finding['ctiMatches']:
                finding.update(severity='CRITICAL', userFriendlyTitle='Un archivo de inicio coincide con un indicador de amenaza conocido',
                               userFriendlyExplanation='El SHA-256 coincide con el catálogo CTI. Revisa las fuentes adjuntas y conserva la evidencia.',
                               recommendedAction='Evita ejecutar el archivo y solicita revisión especializada. OMEGA no lo ha eliminado ni bloqueado.')
    except Exception:
        limitations.append('Catálogo CTI no disponible: no se pudo contrastar los hashes.')
    return findings, limitations


def audit_persistence(ioc_lookup=lookup_iocs_detailed) -> dict:
    if not _AUDIT_LOCK.acquire(blocking=False):
        raise RuntimeError('Ya hay una auditoría de persistencia en curso')
    try:
        entries, limitations = [], []
        home, platform_name = Path.home(), sys.platform
        collector = collect_windows if platform_name == 'win32' else lambda: collect_macos(home) if platform_name == 'darwin' else collect_linux(home)
        try:
            entries, limitations = collector()
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            limitations.append(f'Persistencia del sistema: {type(exc).__name__}')
        if platform_name != 'win32':
            try:
                cron = run_command(['crontab', '-l'])
                if cron.returncode == 0:
                    entries.extend(parse_cron(cron.stdout, 'crontab del usuario'))
                elif 'no crontab' not in cron.stderr.lower():
                    limitations.append('Crontab del usuario: no disponible')
            except (OSError, subprocess.SubprocessError):
                limitations.append('Crontab del usuario: no disponible')
        browser_entries, browser_limits = collect_browser_extensions(home, platform_name)
        entries.extend(browser_entries)
        limitations.extend(browser_limits)
        if len(entries) > MAX_ENTRIES:
            limitations.append(f'Inventario limitado a {MAX_ENTRIES} entradas')
        findings, measurement_limits = evaluate_entries(entries, platform_name, ioc_lookup)
        limitations.extend(measurement_limits)
        processes, process_findings = [], []
        import psutil
        from realtime_watcher import process_metadata
        candidates = []
        for proc in psutil.process_iter(['pid', 'name', 'exe'], ad_value=None):
            candidates.append(proc.info)
        candidates.sort(key=lambda p: (str(p.get('name', '')).lower() not in ('svchost.exe', 'lsass.exe', 'csrss.exe', 'services.exe', 'launchd', 'windowserver', 'springboard', 'sshd', 'systemd'), p['pid']))
        if len(candidates) > 250:
            limitations.append('Procesos: inspección limitada a 250, priorizando componentes críticos')
        prime_windows_signature_cache([p['exe'] for p in candidates[:250] if p.get('exe')])
        process_hash_budget = 128 * 1024 * 1024
        process_hashes = {}
        for candidate in candidates[:250]:
            proc = process_metadata(candidate['pid'])
            path = proc['exe_path']
            if path and path not in process_hashes:
                try:
                    size = Path(path).stat().st_size
                    if size > process_hash_budget:
                        raise ValueError('Presupuesto de hash de procesos agotado')
                    process_hashes[path] = sha256_file(path)
                    process_hash_budget -= size
                except (OSError, ValueError):
                    process_hashes[path] = ''
            proc['sha256'] = process_hashes.get(path, '')
            processes.append(proc)
            process_findings.extend(inspect_process_identity(proc, platform_name))
            if proc.get('coverage') or proc.get('moduleInspection') == 'unavailable':
                limitations.append(f"PID {candidate['pid']}: inspección parcial por permisos o proceso finalizado")
        if any(not proc['sha256'] for proc in processes):
            limitations.append('Algunos procesos no tienen hash: permisos, archivo ausente o presupuesto de lectura de 128 MiB alcanzado.')
        return {'scope': host_scope(), 'platform': platform_name, 'hostname': socket.gethostname(),
                'collectedAt': datetime.now(timezone.utc).isoformat(), 'findings': findings,
                'processes': processes, 'processFindings': process_findings,
                'limitations': limitations, 'complete': not limitations,
                'notice': 'Inventario de solo lectura del equipo que ejecuta el worker. Sin coincidencias no significa ausencia de amenazas. Solo se examinan los perfiles accesibles al usuario del servicio.'}
    finally:
        _AUDIT_LOCK.release()
