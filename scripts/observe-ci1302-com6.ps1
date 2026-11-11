param(
    [ValidatePattern('^COM[1-9][0-9]*$')][string]$Port = 'COM6',
    [ValidateRange(1, 300)][int]$Seconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$device = Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.Name -like "*($Port)*" -and $_.DeviceID -like 'USB\VID_1A86&PID_7523*' } |
    Select-Object -First 1
if ($null -eq $device) {
    throw "$Port is not the expected CI development board CH340. Check Device Manager before opening a port."
}

$serial = [System.IO.Ports.SerialPort]::new(
    $Port, 921600, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One
)
$serial.Handshake = [System.IO.Ports.Handshake]::None
$serial.DtrEnable = $false
$serial.RtsEnable = $false
$serial.ReadTimeout = 200
$buffer = New-Object byte[] 128
$totalBytes = 0

try {
    $serial.Open()
    "Opened $Port for receive-only UART0 logging at 921600/8N1; DTR and RTS disabled."
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $count = $serial.Read($buffer, 0, $buffer.Length)
        } catch [System.TimeoutException] {
            continue
        }
        if ($count -eq 0) { continue }

        $totalBytes += $count
        $hex = [BitConverter]::ToString($buffer, 0, $count).Replace('-', ' ')
        $ascii = [Text.Encoding]::ASCII.GetString($buffer, 0, $count)
        $ascii = [regex]::Replace($ascii, '[^\x20-\x7E]', '.')
        '{0:o} bytes={1} hex={2} ascii={3}' -f [DateTimeOffset]::Now, $count, $hex, $ascii
    }
    "Total received: $totalBytes byte(s). No serial data was transmitted."
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
    "Closed $Port."
}
