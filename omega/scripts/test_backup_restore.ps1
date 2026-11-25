Param(
    [Parameter(Mandatory = $true)][string]$BackupFile
)
$ErrorActionPreference = 'Stop'
$ResolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not (Test-Path -LiteralPath $ResolvedBackup -PathType Leaf)) { throw 'Selecciona un archivo de respaldo.' }
$QaContainer = 'omega-restore-check-' + [guid]::NewGuid().ToString('N')
$QaPassword = [guid]::NewGuid().ToString('N')
try {
    docker run -d --network none --name $QaContainer -e POSTGRES_USER=omega_restore -e "POSTGRES_PASSWORD=$QaPassword" -e POSTGRES_DB=omega_restore pgvector/pgvector:pg16 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el contenedor aislado de restauracion.' }
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        docker exec $QaContainer pg_isready -h 127.0.0.1 -U omega_restore -d omega_restore > $null
        if ($LASTEXITCODE -eq 0) { $Ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $Ready) { throw 'PostgreSQL de prueba no termino de iniciar.' }
    docker cp $ResolvedBackup "${QaContainer}:/tmp/restore-check.dump"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo al entorno aislado.' }
    docker exec $QaContainer pg_restore --exit-on-error --no-owner --no-privileges -U omega_restore -d omega_restore /tmp/restore-check.dump
    if ($LASTEXITCODE -ne 0) { throw 'La restauracion del respaldo fallo.' }
    $Counts = docker exec $QaContainer psql -U omega_restore -d omega_restore -tAc 'SELECT (SELECT count(*) FROM omega_rag.tenants), (SELECT count(*) FROM omega_rag.users), (SELECT count(*) FROM omega_rag.billing_payments), (SELECT count(*) FROM omega_rag.report_snapshots);'
    if ($LASTEXITCODE -ne 0) { throw 'Faltan tablas comerciales esenciales en la restauracion.' }
    Write-Output ('Restauracion aislada completada. Cuentas|Usuarios|Pagos|Informes: ' + $Counts.Trim())
} finally {
    if ($QaContainer -match '^omega-restore-check-[a-f0-9]{32}$') {
        $InspectedName = docker inspect --format '{{.Name}}' $QaContainer 2>$null
        if ($InspectedName -eq "/$QaContainer") { docker rm -f -v $QaContainer | Out-Null }
    }
}
