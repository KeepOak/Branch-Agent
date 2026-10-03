# Points the "Branch Agent" shortcuts on the Desktop and in the Start menu at the given packaged exe.
# Replaces a shortcut of the same name only when it points at an earlier build of this app (under BranchApp\dist);
# any other shortcut of that name (for example the old app's) is left alone.
param([Parameter(Mandatory = $true)][string]$Exe)
$ours = "C:\Users\you\BranchApp\dist\"
if (-not (Test-Path $Exe)) { throw "no exe at $Exe" }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $path = Join-Path $dir "Branch Agent.lnk"
  if (Test-Path $path) {
    $target = $shell.CreateShortcut($path).TargetPath
    if (-not $target.StartsWith($ours, [StringComparison]::OrdinalIgnoreCase)) {
      Write-Output "skipped (points elsewhere): $path"
      continue
    }
  }
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $Exe
  $lnk.WorkingDirectory = Split-Path $Exe
  $lnk.IconLocation = "$Exe,0"
  $lnk.Description = "Branch Agent"
  $lnk.Save()
  Write-Output "points at the new build: $path"
}
