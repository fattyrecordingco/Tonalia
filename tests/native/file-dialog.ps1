param([Parameter(Mandatory=$true)][int]$ApplicationPid, [Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TonaliaFileDialog {
  public delegate bool EnumWindow(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumWindow cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string text);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Class(IntPtr h) { var s=new StringBuilder(256); GetClassName(h,s,256);return s.ToString(); }
  public static IntPtr[] Dialogs(int pid) {
    var result=new List<IntPtr>();
    EnumWindows((h,l)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==(uint)pid&&Class(h)=="#32770"&&IsWindowVisible(h))result.Add(h);return true;},IntPtr.Zero);
    return result.ToArray();
  }
  public static bool EnterPath(IntPtr dialog,string path) {
    var candidates=new List<IntPtr>();
    EnumChildWindows(dialog,(h,l)=>{if(Class(h)=="Edit"&&IsWindowVisible(h))candidates.Add(h);return true;},IntPtr.Zero);
    IntPtr field=IntPtr.Zero;
    foreach(var h in candidates)if(GetDlgCtrlID(GetParent(h))==1148){field=h;break;}
    if(field==IntPtr.Zero)foreach(var h in candidates)if(GetDlgCtrlID(h)==1001){field=h;break;}
    if(field==IntPtr.Zero&&candidates.Count==1)field=candidates[0];
    if(field==IntPtr.Zero)return false;
    // Character edits notify the modern IFileDialog filename model; WM_SETTEXT can leave its cached value unchanged.
    SendMessage(field,0x00B1,IntPtr.Zero,new IntPtr(-1)); // EM_SETSEL: select existing filename.
    SendMessage(field,0x0102,new IntPtr(8),IntPtr.Zero); // WM_CHAR: Backspace.
    foreach(char c in path) SendMessage(field,0x0102,new IntPtr(c),IntPtr.Zero);
    var accept=GetDlgItem(dialog,1);
    if(accept==IntPtr.Zero)return false;
    SendMessage(accept,0x00F5,IntPtr.Zero,IntPtr.Zero); // BM_CLICK: real Open/Save button.
    return true;
  }
}
'@
$deadline=(Get-Date).AddSeconds(25)
while((Get-Date) -lt $deadline){
 foreach($handle in [TonaliaFileDialog]::Dialogs($ApplicationPid)){
  if([TonaliaFileDialog]::EnterPath($handle,$FilePath)){
   for($attempt=0;$attempt -lt 100;$attempt++){
    Start-Sleep -Milliseconds 100
    if(-not [TonaliaFileDialog]::IsWindowVisible($handle)){
     Write-Output 'Native file dialog completed through its File name control and Open/Save button.'
     exit 0
    }
   }
   throw 'The native file dialog did not close after its Open/Save button was clicked.'
  }
 }
 Start-Sleep -Milliseconds 150
}
throw 'No visible native File name control was found for the test application.'
