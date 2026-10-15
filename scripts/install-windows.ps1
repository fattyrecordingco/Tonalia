param([Parameter(Mandatory=$true)][string]$InstallerPath, [string]$ReportPath='', [int]$ApplicationPid=0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TonaliaInstallerButton {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
if($ApplicationPid){
  $setup=Get-Process -Id $ApplicationPid
  if($setup.Path -ne $InstallerPath){throw 'The supplied process is not this installer.'}
}else{$setup = Start-Process -FilePath $InstallerPath -PassThru}
$deadline = (Get-Date).AddMinutes(3)
$clicked = @()
while ((Get-Date) -lt $deadline) {
  $setup.Refresh()
  if ($setup.HasExited) { break }
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $setup.Id)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  foreach ($window in $windows) {
    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button')
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    foreach ($label in @('I &Agree','I Agree','&Next >','Next >','&Install','Install','&Finish','Finish')) {
      $button = $buttons | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen -and $_.Current.Name -eq $label } | Select-Object -First 1
      if ($null -ne $button) {
        try {
          $invoke=$null
          if($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){$invoke.Invoke()}
          else{[TonaliaInstallerButton]::PostMessage([IntPtr]$button.Current.NativeWindowHandle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) > $null}
          $clicked += $label
          Write-Output "Installer screen action: $label"
          Start-Sleep -Milliseconds 700
          break
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
      }
    }
  }
  Start-Sleep -Milliseconds 300
}
$setup.Refresh()
if (-not $setup.HasExited) { throw 'The interactive installer did not finish within three minutes.' }
if ($setup.ExitCode -ne 0) { throw "Installer exited with $($setup.ExitCode)" }
$installed = Join-Path $env:LOCALAPPDATA 'Tonalia\tonalia-desktop.exe'
if (-not (Test-Path $installed)) { throw 'The installed application is missing.' }
$result=[PSCustomObject]@{ Installed = $true; Executable = $installed.Replace($env:USERPROFILE,'%USERPROFILE%'); Installer = $InstallerPath.Replace($env:USERPROFILE,'%USERPROFILE%'); InstallerSha256 = (Get-FileHash -Algorithm SHA256 $InstallerPath).Hash.ToLower(); InteractiveActions = $clicked }
$json=$result | ConvertTo-Json -Depth 4
if($ReportPath){[System.IO.File]::WriteAllText($ReportPath,$json,[System.Text.UTF8Encoding]::new($false))}
Write-Output $json
