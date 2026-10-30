<#
.SYNOPSIS
  Sends one LocalAcceptance command to a standalone client through the
  instrumentation driver and returns the validated reply.
.DESCRIPTION
  The command is encoded as UTF-8 base64 and passed to
  net.doushisi.acceptance/.AcceptanceInstrumentation. The helper parses both
  the instrumentation output and DSS_ACCEPTANCE logcat, requires a matching
  id with a boolean ok field, and fails closed on timeout or missing output.
#>
param(
  [Parameter(Mandatory=$true)][string]$Adb,
  [Parameter(Mandatory=$true)][string]$Serial,
  [Parameter(Mandatory=$true)][string]$Command,
  [int]$TimeoutSeconds = 20,
  [string]$Package = 'net.doushisi.standalone',
  [string]$Receiver = 'net.doushisi.standalone.AcceptanceReceiver'
)

$ErrorActionPreference = 'Stop'

if ($TimeoutSeconds -lt 1) {
  throw 'INVALID_TIMEOUT: TimeoutSeconds must be at least 1.'
}

try {
  $parsed = $Command | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw "INVALID_COMMAND_JSON: Command must be a JSON object. $($_.Exception.Message)"
}

$id = [string]$parsed.id
$action = [string]$parsed.action
if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($action)) {
  throw 'INVALID_COMMAND: Command requires non-empty id and action.'
}

$adbCommand = Get-Command -Name $Adb -ErrorAction SilentlyContinue
if ($null -eq $adbCommand -and -not (Test-Path -LiteralPath $Adb)) {
  throw "ADB_NOT_FOUND: adb is not available at $Adb"
}
$adbPath = if ($null -ne $adbCommand -and $adbCommand.CommandType -eq 'Application') {
  $adbCommand.Source
} elseif (Test-Path -LiteralPath $Adb) {
  (Resolve-Path -LiteralPath $Adb).Path
} else {
  $Adb
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
$commandB64 = [Convert]::ToBase64String($utf8.GetBytes($Command))
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

function Get-RemainingMilliseconds {
  $remaining = [Math]::Floor(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
  if ($remaining -lt 1) { return 1 }
  return [int]$remaining
}

function Invoke-ProcessWithTimeout {
  param(
    [Parameter(Mandatory=$true)][string]$FileName,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][int]$TimeoutMilliseconds
  )

  $stdoutPath = [IO.Path]::GetTempFileName()
  $stderrPath = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $FileName -ArgumentList $Arguments -NoNewWindow -PassThru `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $timedOut = -not $process.WaitForExit($TimeoutMilliseconds)
    if ($timedOut) {
      try { $process.Kill() } catch { }
      # Bound the post-kill wait as well; a failed kill must not turn the
      # command timeout into an indefinite hang.
      try { [void]$process.WaitForExit(5000) } catch { }
    } else {
      $process.WaitForExit()
    }

    $stdout = if (Test-Path -LiteralPath $stdoutPath) {
      [IO.File]::ReadAllText($stdoutPath)
    } else {
      ''
    }
    $stderr = if (Test-Path -LiteralPath $stderrPath) {
      [IO.File]::ReadAllText($stderrPath)
    } else {
      ''
    }
    $exitCode = if ($timedOut) { $null } else { $process.ExitCode }
    return [pscustomobject]@{
      TimedOut = [bool]$timedOut
      ExitCode = $exitCode
      StdOut = $stdout
      StdErr = $stderr
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-JsonObjectsFromText {
  param([AllowNull()][string]$Text)

  $objects = [System.Collections.Generic.List[object]]::new()
  if ([string]::IsNullOrEmpty($Text)) { return @($objects) }

  $start = -1
  $depth = 0
  $inString = $false
  $escaped = $false
  for ($index = 0; $index -lt $Text.Length; $index++) {
    $character = $Text[$index]
    if ($inString) {
      if ($escaped) {
        $escaped = $false
        continue
      }
      if ($character -eq '\') {
        $escaped = $true
        continue
      }
      if ($character -eq '"') { $inString = $false }
      continue
    }

    if ($character -eq '"') {
      $inString = $true
      continue
    }
    if ($character -eq '{') {
      if ($depth -eq 0) { $start = $index }
      $depth++
      continue
    }
    if ($character -eq '}' -and $depth -gt 0) {
      $depth--
      if ($depth -eq 0 -and $start -ge 0) {
        $candidate = $Text.Substring($start, $index - $start + 1)
        try {
          $value = $candidate | ConvertFrom-Json -ErrorAction Stop
          if ($null -ne $value) { $objects.Add($value) }
        } catch {
          # Ignore unrelated braces and malformed output; a receipt is only
          # accepted after id/ok validation below.
        }
        $start = -1
      }
    }
  }
  return @($objects)
}

function Get-AcceptanceReceipt {
  param(
    [AllowNull()][object[]]$Payloads,
    [Parameter(Mandatory=$true)][string]$ExpectedId
  )

  $matching = @()
  foreach ($payload in @($Payloads)) {
    if ($null -eq $payload) { continue }
    $idProperty = $payload.PSObject.Properties['id']
    $okProperty = $payload.PSObject.Properties['ok']
    if ($null -eq $idProperty -or $null -eq $okProperty) { continue }
    if ([string]$idProperty.Value -ne $ExpectedId) { continue }
    $rawOk = $okProperty.Value
    if ($rawOk -is [bool]) {
      $candidateOk = [bool]$rawOk
    } elseif ($rawOk -is [string] -and $rawOk -match '^(?i:true|false)$') {
      $candidateOk = [bool]::Parse($rawOk.ToLowerInvariant())
    } else {
      throw "INVALID_ACCEPTANCE_RECEIPT: reply for '$ExpectedId' has a non-boolean ok field."
    }
    $matching += [pscustomobject]@{ Payload = $payload; Ok = $candidateOk }
  }

  if ($matching.Count -eq 0) { return $null }
  $distinctOk = @($matching | ForEach-Object { $_.Ok } | Sort-Object -Unique)
  if ($distinctOk.Count -gt 1) {
    throw "INVALID_ACCEPTANCE_RECEIPT: conflicting ok values were returned for '$ExpectedId'."
  }
  $matchedReceipt = $matching[-1]
  $receipt = $matchedReceipt.Payload
  $ok = [bool]$matchedReceipt.Ok

  $detail = $null
  $detailProperty = $receipt.PSObject.Properties['detail']
  $errorProperty = $receipt.PSObject.Properties['error']
  if ($null -ne $detailProperty) {
    $detail = $detailProperty.Value
  } elseif ($null -ne $errorProperty) {
    $detail = $errorProperty.Value
  }
  if ($detail -is [string] -and $detail.TrimStart().StartsWith('{')) {
    try { $detail = $detail | ConvertFrom-Json -ErrorAction Stop } catch { }
  }

  return [ordered]@{
    id = [string]$receipt.id
    ok = $ok
    detail = $detail
  }
}

$clearResult = Invoke-ProcessWithTimeout -FileName $adbPath `
  -Arguments @('-s', $Serial, 'logcat', '-c') -TimeoutMilliseconds (Get-RemainingMilliseconds)
if ($clearResult.TimedOut) {
  throw "LOGCAT_CLEAR_TIMEOUT: could not clear DSS_ACCEPTANCE logcat for '$id' within $TimeoutSeconds seconds."
}
if ($null -ne $clearResult.ExitCode -and $clearResult.ExitCode -ne 0) {
  throw "LOGCAT_CLEAR_FAILED: adb logcat -c exited with code $($clearResult.ExitCode). $($clearResult.StdErr.Trim())"
}

$instrumentArguments = @(
  '-s', $Serial, 'shell', 'am', 'instrument', '-w',
  '-e', 'commandB64', $commandB64,
  'net.doushisi.acceptance/.AcceptanceInstrumentation'
)
$instrumentResult = Invoke-ProcessWithTimeout -FileName $adbPath `
  -Arguments $instrumentArguments -TimeoutMilliseconds (Get-RemainingMilliseconds)
if ($instrumentResult.TimedOut) {
  throw "ACCEPTANCE_TIMEOUT: instrumentation for command '$id' did not finish within $TimeoutSeconds seconds."
}

$logcatResult = Invoke-ProcessWithTimeout -FileName $adbPath `
  -Arguments @('-s', $Serial, 'logcat', '-d', '-v', 'threadtime', '-s', 'DSS_ACCEPTANCE:V') `
  -TimeoutMilliseconds (Get-RemainingMilliseconds)
if ($logcatResult.TimedOut) {
  throw "LOGCAT_TIMEOUT: reading DSS_ACCEPTANCE logcat for '$id' timed out."
}

$payloads = [System.Collections.Generic.List[object]]::new()
foreach ($text in @($instrumentResult.StdOut, $instrumentResult.StdErr, $logcatResult.StdOut, $logcatResult.StdErr)) {
  foreach ($payload in @(Get-JsonObjectsFromText -Text $text)) {
    if ($null -ne $payload) { $payloads.Add($payload) }
  }
}

$receipt = Get-AcceptanceReceipt -Payloads @($payloads) -ExpectedId $id
if ($null -eq $receipt) {
  $exitCode = if ($null -eq $instrumentResult.ExitCode) { 'unknown' } else { $instrumentResult.ExitCode }
  $instrumentError = (($instrumentResult.StdErr + "`n" + $instrumentResult.StdOut).Trim())
  $logcatError = (($logcatResult.StdErr + "`n" + $logcatResult.StdOut).Trim())
  throw "NO_ACCEPTANCE_RECEIPT: no reply with id '$id' and ok was found; instrumentation exit code $exitCode. $instrumentError $logcatError"
}

# Keep the public parameter contract even though the instrumentation driver
# replaces the old broadcast receiver path.
$null = $Package
$null = $Receiver
return $receipt
