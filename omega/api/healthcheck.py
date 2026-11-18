"""Docker health probe using the authenticated protocol, without command-line secrets."""
import hashlib
import os
import secrets
import time
import urllib.request
from local_auth import signature

token = os.environ['INTERNAL_SERVICE_TOKEN']
stamp, nonce = str(int(time.time())), secrets.token_hex(16)
key = hashlib.sha256(token.encode()).hexdigest()
target = '/api/health'
headers = {'X-Internal-Service-Token': token, 'X-Omega-Time': stamp, 'X-Omega-Nonce': nonce,
           'X-Omega-Signature': signature(key, 'request', 'GET', target, stamp, nonce)}
with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000' + target, headers=headers), timeout=3) as response:
    import hmac
    body = response.read(65536)
    if os.getenv('OMEGA_REQUIRE_HMAC', 'false').lower() == 'true' and not hmac.compare_digest(
            response.headers.get('X-Omega-Signature', ''), signature(key, 'response', str(response.status), target, stamp, nonce, body)):
        raise SystemExit(1)
