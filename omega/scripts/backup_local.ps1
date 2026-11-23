Param(
    [string]$PostgresContainer = "omega-postgres",
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

docker exec $PostgresContainer pg_dump -U $PostgresUser -d $PostgresDb -Fc > $DumpFile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $DumpFile) -or (Get-Item $DumpFile).Length -eq 0) {
    throw "Fallo al generar el volcado de PostgreSQL."
}

$Hash = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
"$Hash  omega_pg.dump" | Set-Content -Path (Join-Path $TargetDir "SHA256SUMS.txt") -Encoding utf8

Write-Host "[OMEGA Backup] Completado en $TargetDir (SHA-256: $Hash)"
