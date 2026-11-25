Param(
    [string]$PostgresContainer = "omega_postgres",
    [string]$PostgresUser = "omega_admin",
    [string]$PostgresDb = "omega_cti",
    [string]$OutputRoot = ".\backups"
)

$ErrorActionPreference = "Stop"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TargetDir = Join-Path $OutputRoot $Stamp
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$DumpFile = Join-Path $TargetDir "omega_pg.dump"
Write-Host "[OMEGA Backup] Exportando PostgreSQL ($PostgresDb) desde contenedor '$PostgresContainer'..."

if ($PostgresContainer -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$') { throw "Nombre de contenedor invalido." }
$RemoteDump = '/tmp/omega-backup-' + [guid]::NewGuid().ToString('N') + '.dump'
try {
    # Avoid binary redirection through Windows PowerShell 5.1 text encoding.
    docker exec $PostgresContainer pg_dump -U $PostgresUser -d $PostgresDb -Fc --file $RemoteDump
    if ($LASTEXITCODE -ne 0) { throw "Fallo al generar el volcado de PostgreSQL." }
    docker exec $PostgresContainer pg_restore --list $RemoteDump > $null
    if ($LASTEXITCODE -ne 0) { throw "El volcado no puede ser leido por pg_restore." }
    docker cp "${PostgresContainer}:$RemoteDump" $DumpFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $DumpFile) -or (Get-Item -LiteralPath $DumpFile).Length -eq 0) {
        throw "Fallo al copiar el volcado de PostgreSQL."
    }
} finally {
    if ($RemoteDump -match '^/tmp/omega-backup-[a-f0-9]{32}\.dump$') { docker exec $PostgresContainer rm -f -- $RemoteDump | Out-Null }
}

$Hash = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
"$Hash  omega_pg.dump" | Set-Content -Path (Join-Path $TargetDir "SHA256SUMS.txt") -Encoding utf8

Write-Host "[OMEGA Backup] Completado en $TargetDir (SHA-256: $Hash)"
