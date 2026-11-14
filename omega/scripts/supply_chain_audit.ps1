$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

Write-Host '=== 1. Frontend dependency audit (npm audit --omit=dev) ===' -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot 'omega\frontend')
try {
    npm.cmd audit --omit=dev --audit-level=high
} finally {
    Pop-Location
}

Write-Host '=== 2. Python forensic worker audit (pip-audit) ===' -ForegroundColor Cyan
$reqFile = Join-Path $RepoRoot 'omega\api\requirements.txt'
if (Get-Command pip-audit -ErrorAction SilentlyContinue) {
    pip-audit -r $reqFile
} else {
    Write-Warning "pip-audit no instalado en host; ejecuta 'pip install pip-audit && pip-audit -r $reqFile'."
}

Write-Host '=== 3. Java Core CycloneDX SBOM (Docker Maven 3.9 + Temurin 21) ===' -ForegroundColor Cyan
$javaDir = Join-Path $RepoRoot 'omega\backend-java'
$m2Dir = Join-Path $env:USERPROFILE '.m2'
$dockerArgs = @('run', '--rm', '-v', "${javaDir}:/workspace", '-w', '/workspace')
if (Test-Path $m2Dir) {
    $dockerArgs += @('-v', "${m2Dir}:/root/.m2")
}
$dockerArgs += @(
    'maven:3.9-eclipse-temurin-21',
    'mvn', '-B', '-q', 'org.cyclonedx:cyclonedx-maven-plugin:2.9.0:makeBom',
    '-DoutputFormat=json', '-DoutputName=omega-backend-sbom'
)
& docker @dockerArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$sbomPath = Join-Path $javaDir 'target\omega-backend-sbom.json'
if (Test-Path $sbomPath) {
    Write-Host "SBOM Java generado en: $sbomPath" -ForegroundColor Green
}
