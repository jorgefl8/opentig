param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Application,
  [Parameter(Mandatory=$true)][string]$Publisher
)
$ErrorActionPreference = 'Stop'
foreach ($target in @($Installer, $Application)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $target
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
    throw "Invalid Authenticode signature: $target"
  }
  $signer = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($signer -cne $Publisher) { throw "Unexpected signing publisher: $target" }
}
Write-Output 'WINDOWS_RELEASE_SIGNATURES_OK'
