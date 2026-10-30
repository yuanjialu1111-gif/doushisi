<#
.SYNOPSIS
  Compatibility wrapper for the former acceptance-only APK build entrypoint.

.DESCRIPTION
  The release build script is now the single implementation. It reads the
  signing password from a protected Windows credential file instead of a
  plaintext environment variable and verifies the certificate plus v2/v3/v4
  signatures before publishing the APK.
#>
param(
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [Parameter(Mandatory=$true)][string]$ApktoolJar,
  [Parameter(Mandatory=$true)][string]$BuildTools,
  [Parameter(Mandatory=$true)][string]$KeyStore,
  [string]$ApiBase,
  [string]$KeyAlias = 'doushisi',
  [string]$DecodedRoot,
  [string]$OutputApk,
  [string]$OutputIdsig,
  [string]$CredentialFile,
  [string]$ExpectedCertificateSha256,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'

$releaseBuild = Join-Path $PSScriptRoot 'client-native-release-build.ps1'
if (!(Test-Path -LiteralPath $releaseBuild -PathType Leaf)) {
  throw "RELEASE_BUILD_SCRIPT_MISSING: $releaseBuild"
}

$arguments = @('-NoProfile', '-File', $releaseBuild)
foreach ($name in @(
    'ApiBase', 'DecodedRoot', 'OutputApk', 'OutputIdsig', 'JavaHome',
    'ApktoolJar', 'BuildTools', 'KeyStore', 'CredentialFile', 'KeyAlias',
    'ExpectedCertificateSha256', 'ReportPath')) {
  if ($PSBoundParameters.ContainsKey($name) -and
      ![string]::IsNullOrWhiteSpace([string]$PSBoundParameters[$name])) {
    $arguments += '-' + $name
    $arguments += [string]$PSBoundParameters[$name]
  }
}

& pwsh @arguments
if ($LASTEXITCODE -ne 0) {
  throw "ACCEPTANCE_APK_BUILD_FAILED: client-native-release-build.ps1 exited with $LASTEXITCODE."
}
