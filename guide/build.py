#!/usr/bin/env python3
"""Build guide/motionable-qollanma.pdf from guide/guide.html and prompts/*.md.

Usage: python3 guide/build.py
Needs Google Chrome or Chromium on PATH.
"""
import html
import shutil
import subprocess
import sys
from pathlib import Path

GUIDE = Path(__file__).resolve().parent
PROMPTS = GUIDE.parent / "prompts"
FILES = ["1-ornatish.md", "2-uslub.md", "3-video.md", "4-saboq.md"]
OUT = GUIDE / "motionable-qollanma.pdf"


def main() -> int:
    chrome = next(
        (shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser", "chrome") if shutil.which(n)),
        None,
    )
    if not chrome:
        print("Chrome or Chromium not found on PATH", file=sys.stderr)
        return 1

    page = (GUIDE / "guide.html").read_text(encoding="utf-8")
    for i, name in enumerate(FILES, start=1):
        text = (PROMPTS / name).read_text(encoding="utf-8").strip()
        page = page.replace("{{P%d}}" % i, html.escape(text))

    # Built next to guide.html so relative image paths resolve.
    built = GUIDE / ".build.html"
    built.write_text(page, encoding="utf-8")
    try:
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--virtual-time-budget=10000",
                f"--print-to-pdf={OUT}",
                built.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
    finally:
        built.unlink(missing_ok=True)

    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
