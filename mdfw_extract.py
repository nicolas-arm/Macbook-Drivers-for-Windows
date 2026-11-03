#!/usr/bin/env python3
"""MDfW: unpack BootCampESD.pkg into the Windows driver folder (with Setup.exe).

    python3 mdfw_extract.py BootCampESD.pkg [output_folder]

macOS: uses the built-in pkgutil, tar and hdiutil.
Windows / Linux: needs 7-Zip (7z on PATH, or installed in C:\\Program Files\\7-Zip).
Layout: BootCampESD.pkg (xar) -> Payload (gzip cpio) -> WindowsSupport.dmg -> BootCamp\\Setup.exe
"""
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile


def find_7z():
    for name in ("7z", "7zz", "7za"):
        path = shutil.which(name)
        if path:
            return path
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if base and os.path.exists(os.path.join(base, "7-Zip", "7z.exe")):
            return os.path.join(base, "7-Zip", "7z.exe")
    sys.exit("7-Zip not found. Install it from https://www.7-zip.org and run again.")


def find_file(root, name):
    for dirpath, _, files in os.walk(root):
        if name in files:
            return os.path.join(dirpath, name)
    return None


def extract_drivers(pkg_path, out_dir):
    """Unpack pkg_path into out_dir and return the path to Setup.exe."""
    os.makedirs(out_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="mdfw_")
    try:
        if platform.system() == "Darwin":
            subprocess.run(["pkgutil", "--expand", pkg_path, os.path.join(work, "pkg")], check=True)
            subprocess.run(["tar", "-xzf", os.path.join(work, "pkg", "Payload"), "-C", work], check=True)
            dmg = find_file(work, "WindowsSupport.dmg")
            info = plistlib.loads(subprocess.run(
                ["hdiutil", "attach", dmg, "-readonly", "-nobrowse", "-mountrandom", work, "-plist"],
                check=True, capture_output=True).stdout)
            mount = next(e["mount-point"] for e in info["system-entities"] if "mount-point" in e)
            try:
                shutil.copytree(mount, out_dir, dirs_exist_ok=True)
            finally:
                subprocess.run(["hdiutil", "detach", mount, "-quiet"])
        else:
            sevenzip = find_7z()
            # pkg -> Payload -> Payload~ (cpio) -> WindowsSupport.dmg
            for arc in ("BootCampESD.pkg", "Payload", "Payload~"):
                src = pkg_path if arc == "BootCampESD.pkg" else os.path.join(work, arc)
                if os.path.exists(src):
                    subprocess.run([sevenzip, "x", "-y", "-o" + work, src],
                                   check=True, stdout=subprocess.DEVNULL)
            dmg = find_file(work, "WindowsSupport.dmg")
            if not dmg:
                sys.exit("WindowsSupport.dmg was not found inside the package.")
            subprocess.run([sevenzip, "x", "-y", "-o" + out_dir, dmg],
                           check=True, stdout=subprocess.DEVNULL)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return find_file(out_dir, "Setup.exe")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    pkg = os.path.abspath(sys.argv[1])
    out = os.path.abspath(sys.argv[2] if len(sys.argv) == 3 else "WindowsSupport")
    setup = extract_drivers(pkg, out)
    print(f"Drivers extracted to: {out}")
    print(f"Run this in Windows:  {setup}" if setup else "Setup.exe not found in the output.")
