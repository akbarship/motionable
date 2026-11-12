#!/usr/bin/env bash
# Motionable installer for Linux and macOS. No sudo. Safe to run again.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
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
# Fallback only: tools already on PATH win, ~/.motionable/bin is searched last.
export PATH="${PATH}:${BIN}"

download() { # url dest  (HTTPS only, TLS 1.2+)
  curl --proto '=https' --tlsv1.2 -fsSL --retry 5 --retry-all-errors -o "$2" "$1" || die "Download failed: $1"
}
fetch() { # url -> stdout
  curl --proto '=https' --tlsv1.2 -fsSL --retry 5 --retry-all-errors "$1" || die "Download failed: $1"
}
sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "Neither sha256sum nor shasum found; cannot verify downloads."; fi
}
verify_sha256() { # file expected-hash label
  local got want
  got="$(sha256_of "$1")"
  want="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
  [ -n "$want" ] || die "No published SHA-256 for $3. Aborting; nothing was installed."
  [ "$got" = "$want" ] || die "SHA-256 mismatch for $3 (expected ${want}, got ${got}). Aborting; nothing was installed."
  echo "verified sha256: $3"
}

# 2. yt-dlp
say "yt-dlp"
if have yt-dlp && [ "$(command -v yt-dlp)" != "${BIN}/yt-dlp" ]; then
  echo "found: $(command -v yt-dlp)"
elif [ -x "${BIN}/yt-dlp" ]; then
  echo "found: ${BIN}/yt-dlp, updating"
  "${BIN}/yt-dlp" -U || echo "WARNING: yt-dlp -U failed; keeping the current version." >&2
else
  if [ "$OS" = "Darwin" ]; then
    YT="yt-dlp_macos"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    YT="yt-dlp_linux_aarch64"
  else
    YT="yt-dlp_linux"
  fi
  YBASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  download "${YBASE}/${YT}" "${TMP}/${YT}"
  WANT="$(fetch "${YBASE}/SHA2-256SUMS" | awk -v f="$YT" '$2 == f { print $1 }')"
  verify_sha256 "${TMP}/${YT}" "$WANT" "$YT"
  mv "${TMP}/${YT}" "${BIN}/yt-dlp"
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
  have md5sum || die "md5sum not found; cannot verify the ffmpeg download."
  case "$ARCH" in
    x86_64 | amd64) FF="ffmpeg-release-amd64-static.tar.xz" ;;
    aarch64 | arm64) FF="ffmpeg-release-arm64-static.tar.xz" ;;
    *) die "No static ffmpeg for ${ARCH}. Install ffmpeg with your package manager." ;;
  esac
  FBASE="https://johnvansickle.com/ffmpeg/releases"
  download "${FBASE}/${FF}" "${TMP}/ff.tar.xz"
  # johnvansickle publishes only an MD5 next to each build.
  WANT="$(fetch "${FBASE}/${FF}.md5" | awk '{ print $1 }')"
  GOT="$(md5sum "${TMP}/ff.tar.xz" | cut -d' ' -f1)"
  [ -n "$WANT" ] && [ "$GOT" = "$WANT" ] || die "MD5 mismatch for ${FF} (expected ${WANT}, got ${GOT}). Aborting; nothing was installed."
  echo "verified md5: ${FF}"
  mkdir -p "${TMP}/ff"
  tar -xJf "${TMP}/ff.tar.xz" -C "${TMP}/ff" --strip-components=1
  mv "${TMP}/ff/ffmpeg" "${TMP}/ff/ffprobe" "$BIN/"
  chmod +x "${BIN}/ffmpeg" "${BIN}/ffprobe"
  echo "installed: ${BIN}/ffmpeg"
else
  have unzip || die "unzip not found."
  # Native builds from ffmpeg.martin-riedl.de, each with a published .sha256.
  case "$ARCH" in arm64 | aarch64) MA="arm64" ;; *) MA="amd64" ;; esac
  MBASE="https://ffmpeg.martin-riedl.de"
  for tool in ffmpeg ffprobe; do
    REL=""
    for _ in 1 2 3 4 5 6; do # the redirect endpoint answers 404 now and then
      REL="$(curl --proto '=https' --tlsv1.2 -sI "${MBASE}/redirect/latest/macos/${MA}/release/${tool}.zip" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')" || REL=""
      [ -n "$REL" ] && break
      sleep 2
    done
    [ -n "$REL" ] || die "Could not find the ${tool} download on ffmpeg.martin-riedl.de. Install it with: brew install ffmpeg"
    case "$REL" in /*) REL="${MBASE}${REL}" ;; esac
    download "$REL" "${TMP}/${tool}.zip"
    WANT="$(fetch "${REL}.sha256" | awk '{ print $1 }')"
    verify_sha256 "${TMP}/${tool}.zip" "$WANT" "${tool}.zip"
    unzip -oq "${TMP}/${tool}.zip" -d "${TMP}/${tool}-x"
    mv "${TMP}/${tool}-x/${tool}" "${BIN}/${tool}"
    chmod +x "${BIN}/${tool}"
  done
  echo "installed: ${BIN}/ffmpeg (if macOS blocks it, run: xattr -d com.apple.quarantine \"${BIN}/ffmpeg\" \"${BIN}/ffprobe\")"
fi

# 4. Copy the app.
# ${APP} is installer-owned: everything in it except node_modules is deleted and
# replaced on every run, so files removed from the repo do not linger.
say "Copy app to ${APP}"
mkdir -p "$APP"
if [ "$(cd "$APP" && pwd -P)" != "$SRC" ]; then
  find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
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
DOC_OK=1
DOC_OUT="$(node "${APP}/dist/cli.js" doctor)" || DOC_OK=0
printf '%s\n' "$DOC_OUT"
printf '%s' "$DOC_OUT" | grep -q '"ok": true' || DOC_OK=0
if [ "$DOC_OK" -ne 1 ]; then
  cat <<MSG

WARNING: Tekshiruv muvaffaqiyatsiz: yuqoridagi "false" qiymatlarni tuzating va skriptni qayta ishga tushiring.
WARNING: Doctor check failed: fix the "false" items above and run this script again.
MSG
  exit 1
fi

cat <<MSG

== Done. Next, in Claude Code, run these:

  claude plugin marketplace add "${APP}"
  claude plugin install motionable@motionable

Then restart Claude Code and start with:

  /motionable:motionable

(Inside Claude Code the same commands are: /plugin marketplace add "${APP}"  and  /plugin install motionable@motionable)
MSG
