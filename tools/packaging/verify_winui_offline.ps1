param(
    [Parameter(Mandatory)] [string] $Packages,
    [Parameter(Mandatory)] [string] $Report
)

$ErrorActionPreference = 'Stop'
$baseline = Join-Path $Packages 'OCLR-Windows-x64'
$prototype = Join-Path $Packages 'OCLR-WinUI-Prototype-Windows-x64'
$group = 'OCLR-Offline-Fixture-' + [guid]::NewGuid()
$profiles = @(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $false } | Select-Object -ExpandProperty Name)
$external = @('0.0.0.1-126.255.255.255', '128.0.0.0-255.255.255.254', '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe')

try {
    if ($profiles.Count) { Set-NetFirewallProfile -Name $profiles -Enabled True }
    foreach ($exe in @(
        (Join-Path $baseline 'OCLR.exe'), (Join-Path $baseline 'runtime/node.exe'),
        (Join-Path $prototype 'OCLR.exe'), (Join-Path $prototype 'OCLR-core.exe'),
        (Join-Path $prototype 'runtime/node.exe')
    )) {
        $program = (Resolve-Path -LiteralPath $exe).Path
        New-NetFirewallRule -DisplayName $group -Group $group -Direction Outbound -Action Block -Profile Any -Program $program -RemoteAddress $external | Out-Null
    }
    # Verify non-loopback connections from the exact bundled runtime fail.
    $canary = "const s=require('node:net').connect(443,'1.1.1.1'); s.on('connect',()=>process.exit(1)); s.on('error',()=>process.exit(0)); s.setTimeout(2000,()=>process.exit(0));"
    & (Join-Path $prototype 'runtime/node.exe') -e $canary
    if ($LASTEXITCODE -ne 0) { throw 'Outbound isolation check failed.' }
    node "$PSScriptRoot/verify_winui.mjs" $baseline $prototype $Report
    if ($LASTEXITCODE -ne 0) { throw 'WinUI portable verification failed.' }
    $result = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
    $result.verification | Add-Member -NotePropertyName offlineProcesses -NotePropertyValue $true
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
} finally {
    Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if ($profiles.Count) { Set-NetFirewallProfile -Name $profiles -Enabled False }
}
