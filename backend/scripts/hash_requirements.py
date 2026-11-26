"""Refresh wheel hashes for existing exact pins; never select package versions."""

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

PIN = re.compile(r"([A-Za-z0-9_.-]+)(\[[A-Za-z0-9_,.-]+\])?==([A-Za-z0-9_.+-]+)")
POLICY = "--require-hashes\n--only-binary=:all:\n"
ROOT = Path(__file__).resolve().parents[1]


def wheel_hashes(pin):
    match = PIN.fullmatch(pin)
    if not match:
        raise ValueError(f"Expected an exact package pin: {pin}")
    name, _, version = match.groups()
    with urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=30) as response:
        metadata = json.load(response)

    def normalize(value):
        return re.sub(r"[-_.]+", "-", value).lower()

    if normalize(metadata["info"]["name"]) != normalize(name):
        raise ValueError(f"PyPI package name mismatch: {pin}")
    if metadata["info"]["version"] != version:
        raise ValueError(f"PyPI package version mismatch: {pin}")
    hashes = sorted(
        {
            artifact["digests"]["sha256"]
            for artifact in metadata["urls"]
            if artifact["packagetype"] == "bdist_wheel" and not artifact["yanked"]
        }
    )
    if not hashes or any(not re.fullmatch(r"[0-9a-f]{64}", digest) for digest in hashes):
        raise ValueError(f"No valid wheel hashes: {pin}")
    return (" " + chr(92) + "\n    ").join([pin, *(f"--hash=sha256:{digest}" for digest in hashes)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check without writing locks")
    args = parser.parse_args()
    paths = [ROOT / f"requirements{suffix}.txt" for suffix in ("", "-dev", "-audit", "-installer")]
    rendered = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for path in paths:
            # Fold existing continuations before removing only generated hash options.
            lines = path.read_text(encoding="utf-8").replace("\\\n", " ").splitlines()
            source = [line.split(" --hash=", 1)[0].strip() for line in lines]
            source = [
                line
                for line in source
                if line and not line.startswith("#") and line not in POLICY.splitlines()
            ]
            pins = [line for line in source if not line.startswith("-r ")]
            hashes = dict(zip(pins, pool.map(wheel_hashes, pins), strict=True))
            content = (
                "# Exact pins; refresh wheel hashes with: python scripts/hash_requirements.py\n"
            )
            content += POLICY + "\n" + "\n".join(hashes.get(line, line) for line in source) + "\n"
            rendered.append((path, content))
    # Fetch/validate every release before replacing any existing file.
    for path, content in rendered:
        if args.check:
            if path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Wheel hashes need refresh: {path.name}")
        else:
            path.write_text(content, encoding="utf-8", newline="\n")
        print(f"{'Checked' if args.check else 'Updated'} {path.name}")


if __name__ == "__main__":
    main()
