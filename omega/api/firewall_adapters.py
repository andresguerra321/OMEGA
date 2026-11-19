"""OS-native firewall adapters (Windows netsh, macOS pfctl, Linux nft/iptables)."""
from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse
import uuid

import psutil

from host_runtime import powershell, run_command


def public_ip(value: str) -> str:
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
            stream.write(''.join(lines))
            stream.flush()
            os.fsync(stream.fileno())
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
                stream.write(rules + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            path.chmod(0o600)
            self._refresh_pf_file()
            self._checked(['pfctl', '-a', plan['anchor'], '-f', str(path)])
        elif backend == 'nft':
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
