<#
.SYNOPSIS
  Script reproducible de evaluación del asistente LEGAL (Q7).
.DESCRIPTION
  -Mode deterministic (por defecto, apto para CI): ejecuta LegalRagQualityBenchmarkTest en Testcontainers (regresión de recuperación léxica, aislamiento SQL y guardarraíles). NO representa calidad de un LLM real.
  -Mode groq (solo manual, nunca en CI): evalúa el conjunto difícil (hard_benchmark_cases.json) contra un backend OMEGA configurado con GROQ_API_KEY.
  -Mode ollama (solo manual, nunca en CI): evalúa el conjunto difícil contra Ollama local (chat + embeddings reales).
#>
param(
    [ValidateSet("deterministic", "groq", "ollama")]
    [string]$Mode = "deterministic",
    [string]$BaseUrl = "http://127.0.0.1:8080"
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "deterministic") {
    Push-Location (Join-Path $PSScriptRoot "..\omega\backend-java")
    try {
        mvn -B test "-Dtest=LegalRagQualityBenchmarkTest"
    } finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

if ($env:CI -eq "true") {
    Write-Error "Los modos -Mode groq y -Mode ollama son únicamente manuales y no deben ejecutarse en CI."
    exit 2
}

if ($Mode -eq "groq" -and [string]::IsNullOrWhiteSpace($env:GROQ_API_KEY)) {
    Write-Error "Define `$env:GROQ_API_KEY antes de ejecutar -Mode groq."
    exit 2
}

python (Join-Path $PSScriptRoot "eval_legal_live_providers.py") --provider $Mode --base-url $BaseUrl
exit $LASTEXITCODE
