param(
    [string]$ServerAddress = '121.41.198.198',
    [ValidateRange(1024, 65535)][int]$LocalPort = 8080
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$workspaceDirectory = Split-Path $projectDirectory -Parent
$deployKey = Join-Path $workspaceDirectory '.ssh\dongxin_ecs_deploy_20261102'
$knownHosts = Join-Path $workspaceDirectory '.ssh\dongxin_ecs_known_hosts'
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
foreach ($requiredPath in @($deployKey, $knownHosts, $sshExe)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required file missing: $requiredPath" }
}
$listener = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue
if ($listener) {
    $owners = @($listener.OwningProcess | Select-Object -Unique)
    foreach ($ownerId in $owners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId"
        if ($owner.Name -ne 'ssh.exe' -or $owner.CommandLine -notlike "*ecs-assist-user@$ServerAddress*") {
            throw "Local port $LocalPort is occupied by another application."
        }
    }
    Write-Host "Tunnel already running: http://127.0.0.1:$LocalPort"
    exit 0
}
$accessDirectory = Join-Path $projectDirectory '.artifacts\cloud-access'
New-Item -ItemType Directory -Path $accessDirectory -Force | Out-Null
$arguments = @(
    '-N', '-T', '-i', "`"$deployKey`"",
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', "`"UserKnownHostsFile=$knownHosts`"", '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-L', "127.0.0.1:${LocalPort}:127.0.0.1:8080", "ecs-assist-user@$ServerAddress"
)
$process = Start-Process -FilePath $sshExe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $accessDirectory 'ssh-tunnel.log')
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw "SSH tunnel failed. Inspect $accessDirectory\ssh-tunnel.log" }
    $ready = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue
    if ($ready) {
        Write-Host "Server operations platform: http://127.0.0.1:$LocalPort"
        Write-Host "Tunnel process: $($process.Id)"
        exit 0
    }
    Start-Sleep -Milliseconds 250
}
throw 'Tunnel startup timed out. Check the SSH log and the security group source IP.'
