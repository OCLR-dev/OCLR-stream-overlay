param(
    [Parameter(Mandatory)] [int] $ProcessId,
    [Parameter(Mandatory)] [ValidateSet('VerifyAndRestart', 'Exit')] [string] $Action,
    [string] $Port,
    [string] $NewPort,
    [string] $TosuPath,
    [string] $OsuPath
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LauncherWindowApi
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetDlgItem(IntPtr parent, int id);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)]
    public static extern IntPtr GetText(IntPtr window, uint message, IntPtr capacity, StringBuilder text);
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)]
    public static extern IntPtr SetText(IntPtr window, uint message, IntPtr unused, string text);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint relationship);
}
'@

function Wait-For([scriptblock] $Check, [string] $Description) {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $value = & $Check
        if ($value) { return $value }
        Start-Sleep -Milliseconds 35
    } while ($deadline.Elapsed.TotalSeconds -lt 8)
    throw "Timed out waiting for $Description"
}

$process = Get-Process -Id $ProcessId
$window = Wait-For {
    $process.Refresh()
    $handle = $process.MainWindowHandle
    if ($handle -ne [IntPtr]::Zero -and [LauncherWindowApi]::IsWindowVisible($handle)) { $handle }
} 'visible OCLR window'

function Control([int] $Id) {
    $handle = [LauncherWindowApi]::GetDlgItem($window, $Id)
    if ($handle -eq [IntPtr]::Zero) { throw "Missing OCLR control $Id" }
    $handle
}

function Read-Text([IntPtr] $Handle) {
    $text = [Text.StringBuilder]::new(32768)
    [void][LauncherWindowApi]::GetText($Handle, 0x000D, [IntPtr] $text.Capacity, $text) # WM_GETTEXT
    $text.ToString()
}

function Click([IntPtr] $Handle) {
    if (![LauncherWindowApi]::PostMessage($Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { # BM_CLICK
        throw "Could not click OCLR control"
    }
}

function Confirm([string] $Title) {
    $dialog = Wait-For {
        $popup = [LauncherWindowApi]::GetWindow($window, 6) # GW_ENABLEDPOPUP, scoped to this test window
        if ($popup -ne [IntPtr]::Zero -and $popup -ne $window -and (Read-Text $popup) -ceq $Title) { $popup }
    } $Title
    Click ([LauncherWindowApi]::GetDlgItem($dialog, 6)) # IDYES
}

function Select-Page([int] $Tab, [int] $ExpectedControl) {
    Click (Control $Tab)
    $handle = Control $ExpectedControl
    $null = Wait-For { [LauncherWindowApi]::IsWindowVisible($handle) } "control $ExpectedControl on sidebar page $Tab"
}

if ($Action -eq 'VerifyAndRestart') {
    Select-Page 118 119 # About
    Select-Page 117 120 # Logs
    $log = Control 120
    $null = Wait-For { (Read-Text $log).Contains('backend ready') } 'Go service log in the launcher'
    Select-Page 115 121 # Overview
    if ((Read-Text (Control 121)) -cne "http://127.0.0.1:$Port/overlay") { throw 'Incorrect saved OBS address' }
    Select-Page 116 113 # Settings
    $portField = Control 113
    if ((Read-Text $portField) -cne $Port) { throw 'Saved service port was not loaded' }
    if ((Read-Text (Control 106)) -cne $TosuPath) { throw 'Saved tosu path was not loaded' }
    if ((Read-Text (Control 111)) -cne $OsuPath) { throw 'Saved osu! path was not loaded' }
    if ([LauncherWindowApi]::SetText($portField, 0x000C, [IntPtr]::Zero, $NewPort) -eq [IntPtr]::Zero) { # WM_SETTEXT
        throw 'Could not edit the restart port'
    }
    $restart = Control 112
    $null = Wait-For { [LauncherWindowApi]::IsWindowEnabled($restart) } 'enabled restart button'
    Click $restart
    Confirm '重新启动服务'
} else {
    Click (Control 103)
    Confirm '退出 OCLR'
}
