$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$audit = @{ host = @{}; collection_status = @{}; collection_errors = @() }
function Read-AuditSection($name, [scriptblock]$read) {
    try {
        $audit[$name] = @(& $read)
        $audit.collection_status[$name] = 'available'
    } catch {
        $audit[$name] = @()
        $audit.collection_status[$name] = 'unavailable'
        $audit.collection_errors += "${name}: $($_.Exception.Message)"
    }
}
Read-AuditSection 'tcp_connections' {
    Get-NetTCPConnection -ErrorAction Stop | ForEach-Object {
        @{ remote_ip = $_.RemoteAddress; remote_port = $_.RemotePort; local_port = $_.LocalPort; pid = $_.OwningProcess; state = [string]$_.State }
    }
}
Read-AuditSection 'wmi_subscriptions' {
    Get-CimInstance -Namespace root/subscription -ClassName __EventFilter -ErrorAction Stop | ForEach-Object {
        @{ name = $_.Name; query_or_target = $_.Query }
    }
}
Read-AuditSection 'scheduled_tasks' {
    Get-ScheduledTask -ErrorAction Stop | ForEach-Object {
        $task = $_
        $task.Actions | ForEach-Object { @{ name = $task.TaskName; task_path = $task.TaskPath; execute = $_.Execute; arguments = $_.Arguments } }
    }
}
Read-AuditSection 'startup_items' {
    Get-CimInstance Win32_StartupCommand -ErrorAction Stop | ForEach-Object { @{ name = $_.Name; command = $_.Command } }
}
try {
    $defender = Get-MpComputerStatus -ErrorAction Stop
    $audit.host.defender_realtime = [bool]$defender.RealTimeProtectionEnabled
    $audit.collection_status.defender = 'available'
} catch { $audit.collection_status.defender = 'unavailable' }
try {
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
    if ($profiles.Count -eq 0) { throw 'No se recibieron perfiles del firewall' }
    $audit.host.firewall_enabled = @($profiles | Where-Object { -not $_.Enabled }).Count -eq 0
    $audit.collection_status.firewall = 'available'
} catch { $audit.collection_status.firewall = 'unavailable' }
try {
    $uac = Get-ItemProperty 'HKLM:/SOFTWARE/Microsoft/Windows/CurrentVersion/Policies/System' -Name EnableLUA -ErrorAction Stop
    $audit.host.uac_enabled = $uac.EnableLUA -eq 1
    $audit.collection_status.uac = 'available'
} catch { $audit.collection_status.uac = 'unavailable' }
$audit | ConvertTo-Json -Depth 8 -Compress
