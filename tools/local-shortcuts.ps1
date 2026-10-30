$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$shellApp = New-Object -ComObject WScript.Shell
$powershell = (Get-Command powershell.exe).Source
foreach ($entry in @(
    @{name='Start game server';action='start'},
    @{name='Stop game server';action='stop'},
    @{name='Server status';action='status'},
    @{name='Backup game data';action='backup'},
    @{name='Restore game data';action='restore'})) {
  $link = $shellApp.CreateShortcut((Join-Path $root ($entry.name + '.lnk')))
  $link.TargetPath = $powershell
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'local-run.ps1') + '" -Action ' + $entry.action
  if ($entry.action -eq 'restore') {
    $arguments += ' -Archive "$([Environment]::GetFolderPath(''Desktop''))\doushisi-backup.tgz"'
  }
  $link.Arguments = $arguments
  $link.WorkingDirectory = $root
  $link.WindowStyle = 7
  $link.Save()
}
