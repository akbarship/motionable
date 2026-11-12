# Motionable installer for Windows (PowerShell 5.1+). No admin rights. Safe to run again.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Src  = Split-Path -Parent $PSScriptRoot
$Root = Join-Path $env:USERPROFILE '.motionable'
$Bin  = Join-Path $Root 'bin'
$App  = Join-Path $Root 'app'

function Say([string]$m) { Write-Host ""; Write-Host "== $m" }
function Die([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Have([string]$n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Check([string]$what) { if ($LASTEXITCODE -ne 0) { Die "$what failed (exit $LASTEXITCODE)." } }

# 1. Node >= 22
Say 'Node.js'
if (-not (Have 'node')) {
  Die 'Node.js not found. Install Node 22 or newer from https://nodejs.org (or nvm-windows: https://github.com/coreybutler/nvm-windows), then run this script again.'
}
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 22) {
  Die "Node $(& node -v) is too old, need 22 or newer. Get it from https://nodejs.org or run: nvm install 22"
}
if (-not (Have 'npm')) { Die 'npm not found (it ships with Node). Reinstall Node from https://nodejs.org' }
Write-Host "node $(& node -v)"

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("motionable-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
$env:Path = "$Bin;$env:Path"

try {
  # 2. yt-dlp
  Say 'yt-dlp'
  if (Have 'yt-dlp') {
    Write-Host "found: $((Get-Command yt-dlp).Source)"
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $Bin 'yt-dlp.exe')
    Write-Host "installed: $Bin\yt-dlp.exe"
  }

  # 3. ffmpeg + ffprobe
  Say 'ffmpeg'
  if ((Have 'ffmpeg') -and (Have 'ffprobe')) {
    Write-Host "found: $((Get-Command ffmpeg).Source)"
  } else {
    $zip = Join-Path $Tmp 'ffmpeg.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath (Join-Path $Tmp 'ff') -Force
    foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
      $f = Get-ChildItem -Path (Join-Path $Tmp 'ff') -Recurse -Filter $exe | Select-Object -First 1
      if (-not $f) { Die "$exe not found in the ffmpeg archive." }
      Copy-Item -Force $f.FullName (Join-Path $Bin $exe)
    }
    Write-Host "installed: $Bin\ffmpeg.exe"
  }

  # 4. Copy the app (skip node_modules, dist, .git, .superpowers)
  Say "Copy app to $App"
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  if ((Resolve-Path $App).Path -ne (Resolve-Path $Src).Path) {
    & robocopy $Src $App /E /XD node_modules dist .git .superpowers /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed (exit $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
  }

  # 5. Build
  Say 'npm ci && npm run build'
  Set-Location $App
  & npm ci; Check 'npm ci'
  & npm run build; Check 'npm run build'

  # 6. Browser for rendering
  Say 'HyperFrames browser'
  & npx --yes hyperframes browser ensure; Check 'hyperframes browser ensure'

  # 7. Doctor
  Say 'Doctor'
  & node (Join-Path $App 'dist\cli.js') doctor
  $global:LASTEXITCODE = 0
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Write-Host @"

== Done. Next, in Claude Code, run these:

  claude plugin marketplace add "$App"
  claude plugin install motionable@motionable

Then restart Claude Code and start with:

  /motionable:motionable

(Inside Claude Code the same commands are: /plugin marketplace add "$App"  and  /plugin install motionable@motionable)
"@
