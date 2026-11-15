param(
    [Parameter(Mandatory)] [string] $Baseline,
    [Parameter(Mandatory)] [string] $Windigo,
    [Parameter(Mandatory)] [string] $Report
)

$ErrorActionPreference = 'Stop'
$group = 'OCLR-Launcher-Comparison-' + [guid]::NewGuid()
$disabledProfiles = @(Get-NetFirewallProfile | Where-Object { !$_.Enabled } | Select-Object -ExpandProperty Name)
$external = @(
    '0.0.0.1-126.255.255.255',
    '128.0.0.0-255.255.255.254',
    '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe'
)
$node = Join-Path $Windigo 'runtime/node.exe'
$canary = "const s=require('node:net').connect(443,'1.1.1.1'); s.on('connect',()=>process.exit(0)); s.on('error',()=>process.exit(1)); s.setTimeout(3000,()=>process.exit(1));"
& $node -e $canary
if ($LASTEXITCODE -ne 0) { throw 'The outbound canary must be reachable before isolation' }

try {
    if ($disabledProfiles.Count) { Set-NetFirewallProfile -Name $disabledProfiles -Enabled True }
    foreach ($package in @($Baseline, $Windigo)) {
        foreach ($exe in @('OCLR.exe', 'runtime/node.exe')) {
            $program = (Resolve-Path -LiteralPath (Join-Path $package $exe)).Path
            New-NetFirewallRule -DisplayName $group -Group $group -Direction Outbound -Action Block -Profile Any -Program $program -RemoteAddress $external | Out-Null
        }
        & (Join-Path $package 'runtime/node.exe') -e $canary
        if ($LASTEXITCODE -ne 1) { throw "Outbound isolation check failed for $package" }
    }
    & $node "$PSScriptRoot/compare_windows_launchers.mjs" $Baseline $Windigo $Report
    if ($LASTEXITCODE -ne 0) { throw 'Extracted Windows launcher comparison failed' }
    $result = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
    $result.verification | Add-Member -NotePropertyName outboundBlocked -NotePropertyValue $true
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
} finally {
    Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if ($disabledProfiles.Count) { Set-NetFirewallProfile -Name $disabledProfiles -Enabled False }
}
