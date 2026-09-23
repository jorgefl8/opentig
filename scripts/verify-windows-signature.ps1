param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Application,
  [string]$Publisher,
  [switch]$Unsigned
)
$ErrorActionPreference = 'Stop'
foreach ($target in @($Installer, $Application)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $target
  if ($Unsigned) {
    if ($signature.Status -ne 'NotSigned') { throw "Expected an unsigned binary: $target" }
    continue
  }
  if (-not $Publisher) { throw 'Publisher is required for signed verification.' }
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
    throw "Invalid Authenticode signature: $target"
  }
  $signer = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($signer -cne $Publisher) { throw "Unexpected signing publisher: $target" }
}
if ($Unsigned) { Write-Output 'WINDOWS_RELEASE_UNSIGNED_OK' }
else { Write-Output 'WINDOWS_RELEASE_SIGNATURES_OK' }
