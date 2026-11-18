param(
    [Parameter(Mandatory = $true)][Guid]$TenantId,
    [Parameter(Mandatory = $true)][ValidatePattern('^S-1-5-21-(\d+-){3}\d+$')][string]$UserSid,
    [string]$PythonPath = 'python'
)
$ErrorActionPreference = 'Stop'
$apiDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../api'))
$env:OMEGA_HOST_OWNER_TENANT_ID = $TenantId.ToString()
$env:OMEGA_HOST_IOC_SOURCE = 'gateway'
$env:OMEGA_SENSOR_USER_SID = $UserSid
Remove-Item Env:INTERNAL_SERVICE_TOKEN -ErrorAction SilentlyContinue
& $PythonPath -I -S (Join-Path $apiDir 'sensor_bootstrap.py') --service --endpoint ('\\.\pipe\omega-agent-' + $TenantId)
if ($LASTEXITCODE -ne 0) { throw 'El sensor nativo rechazo el arranque.' }
