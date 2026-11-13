# Dongxin smart bath heater - ESP32 firmware build and flash helper
#
# Usage:  .\build-and-flash.ps1
# If script execution is blocked, first run:
#     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less .ps1 as ANSI (GBK on a
# Chinese Windows), so UTF-8 comments would be mangled and can break parsing.

[CmdletBinding()]
param(
    [ValidateSet("menu", "c3-target", "build", "build-flash", "flash-monitor", "flash", "monitor", "fullclean", "s3-target", "s3-build", "lichuang-build", "lichuang-build-flash", "lichuang-flash-monitor", "lichuang-flash", "lichuang-monitor", "lichuang-cloud-build", "lichuang-cloud-build-flash", "lichuang-cloud-monitor", "lichuang-provision-build", "lichuang-provision-build-flash")]
    [string]$Action = "menu",
    [string]$Port = ""
)

$ErrorActionPreference = "Stop"

# ---- ESP-IDF v5.3.2 install layout (offline installer, D:\Espressif) ----
$IdfToolsPath = "D:\Espressif"
$IdfPath      = "$IdfToolsPath\frameworks\esp-idf-v5.3.2"
$IdfPythonEnv = "$IdfToolsPath\python_env\idf5.3_py3.11_env"
$IdfPython    = "$IdfPythonEnv\Scripts\python.exe"
$IdfScript    = "$IdfPath\tools\idf.py"
$ComPort      = if ([string]::IsNullOrWhiteSpace($Port)) {
    if ($Action -like "lichuang-*") { "COM5" } else { "COM3" }
}
else {
    $Port
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Dongxin ESP32 firmware build / flash tool" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# ---- Pre-flight 1: ESP-IDF present ----
if (-not (Test-Path $IdfScript)) {
    Write-Host "[X] ESP-IDF not found" -ForegroundColor Red
    Write-Host "    expected: $IdfScript" -ForegroundColor Gray
    Write-Host "    Install ESP-IDF v5.3.2 with the offline installer first." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $IdfPython)) {
    Write-Host "[X] ESP-IDF python virtualenv not found" -ForegroundColor Red
    Write-Host "    expected: $IdfPython" -ForegroundColor Gray
    Write-Host "    Run: python idf_tools.py install-python-env" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] ESP-IDF v5.3.2 found" -ForegroundColor Green

# ---- Pre-flight 2: local Wi-Fi SSID configured ----
$config = Get-Content "main\app_config.h" -Raw -Encoding UTF8
if ($Action -notlike "lichuang-cloud-*" -and $Action -notlike "lichuang-provision-*" -and $config -match 'DX_WIFI_SSID\s+""') {
    Write-Host "[X] DX_WIFI_SSID is empty, edit main\app_config.h" -ForegroundColor Red
    exit 1
}
if ($Action -notlike "lichuang-cloud-*" -and $Action -notlike "lichuang-provision-*") {
    Write-Host "[OK] local Wi-Fi SSID configured" -ForegroundColor Green
}

# ---- Environment ----
# MSYSTEM must be cleared: idf_tools.py refuses to run under MSys/Mingw.
$env:MSYSTEM = $null
$env:IDF_PATH = $IdfPath
$env:IDF_TOOLS_PATH = $IdfToolsPath
$env:IDF_PYTHON_ENV_PATH = $IdfPythonEnv
$env:IDF_CCACHE_ENABLE = "1"
$env:CCACHE_DIR = "D:\workspace\.ccache"
$env:CCACHE_TEMPDIR = "D:\workspace\.ccache-tmp"
$env:IDF_COMPONENT_CACHE_PATH = "D:\workspace\.espressif-component-cache"
$env:IDF_SKIP_CHECK_SUBMODULES = "1"
$env:ESP_IDF_VERSION = "5.3"
$env:OPENOCD_SCRIPTS = "$IdfToolsPath\tools\openocd-esp32\v0.12.0-esp32-20241016\openocd-esp32\share\openocd\scripts"
$env:ESP_ROM_ELF_DIR = "$IdfToolsPath\tools\esp-rom-elfs\20240305\"

$toolPaths = @(
    "$IdfToolsPath\tools\idf-git\2.44.0\cmd"
    "$IdfToolsPath\tools\xtensa-esp-elf-gdb\14.2_20240403\xtensa-esp-elf-gdb\bin"
    "$IdfToolsPath\tools\riscv32-esp-elf-gdb\14.2_20240403\riscv32-esp-elf-gdb\bin"
    "$IdfToolsPath\tools\xtensa-esp-elf\esp-13.2.0_20240530\xtensa-esp-elf\bin"
    "$IdfToolsPath\tools\riscv32-esp-elf\esp-13.2.0_20240530\riscv32-esp-elf\bin"
    "$IdfToolsPath\tools\esp32ulp-elf\2.38_20240113\esp32ulp-elf\bin"
    "$IdfToolsPath\tools\cmake\3.30.2\bin"
    "$IdfToolsPath\tools\openocd-esp32\v0.12.0-esp32-20241016\openocd-esp32\bin"
    "$IdfToolsPath\tools\ninja\1.12.1"
    "$IdfToolsPath\tools\idf-exe\1.0.3"
    "$IdfToolsPath\tools\ccache\4.10.2\ccache-4.10.2-windows-x86_64"
    "$IdfToolsPath\tools\dfu-util\0.11\dfu-util-0.11-win64"
    "$IdfPythonEnv\Scripts"
    "$IdfPath\tools"
)
$env:PATH = ($toolPaths -join ";") + ";" + $env:PATH

if ($Action -eq "menu") {
    Write-Host ""
    Write-Host "Select an action:" -ForegroundColor Cyan
    Write-Host "  1 = set-target esp32c3   (run once before the first C3 build)"
    Write-Host "  2 = build"
    Write-Host "  3 = build + flash + monitor   (recommended)"
    Write-Host "  4 = flash only"
    Write-Host "  5 = monitor only"
    Write-Host "  6 = fullclean"
    Write-Host "  7 = set-target esp32s3   (switch the default build directory)"
    Write-Host "  8 = build esp32s3 in isolated build-s3-verify2 directory"
    Write-Host "  9 = build Lichuang C3 audio board"
    Write-Host " 10 = build + flash + monitor Lichuang board on COM5"
    Write-Host " 11 = flash Lichuang board on COM5"
    Write-Host " 12 = monitor Lichuang board on COM5"
    Write-Host " 13 = build + flash default C3 image (no monitor)"
    Write-Host " 14 = build + flash Lichuang image on COM5 (no monitor)"
    Write-Host " 15 = build cloud-pilot Lichuang image (no flash)"
    Write-Host " 16 = build + flash cloud-pilot Lichuang image on COM5"
    Write-Host " 17 = monitor cloud-pilot Lichuang board on COM5"
    Write-Host " 18 = build Lichuang Wi-Fi provisioning image (no flash)"
    Write-Host " 19 = build + flash Lichuang Wi-Fi provisioning image on COM5"
    Write-Host ""
    $choice = Read-Host "Enter 1-19"
    Write-Host ""
}
else {
    $actionChoices = @{
        "c3-target" = "1"
        "build" = "2"
        "build-flash" = "13"
        "flash-monitor" = "3"
        "flash" = "4"
        "monitor" = "5"
        "fullclean" = "6"
        "s3-target" = "7"
        "s3-build" = "8"
        "lichuang-build" = "9"
        "lichuang-build-flash" = "14"
        "lichuang-flash-monitor" = "10"
        "lichuang-flash" = "11"
        "lichuang-monitor" = "12"
        "lichuang-cloud-build" = "15"
        "lichuang-cloud-build-flash" = "16"
        "lichuang-cloud-monitor" = "17"
        "lichuang-provision-build" = "18"
        "lichuang-provision-build-flash" = "19"
    }
    $choice = $actionChoices[$Action]
}
if ([string]::IsNullOrWhiteSpace($Port) -and $choice -in @("10", "11", "12", "14", "16", "17", "19")) {
    $ComPort = "COM5"
}

$isProvisioningBuild = $choice -in @("18", "19")
$isCloudPilot = $choice -in @("15", "16", "17", "18", "19")
$cloudBuildDir = if ($isProvisioningBuild) { "build-lichuang-provision" } else { "build-lichuang-cloud-pilot" }
$cloudConfigDir = if ($isProvisioningBuild) { "build-lichuang-provision-config" } else { "build-lichuang-cloud-config" }
$cloudConfigFile = "$cloudConfigDir/sdkconfig"

function Get-PrivateDefine {
    param([string]$Source, [string]$Name, [switch]$AllowEmpty)
    $pattern = '(?m)^\s*#define\s+' + [regex]::Escape($Name) + '\s+"([^"\r\n]*)"\s*$'
    $match = [regex]::Match($Source, $pattern)
    if (-not $match.Success) {
        throw "Cloud pilot requires a quoted $Name in main/device_provisioning.h"
    }
    $value = $match.Groups[1].Value
    if (([string]::IsNullOrWhiteSpace($value) -and -not ($AllowEmpty -and $value -eq "")) -or
        $value -match '(?i)REPLACE|CHANGEME|PLACEHOLDER|dongxin-local') {
        throw "Cloud pilot $Name is empty or still a development placeholder"
    }
    return $value
}

function Assert-CloudPilotConfig {
    $privateHeader = Join-Path $PSScriptRoot "main/device_provisioning.h"
    if (-not (Test-Path -LiteralPath $privateHeader -PathType Leaf)) {
        throw "Cloud pilot requires private main/device_provisioning.h; copy the .example and provision this device"
    }
    $privateConfig = Get-Content -LiteralPath $privateHeader -Raw -Encoding UTF8
    $deviceId = Get-PrivateDefine $privateConfig "DX_DEVICE_ID"
    $model = Get-PrivateDefine $privateConfig "DX_DEVICE_MODEL"
    $wifiSsid = Get-PrivateDefine $privateConfig "DX_WIFI_SSID" -AllowEmpty:$isProvisioningBuild
    $wifiPassword = Get-PrivateDefine $privateConfig "DX_WIFI_PASSWORD" -AllowEmpty
    if ([Text.Encoding]::UTF8.GetByteCount($wifiSsid) -gt 32 -or
        ($wifiSsid -eq "" -and $wifiPassword -ne "") -or
        ($wifiSsid -ne "" -and $wifiPassword -eq "" -and $wifiSsid -ne "TP-LINK_3DB722")) {
        throw "Wi-Fi setup requires a valid SSID and password pair"
    }
    $gateway = Get-PrivateDefine $privateConfig "DX_GATEWAY_BASE_URL"
    $mqtt = Get-PrivateDefine $privateConfig "DX_MQTT_BROKER_URI"
    $mqttSecret = Get-PrivateDefine $privateConfig "DX_MQTT_DEVICE_SECRET"
    $httpSecret = Get-PrivateDefine $privateConfig "DX_DEVICE_HTTP_SECRET"
    if ($isProvisioningBuild) {
        $setupPassword = Get-PrivateDefine $privateConfig "DX_WIFI_SETUP_PASSWORD"
        if ($setupPassword.Length -lt 12 -or $setupPassword.Length -gt 63 -or
            $setupPassword -eq $mqttSecret -or $setupPassword -eq $httpSecret) {
            throw "Wi-Fi provisioning requires an independent 12-63 character setup password"
        }
    }
    if ($deviceId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$' -or
        $deviceId -eq "DX-C3-LICHUANG-AUDIO-001" -or
        $model -ne "DX-AI-BATH-C3-LICHUANG-AUDIO" -or
        $mqttSecret.Length -lt 24 -or $httpSecret.Length -lt 24 -or
        $mqttSecret -eq $httpSecret) {
        throw "Cloud pilot requires a valid device ID, Lichuang model and independent 24+ character device secrets"
    }
    [uri]$gatewayUri = $null
    [uri]$mqttUri = $null
    if (-not [uri]::TryCreate($gateway, [uriKind]::Absolute, [ref]$gatewayUri) -or
        $gatewayUri.Scheme -ne "https" -or $gatewayUri.Host -ne "api.zjdongxin.net" -or
        $gatewayUri.Port -ne 443 -or $gatewayUri.AbsolutePath -ne "/" -or
        $gatewayUri.Query -ne "" -or
        $gatewayUri.Fragment -ne "" -or $gatewayUri.UserInfo -ne "" -or
        $gateway.EndsWith("/")) {
        throw "Cloud pilot gateway must be https://api.zjdongxin.net"
    }
    if (-not [uri]::TryCreate($mqtt, [uriKind]::Absolute, [ref]$mqttUri) -or
        $mqttUri.Scheme -ne "mqtts" -or $mqttUri.Host -ne "api.zjdongxin.net" -or
        $mqttUri.Port -ne 8883 -or $mqttUri.AbsolutePath -ne "/" -or
        $mqttUri.Query -ne "" -or $mqttUri.Fragment -ne "" -or
        $mqttUri.UserInfo -ne "" -or $mqtt.EndsWith("/")) {
        throw "Cloud pilot MQTT broker must be mqtts://api.zjdongxin.net:8883"
    }

    $baseline = Get-Content "sdkconfig.lichuang" -Raw -Encoding UTF8
    if ($baseline -notmatch '(?m)^CONFIG_DX_BOARD_C3_LICHUANG_AUDIO=y\s*$' -or
        $baseline -notmatch '(?m)^CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y\s*$') {
        throw "Lichuang baseline must select the audio board and the TLS CA bundle"
    }
    $appConfig = Get-Content "main/app_config.h" -Raw -Encoding UTF8
    $stageDefinition = '(?s)#if defined\(CONFIG_DX_CLOUD_PILOT\) && CONFIG_DX_CLOUD_PILOT\s*#define DX_STM32_CONTROL_STAGE 0\s*#elif DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO\s*#define DX_STM32_CONTROL_STAGE 3'
    $stageGuard = '(?s)#if defined\(CONFIG_DX_CLOUD_PILOT\) && CONFIG_DX_CLOUD_PILOT && DX_STM32_CONTROL_STAGE != 0\s*#error "Cloud pilot must keep STM32 control receive-only"'
    if ($appConfig -notmatch $stageDefinition -or $appConfig -notmatch $stageGuard) {
        throw "Cloud pilot preflight requires STM32 stage 0 and a compile-time receive-only guard"
    }
    if (-not (Test-Path -LiteralPath $cloudConfigDir)) {
        New-Item -ItemType Directory -Path $cloudConfigDir | Out-Null
    }
    $cloudConfig = [regex]::Replace(
        $baseline,
        '(?m)^(?:# CONFIG_DX_CLOUD_PILOT is not set|CONFIG_DX_CLOUD_PILOT=y|# CONFIG_DX_WIFI_PROVISIONING is not set|CONFIG_DX_WIFI_PROVISIONING=y)\r?\n',
        ''
    ) + "`nCONFIG_DX_CLOUD_PILOT=y`n" +
        $(if ($isProvisioningBuild) { "CONFIG_DX_WIFI_PROVISIONING=y`n" }
          else { "# CONFIG_DX_WIFI_PROVISIONING is not set`n" })
    Set-Content -LiteralPath $cloudConfigFile -Value $cloudConfig -Encoding ASCII -NoNewline
    if ((Get-Content -LiteralPath $cloudConfigFile -Raw -Encoding ASCII) -notmatch
        '(?m)^CONFIG_DX_CLOUD_PILOT=y\s*$') {
        throw "Cloud pilot SDK configuration was not enabled"
    }
    Write-Host "[OK] cloud device: $deviceId ($model)" -ForegroundColor Green
    if ($isProvisioningBuild) {
        Write-Host "[OK] local Wi-Fi setup enabled; no preconfigured SSID required" -ForegroundColor Green
    }
    Write-Host "[OK] HTTPS target: $($gatewayUri.Host):443; MQTTS target: $($mqttUri.Host):$($mqttUri.Port)" -ForegroundColor Green
    Write-Host "[OK] STM32 control stage: 0 (receive-only); build rejects any cloud control stage above 0" -ForegroundColor Green
    Write-Host "[OK] device secrets and Wi-Fi password are not displayed" -ForegroundColor Green
}

function Assert-CloudBuildOutput {
    $generatedHeader = Join-Path $PSScriptRoot "$cloudBuildDir/config/sdkconfig.h"
    if (-not (Test-Path -LiteralPath $generatedHeader -PathType Leaf)) {
        throw "Cloud pilot build did not generate its SDK configuration header"
    }
    $generatedConfig = Get-Content -LiteralPath $generatedHeader -Raw -Encoding ASCII
    foreach ($requiredFlag in @(
        "CONFIG_DX_CLOUD_PILOT",
        "CONFIG_DX_BOARD_C3_LICHUANG_AUDIO",
        "CONFIG_MBEDTLS_CERTIFICATE_BUNDLE"
    )) {
        if ($generatedConfig -notmatch ("(?m)^#define " + $requiredFlag + " 1\r?$")) {
            throw "Cloud pilot build is missing required flag $requiredFlag"
        }
    }
    if ($isProvisioningBuild -and $generatedConfig -notmatch '(?m)^#define CONFIG_DX_WIFI_PROVISIONING 1\r?$') {
        throw "Wi-Fi provisioning build is missing CONFIG_DX_WIFI_PROVISIONING"
    }
    Write-Host "[OK] compiled cloud image: TLS CA bundle enabled; STM32 control stage 0 (receive-only)" -ForegroundColor Green
}

if ($isCloudPilot) {
    Assert-CloudPilotConfig
}

function Invoke-Idf {
    param([string[]]$IdfArgs)
    Write-Host ">> idf.py $($IdfArgs -join ' ')" -ForegroundColor DarkGray
    & $IdfPython $IdfScript @IdfArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[X] command failed, exit code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

if ($choice -in @("3", "4", "5", "10", "11", "12", "13", "14", "16", "17", "19")) {
    $availablePorts = @([System.IO.Ports.SerialPort]::GetPortNames())
    if ($availablePorts -notcontains $ComPort) {
        Write-Host "[X] serial port $ComPort is not available" -ForegroundColor Red
        if ($availablePorts.Count -gt 0) {
            Write-Host "    available: $($availablePorts -join ', ')" -ForegroundColor Yellow
        }
        else {
            Write-Host "    no serial ports detected; reconnect the board and retry" -ForegroundColor Yellow
        }
        exit 1
    }
}

if ($choice -eq "1") {
    Invoke-Idf @("set-target", "esp32c3")
}
elseif ($choice -eq "2") {
    Invoke-Idf @("build")
}
elseif ($choice -eq "3") {
    Invoke-Idf @("build")
    Invoke-Idf @("-p", $ComPort, "flash")
    Write-Host "Monitoring serial output, press Ctrl+] to exit" -ForegroundColor Yellow
    Invoke-Idf @("-p", $ComPort, "monitor")
}
elseif ($choice -eq "13") {
    Invoke-Idf @("build")
    Invoke-Idf @("-p", $ComPort, "flash")
}
elseif ($choice -eq "4") {
    Invoke-Idf @("-p", $ComPort, "flash")
}
elseif ($choice -eq "5") {
    Write-Host "Monitoring serial output, press Ctrl+] to exit" -ForegroundColor Yellow
    Invoke-Idf @("-p", $ComPort, "monitor")
}
elseif ($choice -eq "6") {
    Invoke-Idf @("fullclean")
}
elseif ($choice -eq "7") {
    Invoke-Idf @("set-target", "esp32s3")
}
elseif ($choice -eq "8") {
    Invoke-Idf @("-B", "build-s3-verify2", "-D", "SDKCONFIG=sdkconfig.s3", "build")
}
elseif ($choice -eq "9") {
    Invoke-Idf @("-B", "build-lichuang", "-D", "SDKCONFIG=sdkconfig.lichuang", "build")
}
elseif ($choice -eq "10") {
    Invoke-Idf @("-B", "build-lichuang", "-D", "SDKCONFIG=sdkconfig.lichuang", "build")
    Invoke-Idf @("-B", "build-lichuang", "-p", $ComPort, "flash")
    Write-Host "Monitoring Lichuang audio firmware, press Ctrl+] to exit" -ForegroundColor Yellow
    Invoke-Idf @("-B", "build-lichuang", "-p", $ComPort, "monitor")
}
elseif ($choice -eq "14") {
    Invoke-Idf @("-B", "build-lichuang", "-D", "SDKCONFIG=sdkconfig.lichuang", "build")
    Invoke-Idf @("-B", "build-lichuang", "-p", $ComPort, "flash")
}
elseif ($choice -eq "11") {
    Invoke-Idf @("-B", "build-lichuang", "-p", $ComPort, "flash")
}
elseif ($choice -eq "12") {
    Write-Host "Monitoring Lichuang audio firmware, press Ctrl+] to exit" -ForegroundColor Yellow
    Invoke-Idf @("-B", "build-lichuang", "-p", $ComPort, "monitor")
}
elseif ($choice -eq "15") {
    Invoke-Idf @("-B", $cloudBuildDir, "-D", "SDKCONFIG=$cloudConfigFile", "build")
    Assert-CloudBuildOutput
}
elseif ($choice -eq "16") {
    Invoke-Idf @("-B", $cloudBuildDir, "-D", "SDKCONFIG=$cloudConfigFile", "build")
    Assert-CloudBuildOutput
    Invoke-Idf @("-B", $cloudBuildDir, "-p", $ComPort, "flash")
}
elseif ($choice -eq "17") {
    Write-Host "Monitoring cloud-pilot Lichuang audio firmware, press Ctrl+] to exit" -ForegroundColor Yellow
    Invoke-Idf @("-B", $cloudBuildDir, "-p", $ComPort, "monitor")
}
elseif ($choice -eq "18") {
    Invoke-Idf @("-B", $cloudBuildDir, "-D", "SDKCONFIG=$cloudConfigFile", "build")
    Assert-CloudBuildOutput
}
elseif ($choice -eq "19") {
    Invoke-Idf @("-B", $cloudBuildDir, "-D", "SDKCONFIG=$cloudConfigFile", "build")
    Assert-CloudBuildOutput
    Invoke-Idf @("-B", $cloudBuildDir, "-p", $ComPort, "flash")
}
else {
    Write-Host "[X] invalid choice: $choice" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] done" -ForegroundColor Green
Write-Host ""
