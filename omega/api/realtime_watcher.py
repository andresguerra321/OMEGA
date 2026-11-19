"""Differential polling sensor. No firewall changes and no guarantee of complete capture."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time

import psutil

from cti_db import load_host_iocs
from host_forensics import inspect_process_identity, sha256_file, verify_binary_signature
from host_runtime import host_scope, powershell, run_command
from infostealer_shield import scan_infostealer_activity


def normalize_domain(value: str) -> str:
    try:
        domain = value.strip().rstrip('.').lower().encode('idna').decode('ascii')
        return domain if len(domain) <= 253 and re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}', domain) else ''
    except (ValueError, UnicodeError):
        return ''


def build_ioc_index(rows: list[dict]) -> dict:
    index = {'ip': {}, 'domain': {}, 'sha256': {}}
    for row in rows:
        kind, value = str(row.get('ioc_type', '')).lower(), str(row.get('ioc_value', '')).strip().lower()
        if kind in ('ip', 'ipv4', 'ipv6', 'ipv4-addr', 'ipv6-addr'):
            try:
                index['ip'][str(ipaddress.ip_address(value))] = row
            except ValueError:
                continue
        elif kind in ('domain', 'domain-name'):
            value = normalize_domain(value)
            if value:
                index['domain'][value] = row
        elif kind in ('sha256', 'sha-256', 'file_hash') and re.fullmatch('[0-9a-f]{64}', value):
            index['sha256'][value] = row
    return index


def process_metadata(pid: int) -> dict:
    result = {'pid': pid, 'name': '', 'exe_path': '', 'signature': {'status': 'Unknown', 'publisher': ''}, 'sha256': '', 'privileged': False}
    try:
        process = psutil.Process(pid)
        with process.oneshot():
            result.update(name=process.name(), exe_path=process.exe(), startedAt=process.create_time())
            username = process.username().lower()
            result['privileged'] = username in ('root', 'nt authority\\system')
        if sys.platform.startswith('linux'):
            try:
                result['exe_path'] = os.readlink(f'/proc/{pid}/exe')
            except OSError:
                pass
        result['signature'] = verify_binary_signature(result['exe_path'])
        if result['privileged']:
            try:
                environment = process.environ()
                result['environment'] = {key: environment[key] for key in ('LD_PRELOAD', 'DYLD_INSERT_LIBRARIES') if key in environment}
                result['modules'] = list({mapping.path for mapping in process.memory_maps() if mapping.path})[:500]
            except (psutil.Error, OSError):
                result['moduleInspection'] = 'unavailable'
    except (psutil.Error, OSError):
        result['coverage'] = 'process-not-accessible'
    return result


def collect_connections() -> list[dict]:
    result = []
    for connection in psutil.net_connections(kind='inet'):
        if not connection.raddr or connection.status not in (psutil.CONN_ESTABLISHED, psutil.CONN_SYN_SENT, psutil.CONN_NONE):
            continue
        result.append({'pid': connection.pid or 0, 'remoteIp': connection.raddr.ip,
                       'remotePort': connection.raddr.port, 'localIp': connection.laddr.ip,
                       'localPort': connection.laddr.port, 'state': connection.status})
    return result


def collect_dns() -> tuple[set[str], str]:
    if sys.platform == 'win32':
        result = powershell("$ErrorActionPreference='Stop'; @(Get-DnsClientCache | Select-Object Entry,Data)|ConvertTo-Json -Compress")
        if result.returncode:
            raise OSError('Caché DNS Windows no accesible')
        rows = json.loads(result.stdout.lstrip('\ufeff') or '[]')
        if isinstance(rows, dict):
            rows = [rows]
        return {domain for row in rows for value in (row.get('Entry', ''), row.get('Data', '')) if (domain := normalize_domain(str(value)))}, 'cache-no-pid'
    args = (['log', 'show', '--last', '1m', '--style', 'compact', '--predicate', 'process == "mDNSResponder"']
            if sys.platform == 'darwin' else ['journalctl', '-u', 'systemd-resolved', '--since', '1 minute ago', '--no-pager', '-o', 'cat'])
    result = run_command(args, timeout=5)
    if result.returncode or not result.stdout.strip() or '<private>' in result.stdout:
        return set(), 'unavailable'
    domains = {normalize_domain(match) for match in re.findall(r'(?:query|question)\s+(?:for\s+)?([a-zA-Z0-9_.-]+)', result.stdout, re.I)}
    return domains - {''}, 'partial-system-log-no-pid'


class RealtimeWatcher:
    def __init__(self, *, interval: float = 5, capacity: int = 200, dedup_seconds: float = 300):
        self.interval = max(2, min(float(interval), 300))
        self.dedup_seconds = dedup_seconds
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._enabled = False
        self._alerts = deque(maxlen=capacity)
        self._dedup = {}
        self._connections = set()
        self._dns = set()
        self._index = build_ioc_index([])
        self._index_version = ''
        self._index_loaded = False
        self._catalog_error = ''
        self._last_reload = 0.0
        self._last_check = None
        self._error = ''
        self._dns_mode = 'not-checked'
        self._hashes = {}
        self._index_synced_at = 0.0
        self._successful_check_at = 0.0

    def replace_iocs(self, rows: list[dict]):
        index = build_ioc_index(rows)
        version = hashlib.sha256(json.dumps(index, sort_keys=True).encode()).hexdigest()
        with self._lock:
            # Re-evaluate currently open connections/cache entries when the feed changes.
            if version != self._index_version:
                self._connections.clear()
                self._dns.clear()
            self._index, self._index_version = index, version
            self._index_loaded, self._catalog_error = True, ''
            self._index_synced_at = time.monotonic()

    def lookup_iocs(self, candidates: list[str]) -> list[dict]:
        with self._lock:
            index = self._index
        return [index['sha256'][value] for value in candidates if value in index['sha256']]

    def reload_iocs(self):
        try:
            self.replace_iocs(load_host_iocs())
        except Exception as exc:
            with self._lock:
                self._catalog_error = f'Catálogo no actualizado: {type(exc).__name__}'
        self._last_reload = time.monotonic()

    def start(self, enabled: bool = False):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._enabled = enabled and host_scope() == 'native-host'
            self._thread = threading.Thread(target=self._run, name='omega-host-watch', daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread:
            thread.join(timeout=25)
        with self._lock:
            self._enabled = False

    def toggle(self, enabled: bool):
        if enabled and host_scope() != 'native-host':
            raise ValueError('El worker está en un contenedor. Se requiere un worker nativo para vigilar el equipo.')
        with self._lock:
            self._enabled = enabled
            self._connections.clear()
            self._dns.clear()
            # Do not show an old successful scan as a freshly resumed sensor.
            self._last_check = None
            self._successful_check_at = 0.0
        self._wake.set()
        return self.status()

    def _run(self):
        while not self._stop.is_set():
            if os.getenv('OMEGA_HOST_IOC_SOURCE', 'database') == 'database' and time.monotonic() - self._last_reload > 60:
                self.reload_iocs()
            if self._enabled:
                try:
                    self.tick()
                except Exception as exc:
                    with self._lock:
                        self._error = f'Sensor sin lectura: {type(exc).__name__}'
            self._wake.wait(self.interval)
            self._wake.clear()

    def _alert(self, category, severity, title, explanation, evidence):
        key = hashlib.sha256(f"{category}|{evidence.get('pid')}|{evidence.get('indicator')}|{evidence.get('exe_path')}".encode()).hexdigest()
        now = time.monotonic()
        with self._lock:
            if not self._enabled or self._stop.is_set():
                return
            if evidence.get('catalogVersion', self._index_version) != self._index_version:
                return
            if now - self._dedup.get(key, -self.dedup_seconds) < self.dedup_seconds:
                return
            self._dedup = {k: v for k, v in self._dedup.items() if now - v < self.dedup_seconds}
            if len(self._dedup) >= 5000:
                self._dedup.pop(next(iter(self._dedup)))
            self._dedup[key] = now
            self._alerts.append({'id': key + '-' + str(time.time_ns()), 'category': category, 'severity': severity,
                                 'detectedAt': datetime.now(timezone.utc).isoformat(), 'userFriendlyTitle': title,
                                 'userFriendlyExplanation': explanation, 'evidence': evidence,
                                 'recommendedAction': 'Evita interactuar con el destino y solicita revisión del hallazgo. Consulta el historial para saber si se aplicó una medida de contención.',
                                 'blocked': False})

    def tick(self):
        if self._stop.is_set() or not self._enabled:
            return
        connections = collect_connections()  # AccessDenied must degrade status, not report zero threats.
        try:
            dns, dns_mode = collect_dns()
        except (OSError, ValueError, subprocess.SubprocessError):
            dns, dns_mode = set(), 'unavailable'
        with self._lock:
            index = self._index
            index_version = self._index_version
            prior_connections, prior_dns = self._connections.copy(), self._dns.copy()
        current, processes = set(), {}
        for connection in connections:
            if self._stop.is_set() or not self._enabled:
                return
            pid = connection['pid']
            # PID reuse is distinguished by process create_time.
            try:
                started = psutil.Process(pid).create_time() if pid else 0
            except psutil.Error:
                started = 0
            key = (pid, started, connection['remoteIp'], connection['remotePort'], connection['localPort'])
            current.add(key)
            if key in prior_connections:
                continue
            if pid not in processes:
                processes[pid] = process_metadata(pid)
            proc = processes[pid]
            evidence = {**connection, **proc, 'indicator': connection['remoteIp'], 'catalogVersion': index_version}
            try:
                matched = index['ip'].get(str(ipaddress.ip_address(connection['remoteIp'])))
            except ValueError:
                matched = None
            if matched:
                self._alert('NETWORK_IOC', 'CRITICAL', 'Conexión observada hacia un indicador de amenaza conocido',
                            'El destino coincide con el catálogo CTI cargado. La coincidencia necesita contexto y no confirma por sí sola una infección.', {**evidence, 'cti': matched})
            elif proc['signature']['status'] in ('Unsigned', 'Unmanaged') and connection['remotePort'] not in (53, 80, 443):
                self._alert('UNSIGNED_NETWORK_HEURISTIC', 'MEDIUM', 'Programa de origen no verificado con una conexión que conviene revisar',
                            'El programa usa un puerto poco habitual y no tiene firma o paquete verificado. Es una señal heurística, no una coincidencia C2.', evidence)
            if proc['exe_path'] and index['sha256']:
                try:
                    stat = os.stat(proc['exe_path'])
                    hash_key = (proc['exe_path'], stat.st_mtime_ns, stat.st_size)
                    if hash_key not in self._hashes:
                        if len(self._hashes) >= 512:
                            self._hashes.clear()
                        self._hashes[hash_key] = sha256_file(proc['exe_path'])
                    sha = self._hashes[hash_key]
                    if sha in index['sha256']:
                        self._alert('PROCESS_HASH_IOC', 'CRITICAL', 'Un programa conectado coincide con un archivo identificado en el catálogo',
                                    'Se comprobó el SHA-256 del ejecutable en disco; esto no es una medición de su memoria.', {**evidence, 'indicator': sha, 'sha256': sha, 'cti': index['sha256'][sha]})
                except (OSError, ValueError):
                    pass
            for finding in inspect_process_identity(proc, sys.platform):
                self._alert(finding['category'], finding['severity'], finding['userFriendlyTitle'], finding['detail'], evidence)
        for domain in dns - prior_dns:
            if domain in index['domain']:
                self._alert('DNS_IOC', 'HIGH', 'Se encontró un dominio del catálogo de amenazas en los registros DNS',
                            'La entrada puede proceder de una consulta anterior. La caché o el log no permiten atribuirla de forma fiable a un proceso.',
                            {'indicator': domain, 'pid': None, 'dnsSource': dns_mode, 'cti': index['domain'][domain], 'catalogVersion': index_version})
        try:
            for finding in scan_infostealer_activity():
                self._alert(
                    finding['category'],
                    finding['severity'],
                    finding['userFriendlyTitle'],
                    finding['detail'],
                    {
                        'indicator': finding['sensitivePath'],
                        'pid': finding['pid'],
                        'name': finding['processName'],
                        'exe_path': finding['exePath'],
                        'signatureStatus': finding['signatureStatus'],
                        'targetKind': finding['targetKind'],
                        'catalogVersion': index_version,
                    },
                )
        except Exception:
            pass
        with self._lock:
            if index_version != self._index_version or self._stop.is_set() or not self._enabled:
                return  # A newer feed must re-evaluate all observations on the next pass.
            self._connections, self._dns = current, dns
            self._last_check = datetime.now(timezone.utc).isoformat()
            self._successful_check_at = time.monotonic()
            self._dns_mode, self._error = dns_mode, ''

    def status(self):
        with self._lock:
            running = bool(self._thread and self._thread.is_alive())
            fresh = self._successful_check_at > 0 and time.monotonic() - self._successful_check_at <= max(30, self.interval * 3)
            catalog_fresh = self._index_loaded and time.monotonic() - self._index_synced_at < 180
            active = self._enabled and running and fresh and not self._error and catalog_fresh and not self._catalog_error and any(self._index.values())
            return {'enabled': self._enabled, 'running': running, 'active': active,
                    'state': 'active' if active else 'degraded' if self._enabled else 'paused',
                    'scope': host_scope(), 'hostname': socket.gethostname(), 'platform': sys.platform,
                    'intervalSeconds': self.interval, 'lastCheck': self._last_check,
                    'indicatorCount': sum(len(values) for values in self._index.values()),
                    'catalogLoaded': self._index_loaded, 'catalogVersion': self._index_version,
                    'catalogError': self._catalog_error or ('Catálogo pendiente o sin actualización reciente.' if not catalog_fresh else ''), 'sensorError': self._error, 'dnsCoverage': self._dns_mode,
                    'alerts': list(self._alerts), 'alertCount': len(self._alerts),
                    'capabilities': {'blocking': False, 'eventBasedCapture': False},
                    'notice': 'Vigilancia por muestreo: puede perder conexiones breves. DNS cifrado o no registrado puede no ser visible. Alertas en memoria, se pierden al reiniciar. El catálogo actual no contiene estado de revocación/caducidad.'}


watcher = RealtimeWatcher(interval=float(os.getenv('OMEGA_REALTIME_INTERVAL_SECONDS', '5')))
