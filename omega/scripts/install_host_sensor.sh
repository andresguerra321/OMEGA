#!/bin/sh
# POSIX installer: no downloads, credentials or silent elevation.
set -eu
if [ "$(id -u)" != 0 ]; then echo 'Ejecuta como root.' >&2; exit 1; fi
if [ "${1:-}" = '--uninstall' ]; then
  case "$(uname -s)" in
    Linux) systemctl disable --now omega-agent; rm -f /etc/systemd/system/omega-agent.service; systemctl daemon-reload ;;
    Darwin) launchctl bootout system/com.omega.agent; rm -f /Library/LaunchDaemons/com.omega.agent.plist ;;
    *) exit 1 ;;
  esac
  echo 'Servicio retirado; se conservan archivos y evidencia.'
  exit 0
fi
[ "$#" = 3 ] || { echo 'Uso: install_host_sensor.sh TENANT_UUID USUARIO /ruta/python3' >&2; exit 1; }
tenant=$1
user=$2
python=$3
echo "$tenant" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' || exit 1
echo "$python" | LC_ALL=C grep -Eq '^/[a-zA-Z0-9_./-]+$' || exit 1
uid=$(id -u "$user")
[ "$uid" != 0 ] || { echo 'Selecciona un usuario de UI sin privilegios.' >&2; exit 1; }
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target=/opt/omega-agent
[ ! -e "$target" ] || { echo 'El destino existe; revisa la actualización manualmente.' >&2; exit 1; }
"$python" -I -S -c 'import os, pathlib, sys; p=pathlib.Path(sys.executable).resolve(); paths=[p,*p.parents,pathlib.Path(sys.prefix)]; assert all(x.stat().st_uid==0 and x.stat().st_mode & 0o022==0 for x in paths), "Python inseguro"'
install -d -m 0755 "$target"
for folder in api rag_engine corpus_mvp; do
  if [ -d "$source_root/$folder" ]; then cp -R "$source_root/$folder" "$target/"; fi
done
cp "$source_root/integrity-manifest.json" "$source_root/integrity-manifest.sig" "$target/"
chown -R root:0 "$target"
find "$target" -type d -exec chmod 0755 {} \;
find "$target" -type f -exec chmod 0644 {} \;
"$python" -I -S "$target/api/sensor_bootstrap.py" --verify-only
case "$(uname -s)" in
  Linux)
    install -d -m 0755 /run/omega-agent
    cat > /etc/systemd/system/omega-agent.service <<EOF
[Unit]
Description=OMEGA privileged host sensor
After=network.target
[Service]
Type=simple
User=root
ExecStart=$python -I -S $target/api/sensor_bootstrap.py --service --endpoint /run/omega-agent/sensor.sock
Environment=OMEGA_HOST_OWNER_TENANT_ID=$tenant
Environment=OMEGA_SENSOR_UID=$uid
Environment=OMEGA_HOST_IOC_SOURCE=gateway
RuntimeDirectory=omega-agent
RuntimeDirectoryMode=0755
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/run/omega-agent /var/lib/omega-agent
StateDirectory=omega-agent
Environment=OMEGA_CONTAINMENT_DIR=/var/lib/omega-agent
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now omega-agent
    ;;
  Darwin)
    install -d -m 0755 /var/run/omega-agent
    cat > /Library/LaunchDaemons/com.omega.agent.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.omega.agent</string>
<key>ProgramArguments</key><array><string>$python</string><string>-I</string><string>-S</string><string>$target/api/sensor_bootstrap.py</string><string>--service</string><string>--endpoint</string><string>/var/run/omega-agent/sensor.sock</string></array>
<key>EnvironmentVariables</key><dict><key>OMEGA_HOST_OWNER_TENANT_ID</key><string>$tenant</string><key>OMEGA_SENSOR_UID</key><string>$uid</string><key>OMEGA_HOST_IOC_SOURCE</key><string>gateway</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>Umask</key><integer>63</integer>
</dict></plist>
EOF
    chmod 0644 /Library/LaunchDaemons/com.omega.agent.plist
    launchctl bootstrap system /Library/LaunchDaemons/com.omega.agent.plist
    ;;
  *) echo 'Sistema no soportado.' >&2; exit 1 ;;
esac
echo 'omega-agent instalado. Ejecuta la UI como usuario normal.'
