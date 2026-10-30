$errors = @()
foreach ($file in @('tools/package-local.ps1','tools/local-shortcuts.ps1','tools/local-run.ps1')) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) { $errors += "${file}: $($parseErrors.Message -join '; ')" }
}
if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }
Write-Output 'PowerShell syntax OK'
