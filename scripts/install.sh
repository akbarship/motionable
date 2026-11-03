#!/usr/bin/env bash
# Motionable in one line (macOS, Linux):
#   curl -fsSL https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.sh | bash
# No admin rights: Node (if yours is missing or older than 22) and ffmpeg go into ~/.motionable, the app into
# ~/.motionable/app. Run it again to update. Windows: scripts/install.ps1.
set -euo pipefail

REPO="${MOTIONABLE_REPO:-https://github.com/akbarship/motionable}"
STATE="${MOTIONABLE_STATE:-$HOME/.motionable}"
APP="${MOTIONABLE_APP:-$STATE/app}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
ask() { # a question even under `curl | bash` (stdin is the script): read the terminal
  local q="$1" def="$2" a=""
  { read -r -p "$q [$def]: " a </dev/tty; } 2>/dev/null || true # no terminal (CI): the default
  printf '%s' "${a:-$def}"
}
mkdir -p "$STATE"

# ---------- Node 22+ ----------
NODE_OK=0
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then NODE_OK=1; fi
if [ "$NODE_OK" = 0 ]; then
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) die "Unsupported system: $(uname -s)" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "Unsupported CPU: $(uname -m)" ;; esac
  say "Node.js 22 → $STATE/node"
  file=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE "node-v22[0-9.]+-$os-$arch\.tar\.(xz|gz)" | head -1)
  [ -n "$file" ] || die "Couldn't find Node.js 22 for $os-$arch"
  rm -rf "$STATE/node" && mkdir -p "$STATE/node"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/latest-v22.x/$file"
  tar -xf "$tmp/$file" -C "$STATE/node" --strip-components 1 # tar reads .xz/.gz from the file itself
  rm -rf "$tmp"
  export PATH="$STATE/node/bin:$PATH"
  # so Claude Code (and new terminals) find this Node too
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || [ "$rc" = "$HOME/.profile" ] || continue
    grep -qs '.motionable/node/bin' "$rc" || printf '\nexport PATH="%s/node/bin:$PATH" # Motionable\n' "$STATE" >> "$rc"
  done
fi
node -v >/dev/null || die "Node.js didn't install"

# ---------- the app ----------
if [ -d "$APP/.git" ] && command -v git >/dev/null 2>&1; then
  say "Updating Motionable"
  git -C "$APP" pull --ff-only
elif command -v git >/dev/null 2>&1; then
  say "Downloading Motionable"
  rm -rf "$APP" && git clone --depth 1 "$REPO" "$APP"
else
  say "Downloading Motionable (no git: a snapshot)"
  rm -rf "$APP" && mkdir -p "$APP"
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$APP" --strip-components 1
fi
cd "$APP"

say "Installing packages (a few minutes: it also downloads the Chrome the renderer uses)"
npm ci --no-audit --no-fund
say "Building the Studio"
npm run -s build

# ---------- ffmpeg, language, folder ----------
if ! node scripts/setup.mjs | grep -q '"ffmpeg":true,"ffprobe":true'; then
  say "ffmpeg → $STATE/bin"
  node scripts/setup.mjs --ffmpeg >/dev/null
fi
lang=$(ask "Til / Language (uz/en)" "uz")
home=$(ask "Videolar papkasi / Folder for your videos" "$HOME/Motionable")
node scripts/setup.mjs --lang "$lang" --home "$home" >/dev/null

# ---------- Claude Code ----------
if [ -n "${MOTIONABLE_SKIP_CLAUDE:-}" ]; then
  say "Skipping Claude Code (MOTIONABLE_SKIP_CLAUDE)"
elif command -v claude >/dev/null 2>&1; then
  node scripts/connect-claude.mjs
  say "Tayyor! Claude Code'ni oching va yozing: /motionable"
  say "Done! Open Claude Code and type: /motionable"
else
  say "Claude Code topilmadi / Claude Code isn't installed. Install it, then run this installer again:"
  echo "  curl -fsSL https://claude.ai/install.sh | bash"
fi
node scripts/setup.mjs | grep -o '"next":"[^"]*"' || true
