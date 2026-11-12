# Motionable installer for Windows (PowerShell 5.1+). No admin rights. Safe to run again.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 defaults to old TLS; force 1.2 (harmless on newer hosts).
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Src  = Split-Path -Parent $PSScriptRoot
$Root = Join-Path $env:USERPROFILE '.motionable'
$Bin  = Join-Path $Root 'bin'
$App  = Join-Path $Root 'app'

function Say([string]$m) { Write-Host ""; Write-Host "== $m" }
function Die([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Have([string]$n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Fetch([string]$url, [string]$out) {
  if ($url -notlike 'https://*') { Die "Refusing non-HTTPS URL: $url" }
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
}
function VerifySha256([string]$file, [string]$want, [string]$label) {
  $want = ($want -as [string]).Trim().ToLower()
  if (-not $want) { Die "No published SHA-256 for $label. Aborting; nothing was installed." }
  $got = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
  if ($got -ne $want) { Die "SHA-256 mismatch for $label (expected $want, got $got). Aborting; nothing was installed." }
  Write-Host "verified sha256: $label"
}
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
# Fallback only: tools already on PATH win, ~/.motionable/bin is searched last.
$env:Path = "$env:Path;$Bin"

try {
  # 2. yt-dlp
  Say 'yt-dlp'
  $ytLocal = Join-Path $Bin 'yt-dlp.exe'
  $ytCmd = Get-Command yt-dlp -ErrorAction SilentlyContinue
  if ($ytCmd -and ($ytCmd.Source -ne $ytLocal)) {
    Write-Host "found: $($ytCmd.Source)"
  } elseif (Test-Path $ytLocal) {
    Write-Host "found: $ytLocal, updating"
    try { & $ytLocal -U; if ($LASTEXITCODE -ne 0) { throw 'yt-dlp -U failed' } }
    catch { Write-Host 'WARNING: yt-dlp -U failed; keeping the current version.' -ForegroundColor Yellow }
    $global:LASTEXITCODE = 0
  } else {
    $base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
    $tmpExe = Join-Path $Tmp 'yt-dlp.exe'
    Fetch "$base/yt-dlp.exe" $tmpExe
    $sums = Join-Path $Tmp 'SHA2-256SUMS'
    Fetch "$base/SHA2-256SUMS" $sums
    $line = Get-Content $sums | Where-Object { $_ -match '\s+yt-dlp\.exe$' } | Select-Object -First 1
    $want = if ($line) { ($line -split '\s+')[0] } else { '' }
    VerifySha256 $tmpExe $want 'yt-dlp.exe'
    Move-Item -Force $tmpExe $ytLocal
    Write-Host "installed: $ytLocal"
  }

  # 3. ffmpeg + ffprobe
  Say 'ffmpeg'
  if ((Have 'ffmpeg') -and (Have 'ffprobe')) {
    Write-Host "found: $((Get-Command ffmpeg).Source)"
  } else {
    $zip = Join-Path $Tmp 'ffmpeg.zip'
    $u = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    Fetch $u $zip
    $shaFile = Join-Path $Tmp 'ffmpeg.zip.sha256'
    Fetch "$u.sha256" $shaFile
    VerifySha256 $zip ((Get-Content $shaFile -Raw) -split '\s+')[0] 'ffmpeg-release-essentials.zip'
    Expand-Archive -Path $zip -DestinationPath (Join-Path $Tmp 'ff') -Force
    foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
      $f = Get-ChildItem -Path (Join-Path $Tmp 'ff') -Recurse -Filter $exe | Select-Object -First 1
      if (-not $f) { Die "$exe not found in the ffmpeg archive." }
      Copy-Item -Force $f.FullName (Join-Path $Bin $exe)
    }
    Write-Host "installed: $Bin\ffmpeg.exe"
  }

  # 4. Copy the app.
  # $App is installer-owned: /MIR deletes everything in it except node_modules
  # and replaces it on every run, so files removed from the repo do not linger.
  Say "Copy app to $App"
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  if ((Resolve-Path $App).Path -ne (Resolve-Path $Src).Path) {
    & robocopy $Src $App /MIR /XD node_modules dist .git .superpowers /NFL /NDL /NJH /NJS /NP | Out-Null
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
  $docOut = (& node (Join-Path $App 'dist\cli.js') doctor | Out-String)
  $docCode = $LASTEXITCODE
  Write-Host $docOut
  $global:LASTEXITCODE = 0
  if (($docCode -ne 0) -or ($docOut -notmatch '"ok":\s*true')) {
    Write-Host 'WARNING: Tekshiruv muvaffaqiyatsiz: yuqoridagi "false" qiymatlarni tuzating va skriptni qayta ishga tushiring.' -ForegroundColor Yellow
    Write-Host 'WARNING: Doctor check failed: fix the "false" items above and run this script again.' -ForegroundColor Yellow
    exit 1
  }
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
