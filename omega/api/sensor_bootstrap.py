"""Isolated interpreter entry: inspect .pth before adding dependency directories."""
import argparse
from pathlib import Path
import sys
import sysconfig

if not sys.flags.no_site or not sys.flags.isolated:
    raise SystemExit('El sensor requiere python -I -S')
executable = Path(sys.executable)
for prefix in (executable.parent, executable.parent.parent):
    if (prefix / 'pyvenv.cfg').is_file():
        sys.prefix = sys.exec_prefix = str(prefix)
        break
for name in ('purelib', 'platlib'):
    directory = Path(sysconfig.get_path(name, vars={'base': sys.prefix, 'platbase': sys.exec_prefix}))
    if any(directory.glob('*.pth')):
        raise SystemExit('Integridad comprometida: .pth en dependencias del sensor')
    for suffix in ('', 'win32', 'win32/lib', 'pywin32_system32'):
        sys.path.append(str(directory / suffix))
if sys.platform == 'win32':
    import os
    dll_path = Path(sysconfig.get_path('platlib', vars={'base': sys.prefix, 'platbase': sys.exec_prefix})) / 'pywin32_system32'
    _dll_dirs = [os.add_dll_directory(str(dll_path))] if dll_path.is_dir() else []

# Run with -I -S in installed services. Only signed dependency paths are permitted.
root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))
from host_runtime import start_sensor

parser = argparse.ArgumentParser()
parser.add_argument('--endpoint')
parser.add_argument('--service', action='store_true')
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
if args.verify_only:
    from self_integrity import verify_release
    verify_release(root.parent)
elif args.endpoint:
    start_sensor(args.endpoint, service=args.service)
else:
    parser.error('Falta --endpoint')
