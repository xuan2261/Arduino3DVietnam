"""Create reproducible app, deployed-site and upstream-source ZIP archives.

Only output to ROOT/releases; never changes source directories. ZIP contents
are selected by stable allowlists, without cache folders or root Git metadata.
"""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "releases"
PREFIX = "Arduino3DVietnam"
RELEASE = "20261028"
SKIP_DIRS = {".git", "__pycache__", ".pytest_cache", "node_modules"}
TOP = [
    ".github", "assets", "docs", "scripts", "src", "styles", "tests",
    ".gitignore", ".gitattributes", "CHAY-ARDUINO.bat", "CHAY-ARDUINO.command",
    "index.html", "README.md", "site.webmanifest", "sw.js",
    "THIRD-PARTY-NOTICES.md",
]


def iter_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for name in paths:
        path = ROOT / name
        if not path.exists():
            raise FileNotFoundError(f"Missing release input: {name}")
        if path.is_file():
            files.append(path)
        else:
            files.extend(
                candidate for candidate in path.rglob("*")
                if candidate.is_file() and not set(candidate.relative_to(ROOT).parts) & SKIP_DIRS
            )
    return sorted(set(files), key=lambda item: item.relative_to(ROOT).as_posix())


def archive(destination: Path, files: list[Path]) -> int:
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=7) as out:
        for path in files:
            if not path.is_relative_to(ROOT):
                raise ValueError(f"Outside root: {path}")
            arcname = path.relative_to(ROOT).as_posix()
            if arcname.startswith("releases/"):
                raise ValueError("Refusing to include release archive in itself")
            info = ZipInfo(arcname, date_time=(2026, 10, 28, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            out.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=7)
    return len(files)


def package() -> list[tuple[Path, int]]:
    OUT.mkdir(exist_ok=True)
    source_root = ROOT / "sources"
    dist_root = ROOT / "dist"
    if not source_root.is_dir() or not dist_root.is_dir():
        raise FileNotFoundError("Run source clone and build_site.py first")
    app = iter_files(TOP)
    source_files = sorted((p for p in source_root.rglob("*") if p.is_file()),
                          key=lambda p: p.relative_to(ROOT).as_posix())
    site_files = sorted((p for p in dist_root.rglob("*") if p.is_file()),
                        key=lambda p: p.relative_to(ROOT).as_posix())
    outputs = [
        (OUT / f"{PREFIX}-app-source-{RELEASE}.zip", app),
        (OUT / f"{PREFIX}-website-dist-{RELEASE}.zip", site_files),
        (OUT / f"{PREFIX}-upstream-snapshots-{RELEASE}.zip", source_files),
    ]
    results = [(path, archive(path, files)) for path, files in outputs]
    hashes = [f"{sha256(path.read_bytes()).hexdigest()}  {path.name}"
              for path, _ in results]
    (OUT / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")
    return results


if __name__ == "__main__":
    for file, count in package():
        print(f"OK {file.name}: {count} files ({file.stat().st_size} bytes)")
