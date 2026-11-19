"""Run the packaged Windows sensor through authenticated Java and Python in a disposable stack.

Host telemetry stays in RAM. Only aggregate counts are printed; the user's database is never used.
"""
import json
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request

from smoke_local_recovery import docker


def check():
    sensor = Path(__file__).resolve().parents[1] / 'sensor-rust/target/release/omega-sensor.exe'
    collected = subprocess.run([str(sensor), '--once'], capture_output=True, text=True, timeout=60, check=True)
    snapshot = json.loads(collected.stdout)
    assert snapshot.get('processes'), 'The native sensor did not capture processes'
    prefix = 'omega-host-check-' + secrets.token_hex(5)
    database, backend, worker, network = (prefix + suffix for suffix in ('-db', '-api', '-worker', '-net'))
    password, internal = secrets.token_hex(24), secrets.token_hex(32)
    try:
        docker('network', 'create', network)
        docker('run', '--rm', '-d', '--name', database, '--network', network, '--network-alias', 'database',
               '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=check_owner',
               '-e', 'POSTGRES_DB=check_db', '-e', 'POSTGRES_PASSWORD=' + password, 'pgvector/pgvector:pg16')
        for _ in range(60):
            if subprocess.run(['docker', 'exec', database, 'pg_isready', '-U', 'check_owner', '-d', 'check_db'], capture_output=True).returncode == 0:
                break
            time.sleep(1)
        docker('run', '--rm', '-d', '--name', worker, '--network', network, '--network-alias', 'forensic-worker',
               '-e', 'POSTGRES_HOST=database', '-e', 'POSTGRES_PORT=5432', '-e', 'POSTGRES_DB=check_db',
               '-e', 'POSTGRES_USER=check_owner', '-e', 'POSTGRES_PASSWORD=' + password,
               '-e', 'INTERNAL_SERVICE_TOKEN=' + internal, '-e', 'OMEGA_REQUIRE_HMAC=true', 'omega-forensic-worker:latest')
        docker('run', '--rm', '-d', '--name', backend, '--network', network, '-p', '127.0.0.1::8080',
               '-e', 'SPRING_DATASOURCE_URL=jdbc:postgresql://database:5432/check_db?currentSchema=omega_rag,public',
               '-e', 'POSTGRES_USER=check_owner', '-e', 'POSTGRES_PASSWORD=' + password,
               '-e', 'OMEGA_JWT_SECRET=' + secrets.token_hex(48), '-e', 'INTERNAL_SERVICE_TOKEN=' + internal,
               '-e', 'OMEGA_FORENSIC_WORKER_URL=http://forensic-worker:8000', '-e', 'OMEGA_REQUIRE_HMAC=true',
               '-e', 'OMEGA_EXTERNAL_IOC_SYNC_ENABLED=false',
               'omega-backend-java:latest')
        ports = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', backend))
        base = 'http://127.0.0.1:' + ports['8080/tcp'][0]['HostPort']

        def request(path, body=None, token=None):
            headers = {'Content-Type': 'application/json', 'X-Omega-Auth-Mode': 'bearer'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=90) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)

        for _ in range(120):
            try:
                if request('/actuator/health')[0] == 200:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('The isolated backend did not become healthy')

        endpoint = '/api/v1/forensics/triage/pc-live'
        assert request(endpoint, snapshot)[0] == 401, 'Anonymous users can run a host audit'
        status, account = request('/api/v1/auth/register', {
            'fullName': 'Ana Martinez', 'email': 'host-check@example.org', 'password': 'Isolated-password-123'})
        assert status == 201, f'Registration failed: HTTP {status}'
        token = account['accessToken']
        status, report = request(endpoint, snapshot, token)
        assert status == 200, f'Host audit failed: HTTP {status}'
        triage = report['triage']
        assert triage['total_indicators_analyzed'] > 0, 'The collector and analyzer contract dropped the indicators'
        assert report['device_summary']['hostname'] == snapshot['host']['hostname'], 'Host metadata was dropped'
        assert report['collection_status'].get('processes') == 'available'

        status, empty = request(endpoint, {'platform': 'win32'}, token)
        assert status == 200 and empty['triage']['diagnosis']['verdict_code'] == 'INCOMPLETE'
        assert empty['triage']['total_files'] == 0
        status, scope = request('/api/v1/forensics/host/realtime/status', token=token)
        assert status == 200 and scope['scope'] == 'container' and not scope['active']
        print(json.dumps({
            'result': 'PASS', 'sensor_version': snapshot['sensor_version'],
            'captured_processes': len(snapshot['processes']), 'captured_connections': len(snapshot['tcp_connections']),
            'captured_tasks': len(snapshot['scheduled_tasks']), 'analyzed_indicators': triage['total_indicators_analyzed'],
            'unauthenticated_audit': 'blocked', 'empty_capture': 'INCOMPLETE', 'docker_surveillance': 'unavailable',
        }))
    except Exception:
        # Isolated fixtures only; retain the worker traceback before its container is removed.
        result = subprocess.run(['docker', 'logs', '--tail', '35', worker], capture_output=True, text=True)
        print(result.stderr[-5000:])
        raise
    finally:
        for name in (backend, worker, database):
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        subprocess.run(['docker', 'network', 'rm', network], capture_output=True)


if __name__ == '__main__':
    check()
