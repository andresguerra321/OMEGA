"""Ephemeral, request/response authenticated local sensor protocol."""
import hashlib
import hmac
import re
import secrets
import threading
import time

ACTIVE = None


def signature(secret, direction, method, target, timestamp, nonce, body=b''):
    message = '\n'.join((direction, method.upper(), target, timestamp, nonce,
                         hashlib.sha256(body).hexdigest())).encode()
    return hmac.new(bytes.fromhex(secret), message, hashlib.sha256).hexdigest()


class LocalAuthenticator:
    def __init__(self, secret=None):
        self.secret = secret or secrets.token_hex(32)
        if not re.fullmatch(r'[0-9a-f]{64}', self.secret):
            raise ValueError('Se requiere un secreto efímero de 256 bits')
        self.seen = {}
        self.lock = threading.Lock()

    def verify(self, method, target, headers, body):
        stamp, nonce = headers.get('x-omega-time', ''), headers.get('x-omega-nonce', '')
        supplied = headers.get('x-omega-signature', '')
        if not isinstance(supplied, str) or not re.fullmatch(r'[0-9a-f]{64}', supplied):
            return False
        try:
            now = time.time()
            if abs(now - int(stamp)) > 30 or not re.fullmatch(r'[0-9a-f]{32}', nonce):
                return False
        except (ValueError, TypeError):
            return False
        expected = signature(self.secret, 'request', method, target, stamp, nonce, body)
        if not hmac.compare_digest(expected, supplied):
            return False
        with self.lock:
            self.seen = {key: expiry for key, expiry in self.seen.items() if expiry > now}
            if nonce in self.seen or len(self.seen) >= 10000:
                return False
            self.seen[nonce] = now + 61
        return True
