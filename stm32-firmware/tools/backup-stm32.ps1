[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('SAMPLE_COLD_LOADS_OFF')]
    [string]$SafetyConfirmation,
    [string]$JLinkPath = 'D:\SEGGER\JLink_V986\JLink_V986\JLink.exe',
    [string]$JLinkSerial = '69406456',
    [string]$Device = 'STM32F103C8',
    [ValidateRange(100, 4000)]
    [int]$SwdSpeedKhz = 1000
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $projectRoot 'device-backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputDirectory = Join-Path $backupRoot $timestamp
$flashPath = Join-Path $outputDirectory 'stm32-flash-08000000-64k.bin'
$optionBytesPath = Join-Path $outputDirectory 'stm32-option-bytes-1ffff800-16b.bin'
$uidPath = Join-Path $outputDirectory 'stm32-uid-1ffff7e8-12b.bin'
$commandPath = Join-Path $outputDirectory 'backup.jlink'
$logPath = Join-Path $outputDirectory 'jlink-backup.log'
$manifestPath = Join-Path $outputDirectory 'manifest.json'

if (-not (Test-Path -LiteralPath $JLinkPath -PathType Leaf)) {
    throw "J-Link Commander not found: $JLinkPath"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$jlinkCommands = @(
    "device $Device",
    'if SWD',
    "speed $SwdSpeedKhz",
    'connect',
    'halt',
    "savebin $flashPath, 0x08000000, 0x10000",
    "savebin $optionBytesPath, 0x1FFFF800, 0x10",
    "savebin $uidPath, 0x1FFFF7E8, 0x0C",
    'r',
    'g',
    'exit'
)
Set-Content -LiteralPath $commandPath -Value $jlinkCommands -Encoding ascii

& $JLinkPath -NoGui 1 -ExitOnError 1 -SelectEmuBySN $JLinkSerial -CommandFile $commandPath 2>&1 |
    Tee-Object -FilePath $logPath
if ($LASTEXITCODE -ne 0) {
    throw "J-Link backup failed with exit code $LASTEXITCODE. See $logPath"
}
if (-not (Test-Path -LiteralPath $flashPath -PathType Leaf)) {
    throw "J-Link did not create the Flash backup. See $logPath"
}
$flashFile = Get-Item -LiteralPath $flashPath
if ($flashFile.Length -ne 0x10000) {
    throw "Unexpected Flash backup size: $($flashFile.Length), expected 65536 bytes."
}
$optionBytesFile = Get-Item -LiteralPath $optionBytesPath
if ($optionBytesFile.Length -ne 0x10) {
    throw "Unexpected Option Bytes backup size: $($optionBytesFile.Length), expected 16 bytes."
}
$uidFile = Get-Item -LiteralPath $uidPath
if ($uidFile.Length -ne 0x0C) {
    throw "Unexpected UID backup size: $($uidFile.Length), expected 12 bytes."
}

$manifest = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    device = $Device
    interface = 'SWD'
    speedKhz = $SwdSpeedKhz
    jlinkSerial = $JLinkSerial
    safetyConfirmation = $SafetyConfirmation
    files = @(
        [ordered]@{
            name = Split-Path -Leaf $flashPath
            address = '0x08000000'
            length = $flashFile.Length
            sha256 = (Get-FileHash -LiteralPath $flashPath -Algorithm SHA256).Hash
        },
        [ordered]@{
            name = Split-Path -Leaf $optionBytesPath
            address = '0x1FFFF800'
            length = $optionBytesFile.Length
            sha256 = (Get-FileHash -LiteralPath $optionBytesPath -Algorithm SHA256).Hash
        },
        [ordered]@{
            name = Split-Path -Leaf $uidPath
            address = '0x1FFFF7E8'
            length = $uidFile.Length
            sha256 = (Get-FileHash -LiteralPath $uidPath -Algorithm SHA256).Hash
        }
    )
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "STM32 backup completed: $outputDirectory"
Write-Host "Flash SHA-256: $($manifest.files[0].sha256)"
