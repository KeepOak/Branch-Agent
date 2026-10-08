# Update only Branch-owned links; -DryRun returns the plan without saving links.
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [switch]$DryRun,
    [string]$ConfigModule,
    [string[]]$ShortcutDirectories = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('Programs'),
        [Environment]::GetFolderPath('Startup')
    )
)
$ErrorActionPreference = 'Stop'
$executable = [IO.Path]::GetFullPath($Exe)
if (!(Test-Path -LiteralPath $executable -PathType Leaf) -or [IO.Path]::GetFileName($executable) -ne 'Branch Agent.exe') { throw 'Pass an existing Branch Agent.exe package.' }
if (!$ConfigModule) { $ConfigModule = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist/config.js' }
$ConfigModule = [IO.Path]::GetFullPath($ConfigModule)
if (!(Test-Path -LiteralPath $ConfigModule -PathType Leaf)) { throw 'Build the desktop config module before updating shortcuts.' }
$runtime = Join-Path (Split-Path -Parent $executable) 'resources/node/node.exe'
if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) { $runtime = (Get-Command node -ErrorAction Stop).Source }
$dataDirectory = & $runtime -e 'process.stdout.write(require(process.argv[1]).defaultDataDirectory())' $ConfigModule
if ($LASTEXITCODE -ne 0 -or !$dataDirectory) { throw 'Desktop data-directory resolution failed.' }
$dataDirectory = [IO.Path]::GetFullPath([string]$dataDirectory)
$distribution = Join-Path $dataDirectory 'dist'
$ownedRoots = @($distribution, (Join-Path $env:USERPROFILE 'BranchApp/dist'))
if ($env:BRANCH_DESKTOP_OUT) { $ownedRoots += $env:BRANCH_DESKTOP_OUT }
$ownedRoots = @($ownedRoots | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' } | Select-Object -Unique)
$directories = @($ShortcutDirectories | ForEach-Object {
    $directory = [IO.Path]::GetFullPath($_)
    if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw "Shortcut directory does not exist: $directory" }
    $directory
})

function Test-BranchTarget([string]$Target) {
    if (!$Target) { return $false }
    try { $resolved = [IO.Path]::GetFullPath($Target) } catch { return $false }
    if ([IO.Path]::GetFileName($resolved) -ne 'Branch Agent.exe') { return $false }
    foreach ($root in $ownedRoots) {
        if ($resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
            $resolved.Substring($root.Length) -match '^v\d+\.\d+\.\d+\\Branch Agent-win32-x64\\Branch Agent\.exe$') { return $true }
    }
    return $false
}

$shell = New-Object -ComObject WScript.Shell
foreach ($directory in $directories) {
    $path = Join-Path $directory 'Branch Agent.lnk'
    $exists = Test-Path -LiteralPath $path
    $previous = if ($exists) { $shell.CreateShortcut($path).TargetPath } else { $null }
    if ($exists -and !(Test-BranchTarget $previous)) {
        [pscustomobject]@{Path=$path;PreviousTarget=$previous;Target=$executable;Action='skipped-foreign';Saved=$false}
        continue
    }
    if ($DryRun) {
        [pscustomobject]@{Path=$path;PreviousTarget=$previous;Target=$executable;Action=$(if ($exists) {'would-update'} else {'would-create'});Saved=$false}
        continue
    }
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $executable
    # The shell folder is replaced on update. Start in the data folder, which stays put.
    $link.WorkingDirectory = $dataDirectory
    $link.IconLocation = "$executable,0"
    $link.Description = 'Branch Agent'
    $link.Save()
    [pscustomobject]@{Path=$path;PreviousTarget=$previous;Target=$executable;Action='updated';Saved=$true}
}
