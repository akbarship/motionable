#!/usr/bin/env bash
# Motionable installer for Linux and macOS. No sudo. Safe to run again.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${HOME}/.motionable"
BIN="${ROOT}/bin"
APP="${ROOT}/app"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in Linux | Darwin) ;; *) die "Unsupported OS: ${OS}. On Windows use scripts/install.ps1." ;; esac

# 1. Node >= 22
say "Node.js"
if ! have node; then
  die "Node.js not found. Install Node 22 or newer: https://nodejs.org (or nvm: https://github.com/nvm-sh/nvm). Then run this script again."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node $(node -v) is too old, need 22 or newer. Get it from https://nodejs.org or run: nvm install 22"
fi
have npm || die "npm not found (it ships with Node). Reinstall Node from https://nodejs.org"
echo "node $(node -v)"
have curl || die "curl not found. Install curl and run again."

mkdir -p "$BIN"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PATH="${BIN}:${PATH}"

download() { # url dest
  curl -fL --retry 3 --progress-bar -o "$2" "$1" || die "Download failed: $1"
}

# 2. yt-dlp
say "yt-dlp"
if have yt-dlp; then
  echo "found: $(command -v yt-dlp)"
else
  if [ "$OS" = "Darwin" ]; then
    YT="yt-dlp_macos"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    YT="yt-dlp_linux_aarch64"
  else
    YT="yt-dlp_linux"
  fi
  download "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YT}" "${BIN}/yt-dlp"
  chmod +x "${BIN}/yt-dlp"
  echo "installed: ${BIN}/yt-dlp"
fi

# 3. ffmpeg + ffprobe
say "ffmpeg"
if have ffmpeg && have ffprobe; then
  echo "found: $(command -v ffmpeg)"
elif [ "$OS" = "Linux" ]; then
  have tar || die "tar not found."
  have xz || die "xz not found (needed to unpack ffmpeg). Install xz-utils and run again."
  case "$ARCH" in
    x86_64 | amd64) FF="ffmpeg-release-amd64-static.tar.xz" ;;
    aarch64 | arm64) FF="ffmpeg-release-arm64-static.tar.xz" ;;
    *) die "No static ffmpeg for ${ARCH}. Install ffmpeg with your package manager." ;;
  esac
  download "https://johnvansickle.com/ffmpeg/releases/${FF}" "${TMP}/ff.tar.xz"
  mkdir -p "${TMP}/ff"
  tar -xJf "${TMP}/ff.tar.xz" -C "${TMP}/ff" --strip-components=1
  cp "${TMP}/ff/ffmpeg" "${TMP}/ff/ffprobe" "$BIN/"
  chmod +x "${BIN}/ffmpeg" "${BIN}/ffprobe"
  echo "installed: ${BIN}/ffmpeg"
else
  have unzip || die "unzip not found."
  # evermeet.cx publishes x86_64 builds (they run on Apple Silicon through Rosetta).
  for tool in ffmpeg ffprobe; do
    URL="$(curl -fsSL "https://evermeet.cx/ffmpeg/info/${tool}/release" | sed -n 's/.*"zip":{"url":"\([^"]*\)".*/\1/p')"
    [ -n "$URL" ] || die "Could not find the ${tool} download on evermeet.cx. Install it with: brew install ffmpeg"
    download "$URL" "${TMP}/${tool}.zip"
    unzip -oq "${TMP}/${tool}.zip" -d "$BIN"
    chmod +x "${BIN}/${tool}"
  done
  echo "installed: ${BIN}/ffmpeg (if macOS blocks it, run: xattr -d com.apple.quarantine ${BIN}/ffmpeg ${BIN}/ffprobe)"
fi

# 4. Copy the app
say "Copy app to ${APP}"
mkdir -p "$APP"
if [ "$(cd "$APP" && pwd)" != "$SRC" ]; then
  (cd "$SRC" && tar -cf - --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./.superpowers .) | (cd "$APP" && tar -xf -)
fi

# 5. Build
say "npm ci && npm run build"
cd "$APP"
npm ci
npm run build

# 6. Browser for rendering
say "HyperFrames browser"
npx --yes hyperframes browser ensure

# 7. Doctor
say "Doctor"
node "${APP}/dist/cli.js" doctor || true

cat <<MSG

== Done. Next, in Claude Code, run these:

  claude plugin marketplace add "${APP}"
  claude plugin install motionable@motionable

Then restart Claude Code and start with:

  /motionable:motionable

(Inside Claude Code the same commands are: /plugin marketplace add "${APP}"  and  /plugin install motionable@motionable)
MSG
