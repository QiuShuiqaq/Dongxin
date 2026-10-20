[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('SAMPLE_COLD_LOADS_OFF')]
    [string]$SafetyConfirmation,
    [Parameter(Mandatory = $true)]
    [string]$BackupManifest,
    [string]$JLinkPath = 'D:\SEGGER\JLink_V986\JLink_V986\JLink.exe',
    [string]$JLinkSerial = '69406456',
    [string]$Device = 'STM32F103C8',
    [ValidateRange(100, 4000)]
    [int]$SwdSpeedKhz = 1000
)

$ErrorActionPreference = 'Stop'
$requiredFiles = @($JLinkPath, $BackupManifest)
foreach ($path in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file not found: $path"
    }
}
$BackupManifest = (Resolve-Path -LiteralPath $BackupManifest).Path
$manifest = Get-Content -LiteralPath $BackupManifest -Raw | ConvertFrom-Json
if ($manifest.device -ne $Device -or $manifest.jlinkSerial -ne $JLinkSerial) {
    throw 'Backup manifest does not match the selected STM32 target and J-Link.'
}
$flashEntry = $manifest.files | Where-Object { $_.address -eq '0x08000000' } | Select-Object -First 1
if ($null -eq $flashEntry -or $flashEntry.length -ne 65536) {
    throw 'Backup manifest does not contain a complete 64 KiB STM32 Flash image.'
}
$backupPath = Join-Path (Split-Path -Parent $BackupManifest) $flashEntry.name
$backupFile = Get-Item -LiteralPath $backupPath -ErrorAction Stop
if ($backupFile.Length -ne 65536) {
    throw "Backup image has an unexpected size: $($backupFile.Length), expected 65536 bytes."
}
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
if ($backupHash -ne $flashEntry.sha256) {
    throw 'Backup image SHA-256 does not match its manifest.'
}

$commandPath = Join-Path (Split-Path -Parent $BackupManifest) 'restore.jlink'
$logPath = Join-Path (Split-Path -Parent $BackupManifest) 'jlink-restore.log'
$jlinkCommands = @(
    "device $Device",
    'if SWD',
    "speed $SwdSpeedKhz",
    'connect',
    'halt',
    "loadbin $backupPath, 0x08000000",
    'r',
    'g',
    'exit'
)
Set-Content -LiteralPath $commandPath -Value $jlinkCommands -Encoding ascii

& $JLinkPath -NoGui 1 -ExitOnError 1 -SelectEmuBySN $JLinkSerial -CommandFile $commandPath 2>&1 |
    Tee-Object -FilePath $logPath
if ($LASTEXITCODE -ne 0) {
    throw "J-Link restore failed with exit code $LASTEXITCODE. See $logPath"
}
$logText = Get-Content -LiteralPath $logPath -Raw
if ($logText -notmatch 'O\.K\.' -or $logText -match '(?im)^.*(Cannot connect|Failed to|Error:).*$') {
    throw "J-Link output did not prove a successful restore operation. See $logPath"
}

Write-Host "STM32 rollback completed from backup SHA-256: $backupHash"
