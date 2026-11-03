# Motionable in one line (Windows 10/11, PowerShell):
#   irm https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.ps1 | iex
# No admin rights: Node (if yours is missing or older than 22) and ffmpeg go into %USERPROFILE%\.motionable, the app
# into %USERPROFILE%\.motionable\app. Run it again to update. macOS/Linux: scripts/install.sh.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times faster without the progress bar

$Repo = if ($env:MOTIONABLE_REPO) { $env:MOTIONABLE_REPO } else { 'https://github.com/akbarship/motionable' }
$State = if ($env:MOTIONABLE_STATE) { $env:MOTIONABLE_STATE } else { Join-Path $HOME '.motionable' }
$App = if ($env:MOTIONABLE_APP) { $env:MOTIONABLE_APP } else { Join-Path $State 'app' }
function Say($m) { Write-Host "`n$m" -ForegroundColor Cyan }
function Ask($q, $def) { $a = Read-Host "$q [$def]"; if ([string]::IsNullOrWhiteSpace($a)) { $def } else { $a } }
function Run($exe) { & $exe @args; if ($LASTEXITCODE -ne 0) { throw "$exe $args failed ($LASTEXITCODE)" } }
New-Item -ItemType Directory -Force -Path $State | Out-Null

# ---------- Node 22+ ----------
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeOk = [int](node -p "process.versions.node.split('.')[0]") -ge 22 }
if (-not $nodeOk) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  Say "Node.js 22 -> $State\node"
  $list = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v22.x/').Content
  $file = [regex]::Match($list, "node-v22[0-9.]+-win-$arch\.zip").Value
  if (-not $file) { throw "Couldn't find Node.js 22 for win-$arch" }
  $zip = Join-Path $env:TEMP $file
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/$file" -OutFile $zip
  $tmp = Join-Path $env:TEMP 'motionable-node'
  Remove-Item -Recurse -Force $tmp, (Join-Path $State 'node') -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp)[0].FullName (Join-Path $State 'node')
  Remove-Item -Force $zip
  $nodeDir = Join-Path $State 'node'
  $env:Path = "$nodeDir;$env:Path"
  # so Claude Code (and new terminals) find this Node too: the user's PATH, no admin needed
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$nodeDir*") { [Environment]::SetEnvironmentVariable('Path', "$nodeDir;$userPath", 'User') }
}

# ---------- the app ----------
if ((Test-Path (Join-Path $App '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  Say 'Updating Motionable'
  Run git -C $App pull --ff-only
} elseif (Get-Command git -ErrorAction SilentlyContinue) {
  Say 'Downloading Motionable'
  Remove-Item -Recurse -Force $App -ErrorAction SilentlyContinue
  Run git clone --depth 1 $Repo $App
} else {
  Say 'Downloading Motionable (no git: a snapshot)'
  $zip = Join-Path $env:TEMP 'motionable.zip'
  Invoke-WebRequest -UseBasicParsing "$Repo/archive/refs/heads/main.zip" -OutFile $zip
  $tmp = Join-Path $env:TEMP 'motionable-src'
  Remove-Item -Recurse -Force $tmp, $App -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp)[0].FullName $App
  Remove-Item -Force $zip
}
Set-Location $App

Say 'Installing packages (a few minutes: it also downloads the Chrome the renderer uses)'
Run npm ci --no-audit --no-fund
Say 'Building the Studio'
Run npm run -s build

# ---------- ffmpeg, language, folder ----------
if ((node scripts/setup.mjs) -notmatch '"ffmpeg":true,"ffprobe":true') {
  Say "ffmpeg -> $State\bin"
  Run node scripts/setup.mjs --ffmpeg | Out-Null
}
$lang = Ask 'Til / Language (uz/en)' 'uz'
$home2 = Ask 'Videolar papkasi / Folder for your videos' (Join-Path $HOME 'Motionable')
Run node scripts/setup.mjs --lang $lang --home $home2 | Out-Null

# ---------- Claude Code ----------
if ($env:MOTIONABLE_SKIP_CLAUDE) {
  Say 'Skipping Claude Code (MOTIONABLE_SKIP_CLAUDE)'
} elseif (Get-Command claude -ErrorAction SilentlyContinue) {
  Run node scripts/connect-claude.mjs
  Say "Tayyor! Claude Code'ni oching va yozing: /motionable"
  Say 'Done! Open Claude Code and type: /motionable'
} else {
  Say "Claude Code topilmadi / Claude Code isn't installed. Install it, then run this installer again:"
  Write-Host '  irm https://claude.ai/install.ps1 | iex'
}
