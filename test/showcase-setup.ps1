#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/apply-issue-32-showcase.ps1')

function Assert($condition, $message) { if (-not $condition) { throw $message } }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('oclr-showcase-test-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $temp
$original = (Get-Location).Path
try {
    # Exercise the real native-process exit-code guard under Windows PowerShell.
    $failed = $false
    try { Invoke-CheckedCommand (Get-Command node.exe).Source @('-e', 'process.exit(17)') }
    catch { $failed = $_.Exception.Message -match 'exit 17' }
    Assert $failed 'Native nonzero exit was ignored'
    Invoke-CheckedCommand (Get-Command node.exe).Source @('-e', 'const [major, minor] = process.versions.node.split(String.fromCharCode(46)).map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1);')
    Invoke-CheckedCommand (Get-Command node.exe).Source @('-e', 'console.error(123); process.exit(0)')

    $sentinel = Join-Path $temp 'keep.txt'
    Set-Content -LiteralPath $sentinel -Value 'untouched'
    $failed = $false
    try { Invoke-ShowcaseSetup -Destination $temp } catch { $failed = $true }
    Assert $failed 'Existing destination accepted'
    Assert ((Get-Content -LiteralPath $sentinel) -eq 'untouched') 'Existing files changed'

    # Stub only external commands: run actual orchestration and directory logic.
    function Invoke-CheckedCommand {
        param([string]$Executable, [string[]]$Arguments)
        $key = if ($Arguments[0] -eq 'run') { $Arguments -join ' ' } elseif ($Arguments[0] -eq '-c') { 'fetch' } else { $Arguments[0] }
        $script:calls += $key
        if ($key -eq $script:failAt) { throw "Injected failure: $key" }
        if ($key -eq 'checkout') {
            foreach ($path in @('package-lock.json', 'ui/components/ShowcasePage.vue', 'server/showcase.js', 'server/obs/showcase.js')) {
                $parent = Split-Path $path
                if ($parent) { $null = New-Item -ItemType Directory -Path $parent -Force }
                Set-Content -LiteralPath $path -Value 'synthetic'
            }
        }
    }
    foreach ($step in @('-e', 'init', 'remote', 'fetch', 'checkout', 'ci', 'run check', 'run build', 'test', 'none')) {
        $script:failAt = $step
        $script:calls = @()
        $failed = $false
        try { Invoke-ShowcaseSetup -Destination (Join-Path $temp ([guid]::NewGuid().ToString())) }
        catch { $failed = $true }
        Assert ((Get-Location).Path -eq $original) "Location leaked after $step"
        if ($step -ne 'none') {
            Assert $failed "Failure was ignored: $step"
            Assert ($script:calls[-1] -eq $step) "Commands continued after $step"
        } else {
            Assert (-not $failed) 'Successful setup failed'
            Assert (($script:calls -join ',') -eq '-e,init,remote,fetch,checkout,ci,run check,run build,test') 'Wrong verification sequence'
        }
    }
    Push-Location -LiteralPath $temp
    try {
        Invoke-ShowcaseSetup -Destination 'relative folder'
        Assert (Test-Path -LiteralPath (Join-Path $temp 'relative folder/package-lock.json')) 'Relative destination did not follow PowerShell location'
    } finally { Pop-Location }
    Write-Host 'Showcase setup safety tests passed.'
} finally {
    Set-Location -LiteralPath $original
    # Only this test's freshly allocated UUID directory is removed.
    $resolved = [IO.Path]::GetFullPath($temp)
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\oclr-showcase-test-'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
