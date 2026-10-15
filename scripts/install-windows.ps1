param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$setup = Start-Process -FilePath $InstallerPath -PassThru
$deadline = (Get-Date).AddMinutes(3)
$clicked = @()
while ((Get-Date) -lt $deadline) {
  $setup.Refresh()
  if ($setup.HasExited) { break }
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $setup.Id)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  foreach ($window in $windows) {
    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    foreach ($label in @('I &Agree','I Agree','&Next >','Next >','&Install','Install','&Finish','Finish')) {
      $button = $buttons | Where-Object { $_.Current.IsEnabled -and $_.Current.Name -eq $label } | Select-Object -First 1
      if ($null -ne $button) {
        try {
          $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $invoke.Invoke()
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
[PSCustomObject]@{ Installed = $true; Executable = $installed; Installer = $InstallerPath; InteractiveActions = $clicked } | ConvertTo-Json -Compress
