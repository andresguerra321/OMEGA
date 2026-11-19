param(
    [switch]$SkipBundle
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$SensorDir = Join-Path $RepoRoot 'omega\sensor-rust'
$FrontendDir = Join-Path $RepoRoot 'omega\frontend'
$BinariesDir = Join-Path $FrontendDir 'src-tauri\binaries'

Write-Host '[1/3] Compilando sensor nativo Rust (omega-sensor --release)...' -ForegroundColor Cyan
Push-Location $SensorDir
try {
    cargo build --release
    if ($LASTEXITCODE -ne 0) { throw 'Fallo compilando omega-sensor' }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
$TargetTriple = 'x86_64-pc-windows-msvc'
$SrcExe = Join-Path $SensorDir 'target\release\omega-sensor.exe'
$DstExe = Join-Path $BinariesDir "omega-sensor-$TargetTriple.exe"
Copy-Item -Force $SrcExe $DstExe
Write-Host "    Sidecar copiado en: $DstExe" -ForegroundColor Green

Write-Host '[2/3] Compilando frontend React/Vite...' -ForegroundColor Cyan
Push-Location $FrontendDir
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Fallo compilando frontend Vite' }

    if (-not $SkipBundle) {
        Write-Host '[3/3] Generando instaladores Tauri v2 (.exe NSIS y .msi WiX)...' -ForegroundColor Cyan
        npx.cmd @tauri-apps/cli@2 build
        if ($LASTEXITCODE -ne 0) { throw 'Fallo generando bundle Tauri v2' }
    } else {
        Write-Host '[3/3] SkipBundle activo: sensor + frontend listos.' -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
