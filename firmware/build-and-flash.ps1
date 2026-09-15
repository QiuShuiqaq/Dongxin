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
    [ValidateSet("menu", "c3-target", "build", "flash-monitor", "flash", "monitor", "fullclean", "s3-target", "s3-build")]
    [string]$Action = "menu",
    [string]$Port = "COM3"
)

$ErrorActionPreference = "Stop"

# ---- ESP-IDF v5.3.2 install layout (offline installer, D:\Espressif) ----
$IdfToolsPath = "D:\Espressif"
$IdfPath      = "$IdfToolsPath\frameworks\esp-idf-v5.3.2"
$IdfPythonEnv = "$IdfToolsPath\python_env\idf5.3_py3.11_env"
$IdfPython    = "$IdfPythonEnv\Scripts\python.exe"
$IdfScript    = "$IdfPath\tools\idf.py"
$ComPort      = $Port

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

# ---- Pre-flight 2: Wi-Fi SSID configured ----
$config = Get-Content "main\app_config.h" -Raw -Encoding UTF8
if ($config -match 'DX_WIFI_SSID\s+""') {
    Write-Host "[X] DX_WIFI_SSID is empty, edit main\app_config.h" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Wi-Fi SSID configured" -ForegroundColor Green

# ---- Environment ----
# MSYSTEM must be cleared: idf_tools.py refuses to run under MSys/Mingw.
$env:MSYSTEM = $null
$env:IDF_PATH = $IdfPath
$env:IDF_TOOLS_PATH = $IdfToolsPath
$env:IDF_PYTHON_ENV_PATH = $IdfPythonEnv
$env:IDF_CCACHE_ENABLE = "1"
$env:CCACHE_DIR = "D:\workspace\.ccache"
$env:CCACHE_TEMPDIR = "D:\workspace\.ccache-tmp"
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
    Write-Host ""
    $choice = Read-Host "Enter 1-8"
    Write-Host ""
}
else {
    $actionChoices = @{
        "c3-target" = "1"
        "build" = "2"
        "flash-monitor" = "3"
        "flash" = "4"
        "monitor" = "5"
        "fullclean" = "6"
        "s3-target" = "7"
        "s3-build" = "8"
    }
    $choice = $actionChoices[$Action]
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

if ($choice -in @("3", "4", "5")) {
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
else {
    Write-Host "[X] invalid choice: $choice" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] done" -ForegroundColor Green
Write-Host ""
