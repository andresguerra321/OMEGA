param(
    [Parameter(Mandatory = $true)][Guid]$TenantId,
    [ValidateRange(1024, 65535)][int]$Port = 8765,
    [string]$BindAddress = '127.0.0.1',
    [switch]$EnableRealtime
)
$ErrorActionPreference = 'Stop'
if (-not $env:INTERNAL_SERVICE_TOKEN -or $env:INTERNAL_SERVICE_TOKEN.Length -lt 32) {
    throw 'Define INTERNAL_SERVICE_TOKEN con un secreto exclusivo del sensor de al menos 32 caracteres.'
}
$apiDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../api'))
$env:OMEGA_HOST_OWNER_TENANT_ID = $TenantId.ToString()
$env:OMEGA_HOST_IOC_SOURCE = 'gateway'
$env:OMEGA_REALTIME_ENABLED = if ($EnableRealtime) { 'true' } else { 'false' }
python -m uvicorn main:app --app-dir $apiDir --host $BindAddress --port $Port --workers 1
if ($LASTEXITCODE -ne 0) { throw 'El sensor nativo terminó con un error.' }
