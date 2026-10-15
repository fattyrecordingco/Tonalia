param([Parameter(Mandatory=$true)][int]$ApplicationPid, [Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TonaliaDialogFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$deadline=(Get-Date).AddSeconds(25)
$pidCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$ApplicationPid)
while((Get-Date) -lt $deadline){
  $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$pidCondition)
  foreach($window in $windows){
    if($window.Current.ClassName -ne '#32770'){continue}
    $editCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
    $edits=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editCondition)
    $field=$edits | Where-Object{$_.Current.Name -like 'File name*' -or $_.Current.AutomationId -eq '1001'} | Select-Object -First 1
    if($null -eq $field){
      $handle=[IntPtr]$window.Current.NativeWindowHandle
      [TonaliaDialogFocus]::SetForegroundWindow($handle) > $null
      Start-Sleep -Milliseconds 200
      if([TonaliaDialogFocus]::GetForegroundWindow() -ne $handle){continue}
      $literal=$FilePath -replace '([+^%~(){}\[\]])','{$1}'
      [System.Windows.Forms.SendKeys]::SendWait('%n')
      [System.Windows.Forms.SendKeys]::SendWait($literal)
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      Write-Output 'Native file dialog completed with its File name keyboard shortcut.'
      exit 0
    }
    $value=$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($FilePath)
    $acceptCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1')
    $accept=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$acceptCondition)
    if($null -eq $accept){throw 'The native dialog has no Open/Save button.'}
    $invoke=$accept.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    Write-Output 'Native file dialog completed using its File name field and Open/Save button.'
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
$windows | Where-Object{$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit} | ForEach-Object{$_.Current | Select-Object Name,ClassName,AutomationId | ConvertTo-Json -Compress | Write-Output}
throw 'No matching native file dialog appeared for this test application.'
