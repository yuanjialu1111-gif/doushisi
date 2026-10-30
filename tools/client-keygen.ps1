param(
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [Parameter(Mandatory=$true)][string]$KeyStore,
  [Parameter(Mandatory=$true)][string]$CredentialFile
)
$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath $KeyStore) -or (Test-Path -LiteralPath $CredentialFile)) { throw 'Signing files already exist. Reuse them; do not generate a replacement identity.' }
$secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:DOUSHISI_KEYSTORE_PASSWORD = $secret
$credential = [PSCredential]::new('doushisi', (ConvertTo-SecureString $secret -AsPlainText -Force))
$credential | Export-Clixml -LiteralPath $CredentialFile
& (Join-Path $JavaHome 'bin/keytool.exe') -genkeypair -keystore $KeyStore -alias doushisi -keyalg RSA -keysize 3072 -validity 3650 -dname 'CN=Doushisi Development' -storepass:env DOUSHISI_KEYSTORE_PASSWORD -keypass:env DOUSHISI_KEYSTORE_PASSWORD
if ($LASTEXITCODE -ne 0) { throw 'Key generation failed' }
Write-Output 'Signing key created. Credential XML is protected for the current Windows account.'
