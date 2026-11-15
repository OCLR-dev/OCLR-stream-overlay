#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $PWD 'OCLR-showcase-verified')
)

# The standalone Showcase is already upstream. Do not reapply the obsolete
# overlay-scene string replacements or reset/push an existing branch.
function Invoke-CheckedCommand {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit $LASTEXITCODE): $Executable $($Arguments -join ' ')"
    }
}

function Invoke-ShowcaseSetup {
    param([string]$Destination)
    $ErrorActionPreference = 'Stop'
    if (-not [IO.Path]::IsPathRooted($Destination)) { $Destination = Join-Path $PWD $Destination }
    $target = [IO.Path]::GetFullPath($Destination)
    if (Test-Path -LiteralPath $target) {
        throw "Destination already exists; choose a new directory: $target"
    }
    $git = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Invoke-CheckedCommand $node @('-e', 'const [major, minor] = process.versions.node.split(String.fromCharCode(46)).map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1);')

    # Pin the implementation validated with this script, not an evolving main.
    $revision = 'f668ec3262ffdbefb6c879e0c3ebe8e42ae52bbb'
    # New-Item without -Force also refuses a directory created after preflight.
    $null = New-Item -ItemType Directory -Path $target
    Push-Location -LiteralPath $target
    try {
        Invoke-CheckedCommand $git @('init')
        Invoke-CheckedCommand $git @('remote', 'add', 'origin', 'https://github.com/OCLR-dev/OCLR-stream-overlay.git')
        Invoke-CheckedCommand $git @('-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=60', 'fetch', '--depth=1', 'origin', $revision)
        Invoke-CheckedCommand $git @('checkout', '--detach', $revision)
        foreach ($path in @('package-lock.json', 'ui/components/ShowcasePage.vue', 'server/showcase.js', 'server/obs/showcase.js')) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing Showcase source: $path" }
        }
        Invoke-CheckedCommand $npm @('ci')
        Invoke-CheckedCommand $npm @('run', 'check')
        Invoke-CheckedCommand $npm @('run', 'build')
        # Portable lifecycle tests exercise the generated dist directory.
        Invoke-CheckedCommand $npm @('test')
        Write-Host "Showcase verified in $target"
        Write-Host 'Run npm start there, then open http://localhost:3001/showcase.'
        Write-Host 'OBS browser source: http://localhost:3001/showcase?clean=1'
    } catch {
        Write-Warning "Setup stopped. The new directory is retained for diagnosis: $target"
        throw
    } finally {
        Pop-Location
    }
}

# Dot sourcing exposes helpers to the failure-injection tests without executing.
if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-ShowcaseSetup -Destination $Destination }
    catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
