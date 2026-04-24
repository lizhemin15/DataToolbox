#!/usr/bin/env python3
"""Inject release version into static asset URLs during CI build.

Usage: python3 scripts/inject_version.py <version> <package_dir>

Replaces all occurrences of ?v=X.Y.Z in data-ontology static files
with ?v=<version>, where X.Y.Z matches any semver-like pattern.
"""
import re
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <version> <package_dir>")
        sys.exit(1)

    version = sys.argv[1]
    package_dir = Path(sys.argv[2])

    files = [
        package_dir / "web" / "apps" / "data-ontology" / "index.html",
        package_dir / "web" / "apps" / "data-ontology" / "script.js",
    ]

    pattern = re.compile(r"\?v=\d+\.\d+\.\d+")

    for fpath in files:
        if not fpath.exists():
            print(f"  SKIP (not found): {fpath}")
            continue
        text = fpath.read_text()
        new_text = pattern.sub(f"?v={version}", text)
        if new_text != text:
            fpath.write_text(new_text)
            print(f"  PATCHED: {fpath} -> v={version}")
        else:
            print(f"  NO CHANGE: {fpath}")


if __name__ == "__main__":
    main()