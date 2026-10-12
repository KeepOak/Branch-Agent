param(
    [string]$OutputRoot,
    [string]$BaseRuntime,
    [switch]$StampVersionMetadata
)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputRoot) {
    $legacy = Join-Path $env:USERPROFILE 'BranchApp'
    $dataRoot = if ($env:BRANCH_DESKTOP_DATA) { $env:BRANCH_DESKTOP_DATA } elseif (Test-Path -LiteralPath (Join-Path $legacy 'desktop.json')) { $legacy } else { Join-Path $env:LOCALAPPDATA 'BranchAgent' }
    $OutputRoot = Join-Path $dataRoot 'dist'
}
if (!$BaseRuntime) { $BaseRuntime = Join-Path $OutputRoot 'v0.2.0\Branch Agent-win32-x64' }
$package = Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json
$versionRoot = [IO.Path]::GetFullPath((Join-Path $OutputRoot "v$($package.version)"))
if (Test-Path -LiteralPath $versionRoot) { throw "Version folder already exists: $versionRoot. Bump the version first." }
$baseExe = Join-Path $BaseRuntime 'Branch Agent.exe'
if (!(Test-Path -LiteralPath $baseExe)) { throw "Missing approved Electron runtime: $baseExe" }
& node (Join-Path $desktopRoot 'scripts\build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop TypeScript build failed.' }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stage = [IO.Path]::GetFullPath((Join-Path $tempRoot ("branch-desktop-package-" + [guid]::NewGuid())))
if (!$stage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Stage escaped the temporary directory.' }
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $desktopRoot 'dist'),(Join-Path $desktopRoot 'assets') -Destination $stage -Recurse
    $package.PSObject.Properties.Remove('devDependencies')
    $package.PSObject.Properties.Remove('scripts')
    $package | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stage 'package.json') -Encoding utf8
    # Keep the already-approved Electron executable and runtime unchanged. Only the app archive changes.
    New-Item -ItemType Directory -Path $versionRoot | Out-Null
    Copy-Item -LiteralPath $BaseRuntime -Destination $versionRoot -Recurse
    $target = Join-Path $versionRoot (Split-Path -Leaf $BaseRuntime)
    & node (Join-Path $desktopRoot 'node_modules\@electron\asar\bin\asar.mjs') pack $stage (Join-Path $target 'resources\app.asar')
    if ($LASTEXITCODE -ne 0) { throw 'App archive packaging failed.' }
    & node (Join-Path $PSScriptRoot 'bundle-node.mjs') (Join-Path $target 'resources') win32 x64
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Node24 runtime preparation failed.' }
    $targetExe = Join-Path $target 'Branch Agent.exe'
    if ($StampVersionMetadata) {
        & node (Join-Path $PSScriptRoot 'stamp-executable-version.mjs') $targetExe
        if ($LASTEXITCODE -ne 0) { throw 'Executable version metadata update failed.' }
        $metadata = (Get-Item -LiteralPath $targetExe).VersionInfo
        if ($metadata.FileVersion -ne $package.version -or $metadata.ProductVersion -ne $package.version) { throw 'Executable version metadata does not match the app.' }
        Write-Output 'Stamped a new executable hash; normal Windows trust policy still applies. No shortcuts or running app were changed.'
    } elseif ((Get-FileHash -LiteralPath $baseExe).Hash -ne (Get-FileHash -LiteralPath $targetExe).Hash) {
        throw 'The approved executable changed.'
    } else {
        Write-Output 'Retained approved executable metadata; use -StampVersionMetadata for a separately reviewed new executable.'
    }
    Write-Output "Packaged v$($package.version): $targetExe"
} finally {
    # Delete only this invocation's verified private staging folder.
    if ($stage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
