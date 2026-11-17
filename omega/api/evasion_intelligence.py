"""Bounded passive infrastructure intelligence and explicitly opted-in HTTP comparison."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import http.client
import ipaddress
import io
import json
import math
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urljoin, quote

import tldextract

_SUFFIX = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=(), include_psl_private_domains=True)
_CACHE = {}
_LOCK = threading.Lock()
_DNS_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix='omega-probe-dns')
_DNS_SLOTS = threading.BoundedSemaphore(4)
MAX_BODY = 128 * 1024
REDIRECTOR_HOSTS = frozenset({'bit.ly', 't.co', 'tinyurl.com', 'cutt.ly', 'rb.gy', 'tiny.cc', 'l.facebook.com', 'l.instagram.com'})


class _DeadlineReader(io.RawIOBase):
    def __init__(self, raw, sock, deadline):
        super().__init__()
        self.raw, self.sock, self.deadline = raw, sock, deadline

    def readable(self):
        return True

    def readinto(self, buffer):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Presupuesto HTTP agotado')
        self.sock.settimeout(min(2.5, remaining))
        return self.raw.readinto(buffer)

    def close(self):
        self.raw.close()
        super().close()


class _DeadlineSocket:
    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline

    def __getattr__(self, name):
        return getattr(self.sock, name)

    def makefile(self, mode, buffering=None):
        # Keep socket file-reference accounting, so Connection: close does not
        # invalidate a response body still being read by HTTPResponse.
        return io.BufferedReader(_DeadlineReader(self.sock.makefile('rb', buffering=0), self.sock, self.deadline))


def registrable_domain(host: str) -> str:
    result = _SUFFIX(host)
    return result.top_domain_under_public_suffix or host


def resolve_public(host: str, port: int) -> str:
    if not _DNS_SLOTS.acquire(blocking=False):
        raise ValueError('Resolución DNS ocupada; vuelve a intentar más tarde.')
    future = _DNS_POOL.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _DNS_SLOTS.release())
    rows = future.result(timeout=2)
    addresses = [ipaddress.ip_address(row[4][0]) for row in rows]
    if not addresses or any(not address.is_global or address.is_multicast or address.is_reserved or
                            (address.version == 6 and (address.ipv4_mapped or address.sixtofour or address.teredo)) for address in addresses):
        raise ValueError('La inspección HTTP no admite destinos privados, locales o especiales.')
    return str(addresses[0])


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address, port, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def safe_http_get(url: str, user_agent: str, *, limit=MAX_BODY, redirects=3) -> dict:
    chain, deadline = [], time.monotonic() + 8
    for _ in range(redirects + 1):
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or not parsed.hostname or len(url) > 4096:
            raise ValueError('URL de inspección no permitida')
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if port not in (80, 443):
            raise ValueError('Solo se inspeccionan puertos web 80 y 443')
        host = parsed.hostname.encode('idna').decode('ascii')
        address = resolve_public(host, port)
        remaining = min(2.5, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError('Presupuesto de inspección agotado')
        if parsed.scheme == 'https':
            connection = PinnedHTTPSConnection(host, address, port, remaining)
        else:
            connection = http.client.HTTPConnection(address, port, timeout=remaining)
        try:
            connection.connect()
            connection.sock = _DeadlineSocket(connection.sock, deadline)
            path = quote(parsed.path or '/', safe='/:%@!$&\'()*+,;=-._~')
            if parsed.query:
                path += '?' + quote(parsed.query, safe='=&%/:?@!$\'()*+,;~-._')
            connection.request('GET', path, headers={'Host': host, 'User-Agent': user_agent,
                                                    'Accept': 'text/html,application/json;q=0.9,*/*;q=0.1',
                                                    'Accept-Encoding': 'identity', 'Connection': 'close'})
            response = connection.getresponse()
            chain.append({'host': host, 'status': response.status})
            location = response.getheader('Location')
            if response.status in (301, 302, 303, 307, 308) and location:
                url = urljoin(url, location)
                continue  # All redirect destinations are resolved, validated and pinned again.
            chunks, size = [], 0
            while size <= limit:
                remaining = min(2.5, deadline - time.monotonic())
                if remaining <= 0:
                    raise TimeoutError('Tiempo de descarga agotado')
                if connection.sock:
                    connection.sock.settimeout(remaining)
                chunk = response.read(min(8192, limit + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            return {'status': response.status, 'chain': chain, 'size': min(size, limit), 'truncated': size > limit,
                    'body': b''.join(chunks)[:limit], 'finalHost': host}
        finally:
            connection.close()
    raise ValueError('Se excedió el máximo de redirecciones')


def _json_lookup(url: str):
    response = safe_http_get(url, 'OMEGA-Infrastructure-Check/1.0', limit=512 * 1024)
    if response['status'] != 200 or response['truncated']:
        raise ValueError('Proveedor no disponible o respuesta demasiado grande')
    return json.loads(response['body'])


def _age(value) -> int | None:
    try:
        timestamp = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        days = (datetime.now(timezone.utc) - timestamp).days
        return days if days >= 0 else None
    except (ValueError, TypeError):
        return None


def passive_infrastructure(host: str) -> dict:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return {'domainAgeDays': None, 'freshTlsCertificate': None, 'certificateAgeDays': None,
                'certificateIssuers': [], 'rdapDomain': None, 'sources': [],
                'limitations': ['La edad de un dominio y sus certificados no se infieren de una dirección IP.']}
    domain = registrable_domain(host)
    with _LOCK:
        cached = _CACHE.get(host)
        if cached and cached[0] > time.monotonic():
            return dict(cached[1])
    data = {'domainAgeDays': None, 'freshTlsCertificate': None, 'certificateAgeDays': None, 'certificateIssuers': [],
            'rdapDomain': domain, 'sources': [], 'limitations': []}
    try:
        rdap = _json_lookup('https://rdap.org/domain/' + quote(domain, safe=''))
        registration = [_age(event.get('eventDate')) for event in rdap.get('events', []) if event.get('eventAction') == 'registration']
        data['domainAgeDays'] = max((age for age in registration if age is not None), default=None)
        data['sources'].append('RDAP')
    except Exception:
        data['limitations'].append('Edad del dominio no disponible en RDAP.')
    try:
        certificates, after, exhausted = [], '', False
        for _ in range(3):
            page = _json_lookup('https://api.certspotter.com/v1/issuances?domain=' + quote(host, safe='') + '&expand=issuer' + ('&after=' + quote(after, safe='') if after else ''))
            if not isinstance(page, list):
                raise ValueError('Respuesta CT inesperada')
            certificates.extend(row for row in page if isinstance(row, dict) and row.get('revoked') is not True)
            if not page:
                exhausted = True
                break
            next_after = str(page[-1].get('id', ''))
            if not next_after or next_after == after:
                break
            after = next_after
        ages = [_age(row.get('not_before') or row.get('cert', {}).get('not_before')) for row in certificates if isinstance(row, dict)] if isinstance(certificates, list) else []
        age = min((value for value in ages if value is not None), default=None)
        data['certificateAgeDays'] = age
        data['freshTlsCertificate'] = True if age is not None and age < 30 else False if exhausted and age is not None else None
        data['certificateIssuers'] = list({str(row.get('issuer', {}).get('name', '')) for row in certificates if isinstance(row, dict) and isinstance(row.get('issuer'), dict)})[:20] if isinstance(certificates, list) else []
        data['sources'].append('Certificate Transparency / CertSpotter')
        if not exhausted:
            data['limitations'].append('Consulta CT acotada a tres páginas; puede no incluir las emisiones más recientes.')
    except Exception:
        data['limitations'].append('Fecha de emisión TLS no disponible en CT.')
    data['limitations'].append('Un certificado reciente o gratuito es habitual en sitios legítimos; no demuestra infraestructura maliciosa.')
    with _LOCK:
        if len(_CACHE) >= 512:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[host] = (time.monotonic() + (3600 if data['domainAgeDays'] is not None else 60), data)
    return dict(data)


def inspect_evasion(url: str, host: str, *, active_probe=False) -> dict:
    data = passive_infrastructure(host)
    score, reasons = 0, []
    age = data['domainAgeDays']
    if age is not None and age < 30:
        score += 30
        reasons.append(f'El dominio registrable fue creado hace {age} día(s).')
    if data['freshTlsCertificate']:
        score += 10
        reasons.append('Hay un certificado TLS emitido hace menos de 30 días; puede ser una renovación legítima.')
    label = host.split('.')[0]
    entropy = -sum((label.count(char) / len(label)) * math.log2(label.count(char) / len(label)) for char in set(label)) if label else 0
    if len(label) >= 16 and entropy > 3.7:
        score += 10
        reasons.append('El nombre contiene una secuencia de alta entropía; también puede pertenecer a un servicio legítimo.')
    if any(part.startswith('xn--') for part in host.split('.')):
        score += 15
        reasons.append('El dominio usa IDN/Punycode. Comprueba visualmente su identidad; no todo IDN es un homógrafo malicioso.')
    data = {**data, 'limitations': list(data['limitations'])}
    data.update(cloakingDetected=None, activeProbeRequested=active_probe, activeProbePerformed=False, probeEvidence=None)
    if active_probe:
        try:
            generic = safe_http_get(url, 'OMEGA-Link-Inspector/1.0')
            mobile = safe_http_get(url, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
            discrepant = generic['status'] in (401, 403, 404, 410) and mobile['status'] == 200
            redirected = [hop['host'] for hop in generic['chain']] != [hop['host'] for hop in mobile['chain']]
            different_size = not generic['truncated'] and not mobile['truncated'] and mobile['size'] > max(4096, generic['size'] * 5)
            cloaking = discrepant or (redirected and different_size)
            data.update(cloakingDetected=cloaking, activeProbePerformed=True,
                        probeEvidence={name: {key: row[key] for key in ('status', 'chain', 'size', 'truncated', 'finalHost')}
                                       for name, row in (('generic', generic), ('mobile', mobile))})
            if cloaking:
                score += 45
                reasons.append('El servidor responde de forma muy distinta al perfil móvil y al cliente genérico. Puede ser segmentación, un WAF o evasión; no prueba spyware.')
            if max(len(generic['chain']), len(mobile['chain'])) >= 3 and any(hop['host'] in REDIRECTOR_HOSTS for hop in generic['chain'] + mobile['chain']):
                score += 15
                reasons.append('Se observaron varios saltos mediante acortadores o redireccionadores antes del destino final; también puede ser un flujo legítimo.')
        except Exception:
            data['limitations'].append('La comparación HTTP no pudo completarse; no se considera ausencia de evasión.')
    data.update(evasionRiskScore=min(100, score), evasionReasons=reasons,
                riskLevel='CRITICAL' if score >= 90 else 'HIGH' if score >= 60 else 'MEDIUM' if score >= 30 else 'LOW')
    return data
