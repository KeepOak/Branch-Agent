# Branch Agent one-line installer for Windows.
#
#   irm https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.ps1 | iex
#
# A specific release: set $env:BRANCH_INSTALL_VERSION = 'v1.2.3' before the line above, or download the
# script and run: .\install.ps1 -Version v1.2.3
#
# It downloads the release's setup .exe and SHA256SUMS, checks the setup's SHA-256 with Get-FileHash, and
# runs the per-user silent install (no admin prompt). A mismatch stops before anything runs.
# Re-running installs the chosen release over the existing one.
#
# BRANCH_INSTALL_BASE_URL is for tests only. It points the script at a local fixture release instead of
# https://github.com/KeepOak/Branch-Agent/releases. Do not set it for a real install.
[CmdletBinding()]
param(
    [string]$Version = $env:BRANCH_INSTALL_VERSION
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Exit-Install([string]$Message) {
    throw "Branch Agent install failed: $Message"
}

$baseUrl = if ($env:BRANCH_INSTALL_BASE_URL) { $env:BRANCH_INSTALL_BASE_URL } else { 'https://github.com/KeepOak/Branch-Agent/releases' }

if (-not [Environment]::Is64BitOperatingSystem) { Exit-Install 'Branch Agent needs 64-bit Windows.' }
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64' -and $arch -ne 'ARM64') { Exit-Install "no Branch Agent build for $arch yet." }

if ($Version) {
    $tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
    if ($tag -notmatch '^v\d') { Exit-Install "invalid version $Version" }
    $downloadUrl = "$baseUrl/download/$tag"
} else {
    $tag = ''
    $downloadUrl = "$baseUrl/latest/download"
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("branch-agent-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $label = if ($tag) { $tag } else { 'latest' }
    Write-Output "Branch Agent installer: win32-x64, release $label"

    $sumsFile = Join-Path $work 'SHA256SUMS'
    try { Invoke-WebRequest -UseBasicParsing -Uri "$downloadUrl/SHA256SUMS" -OutFile $sumsFile }
    catch { Exit-Install "could not download $downloadUrl/SHA256SUMS ($($_.Exception.Message))" }

    $entries = @(Get-Content -LiteralPath $sumsFile | Where-Object { $_ -match '^[0-9a-f]{64}  Branch-Agent-Setup-\d[^ ]*-win32-x64\.exe$' })
    if ($entries.Count -ne 1) { Exit-Install 'SHA256SUMS has no single entry for the Windows setup; nothing was installed.' }
    $expected, $asset = $entries[0] -split '  ', 2
    if ($tag -and $asset -ne "Branch-Agent-Setup-$($tag.Substring(1))-win32-x64.exe") {
        Exit-Install "SHA256SUMS for $tag lists $asset, which is another version; nothing was installed."
    }

    Write-Output "Downloading $asset"
    $setup = Join-Path $work $asset
    try { Invoke-WebRequest -UseBasicParsing -Uri "$downloadUrl/$asset" -OutFile $setup }
    catch { Exit-Install "could not download $downloadUrl/$asset ($($_.Exception.Message))" }

    $actual = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Exit-Install "SHA-256 mismatch for $asset (expected $expected, got $actual). The download is damaged or was tampered with. Nothing was installed."
    }
    Write-Output "Verified SHA-256 $actual"

    # Inno Setup, PrivilegesRequired=lowest: /CURRENTUSER keeps it per user with no admin prompt.
    $arguments = '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/SP-'
    $process = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { Exit-Install "the setup exited with code $($process.ExitCode)." }

    $installed = Join-Path $env:LOCALAPPDATA 'Programs\Branch Agent\Branch Agent.exe'
    Write-Output "Installed $installed"
    Write-Output ''
    Write-Output 'Next: open Branch Agent from the Start menu.'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
