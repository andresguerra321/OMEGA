[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][Guid]$TenantId,
    [string]$PythonPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^S-1-5-21-(\d+-){3}\d+$')][string]$UserSid,
    [string]$InstallRoot = (Join-Path $env:ProgramFiles 'OMEGA-Sensor'),
    [switch]$Uninstall,
    [switch]$EnsureInstalled
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta el instalador desde PowerShell elevado.'
}
if ($Uninstall) {
    if ($PSCmdlet.ShouldProcess('omega-agent', 'Detener y eliminar servicio; conservar archivos')) {
        Stop-Service omega-agent -ErrorAction SilentlyContinue
        & sc.exe delete omega-agent
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo eliminar omega-agent.' }
    }
    return
}
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($EnsureInstalled -and -not $PSBoundParameters.ContainsKey('InstallRoot')) {
    $release = (Get-FileHash -LiteralPath (Join-Path $source 'integrity-manifest.json') -Algorithm SHA256).Hash.Substring(0, 16)
    $InstallRoot = Join-Path $env:ProgramFiles ('OMEGA-Sensor-' + $release)
}
$destination = [IO.Path]::GetFullPath($InstallRoot)
$programs = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\') + '\'
function Assert-AdministrativePath([string]$Path) {
    $current = Get-Item -LiteralPath $Path -Force
    $trustedOwners = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $writeMask = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    while ($current -and ($current.FullName.TrimEnd('\') + '\').StartsWith($programs, [StringComparison]::OrdinalIgnoreCase)) {
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se permiten enlaces o junctions en rutas del servicio.' }
        $acl = Get-Acl -LiteralPath $current.FullName
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedOwners) { throw 'Propietario no administrativo en una ruta del servicio.' }
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -eq 'Allow' -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($rule.FileSystemRights -band $writeMask)) {
                $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                if ($sid -notin $trustedOwners) { throw 'Una identidad sin privilegios puede escribir en una ruta del servicio.' }
            }
        }
        $current = if ($current.PSIsContainer) { $current.Parent } else { $current.Directory }
    }
}
if (-not $destination.StartsWith($programs, [StringComparison]::OrdinalIgnoreCase)) { throw 'InstallRoot debe estar dentro de Program Files.' }
$existing = Get-CimInstance Win32_Service -Filter "Name='omega-agent'"
if ($existing) {
    if (-not $EnsureInstalled) { throw 'omega-agent ya está instalado.' }
    if (-not $existing.PathName.Contains(('"' + $TenantId.ToString() + '"')) -or -not $existing.PathName.Contains(('"' + $UserSid + '"')) -or
        -not $existing.PathName.Contains('"--bundled"') -or
        -not $existing.PathName.StartsWith(('"' + $programs + 'OMEGA-Sensor'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Esta computadora está vinculada a otra cuenta o tiene una instalación distinta de OMEGA.'
    }
}
if ($PythonPath) {
    $python = (Resolve-Path -LiteralPath $PythonPath).Path
    if (-not $python.StartsWith($programs, [StringComparison]::OrdinalIgnoreCase)) { throw 'Python debe estar protegido en Program Files.' }
    Assert-AdministrativePath $python
} else {
    $python = Join-Path $destination 'sensor_runtime/omega-sensor.exe'
}
Assert-AdministrativePath (Split-Path -Parent $destination)
if (-not $PSCmdlet.ShouldProcess($destination, 'Instalar servicio LocalSystem omega-agent con pipe limitado al SID indicado')) { return }
if (Test-Path -LiteralPath $destination) {
    if (-not $EnsureInstalled) { throw 'El destino ya existe; revisa la actualización manualmente.' }
    Assert-AdministrativePath $destination
} else {
New-Item -ItemType Directory -Path $destination | Out-Null
& icacls.exe $destination /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger el directorio de instalación.' }
foreach ($folder in @('api', 'rag_engine', 'corpus_mvp', 'sensor_runtime', 'scripts')) {
    if (Test-Path -LiteralPath (Join-Path $source $folder)) { Copy-Item -LiteralPath (Join-Path $source $folder) -Destination $destination -Recurse }
}
foreach ($name in @('integrity-manifest.json', 'integrity-manifest.sig')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $destination
}
}
if ($PythonPath) { & $python -I -S (Join-Path $destination 'api/sensor_bootstrap.py') --verify-only }
else { & $python --verify-only }
if ($LASTEXITCODE -ne 0) { throw 'La verificación de integridad falló; no se instala el servicio.' }
$wrapper = Join-Path $destination 'omega-agent.exe'
if (-not (Test-Path -LiteralPath $wrapper)) {
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'host_sensor_service.cs') -Raw) -Language CSharp -ReferencedAssemblies 'System.ServiceProcess.dll' -OutputAssembly $wrapper -OutputType WindowsApplication
}
$endpoint = '\\.\pipe\omega-agent-' + $TenantId.ToString()
$entry = if ($PythonPath) { Join-Path $destination 'api/sensor_bootstrap.py' } else { '--bundled' }
$command = '"{0}" "{1}" "{2}" "{3}" "{4}" "{5}"' -f $wrapper, $python, $entry, $endpoint, $TenantId, $UserSid
if ($existing) {
    Stop-Service omega-agent -ErrorAction Stop
    $changed = Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{ PathName = $command }
    if ($changed.ReturnValue -ne 0) { throw 'No se pudo actualizar el servicio OMEGA.' }
} else {
New-Service -Name omega-agent -BinaryPathName $command -DisplayName 'OMEGA Host Sensor' -StartupType Automatic -Description 'Sensor privilegiado con IPC local autenticado y verificación de integridad.' | Out-Null
}
& sc.exe failure omega-agent reset= 86400 actions= restart/5000/restart/15000/none/0 | Out-Null
Start-Service omega-agent
Write-Output "Instalado. OMEGA_HOST_SOCKET=$endpoint. Ejecuta la interfaz sin elevación."
