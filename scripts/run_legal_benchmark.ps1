# Script reproducible del benchmark de calidad del asistente LEGAL (Q7)
# Ejecuta la batería sintética sobre PostgreSQL + pgvector (Testcontainers) y falla si alguna métrica cae debajo del umbral.
$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..\omega\backend-java")
try {
    mvn -B test "-Dtest=LegalRagQualityBenchmarkTest"
} finally {
    Pop-Location
}
