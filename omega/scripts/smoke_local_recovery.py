"""Check the packaged backend against an isolated disposable database, never the user's installation."""
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request


def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'Docker {args[0]} failed: {result.stderr[:500]}')
    return result.stdout.strip()


def check():
    prefix = 'omega-recovery-check-' + secrets.token_hex(5)
    database, backend, network = prefix + '-db', prefix + '-api', prefix + '-net'
    password = secrets.token_hex(24)
    try:
        docker('network', 'create', network)
        docker('run', '--rm', '-d', '--name', database, '--network', network, '--network-alias', 'database',
               '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=check_owner',
               '-e', 'POSTGRES_DB=check_db', '-e', 'POSTGRES_PASSWORD=' + password, 'pgvector/pgvector:pg16')
        for _ in range(60):
            result = subprocess.run(['docker', 'exec', database, 'pg_isready', '-U', 'check_owner', '-d', 'check_db'], capture_output=True)
            if result.returncode == 0:
                break
            time.sleep(1)
        docker('run', '--rm', '-d', '--name', backend, '--network', network, '-p', '127.0.0.1::8080',
               '-e', 'SPRING_DATASOURCE_URL=jdbc:postgresql://database:5432/check_db?currentSchema=omega_rag,public',
               '-e', 'POSTGRES_USER=check_owner', '-e', 'POSTGRES_PASSWORD=' + password,
               '-e', 'OMEGA_JWT_SECRET=' + secrets.token_hex(48), '-e', 'INTERNAL_SERVICE_TOKEN=' + secrets.token_hex(32),
               '-e', 'OMEGA_EXTERNAL_IOC_SYNC_ENABLED=false', '-e', 'OMEGA_LOCAL_ACCESS_ENABLED=true',
               'omega-backend-java:latest')
        ports = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', backend))
        base = 'http://127.0.0.1:' + ports['8080/tcp'][0]['HostPort']

        def request(path, body=None, token=None):
            headers = {'Content-Type': 'application/json', 'X-Omega-Auth-Mode': 'bearer'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=3) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)

        def wait_ready():
            for _ in range(120):
                try:
                    if request('/actuator/health')[0] == 200:
                        return
                except (OSError, ValueError):
                    pass
                time.sleep(1)
            raise RuntimeError('The isolated backend did not become healthy')

        wait_ready()
        status, config = request('/api/v1/auth/config')
        assert status == 200 and config['localAccessEnabled'] is False
        assert request('/api/v1/auth/local-session', {})[0] == 401
        assert request('/api/v1/auth/me')[0] == 401
        status, account = request('/api/v1/auth/register', {
            'fullName': 'Ana Martinez', 'email': 'ana@example.org', 'password': 'Initial-password-123'})
        assert status == 201, f'Registration failed: {status}'
        key = account.get('recoveryKey', '')
        assert len(key) == 48, 'Registration did not supply the recovery key'
        status, response = request('/api/v1/auth/password-reset/request', {'email': 'ana@example.org'})
        assert status == 200 and response['deliveryMode'] == 'recovery_key'
        reset = {'email': 'ana@example.org', 'code': key, 'newPassword': 'Replacement-password-123'}
        assert request('/api/v1/auth/password-reset/confirm', reset)[0] == 200
        assert request('/api/v1/auth/password-reset/confirm', reset)[0] == 401, 'A consumed key was reused'
        assert request('/api/v1/auth/login', {'email': 'ana@example.org', 'password': 'Initial-password-123'})[0] == 401
        status, login = request('/api/v1/auth/login', {'email': 'ana@example.org', 'password': 'Replacement-password-123'})
        assert status == 200
        assert request('/api/v1/auth/recovery-key', {'password': 'Replacement-password-123'})[0] == 401
        status, new_key = request('/api/v1/auth/recovery-key', {'password': 'Replacement-password-123'}, login['accessToken'])
        assert status == 200 and len(new_key['recoveryKey']) == 48
        stored_length = docker('exec', database, 'psql', '-U', 'check_owner', '-d', 'check_db', '-Atc',
                               'SELECT length(key_hash) FROM omega_rag.account_recovery_keys')
        assert stored_length == '64', 'The database should store only the SHA-256 hash'
        docker('restart', backend)
        ports = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', backend))
        base = 'http://127.0.0.1:' + ports['8080/tcp'][0]['HostPort']
        wait_ready()
        assert request('/api/v1/auth/login', {'email': 'ana@example.org', 'password': 'Replacement-password-123'})[0] == 200
        print('PASS: fresh migration, registration, offline recovery, single use, authenticated key rotation, hash storage, restart persistence')
    finally:
        for name in (backend, database):
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        subprocess.run(['docker', 'network', 'rm', network], capture_output=True)


if __name__ == '__main__':
    check()
