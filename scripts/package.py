# SPDX-License-Identifier: GPL-3.0-or-later
"""Package the extension using a fixed allowlist, excluding HARs and local data."""
from pathlib import Path
from shutil import copy2
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
files = ["manifest.json", "background.js", "site-adapter.js", "speech-noise.js", "content.js",
         "popup.html", "popup.css", "popup.js", "icon.png", "README.md", "LICENSE"]
destination = root / "dist" / "Testudy-fuck.zip"
destination.parent.mkdir(exist_ok=True)
unpacked = destination.parent / "Testudy-fuck"
unpacked.mkdir(exist_ok=True)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for filename in files:
        copy2(root / filename, unpacked / filename)
        archive.write(root / filename, filename)
print(destination)
print(unpacked)
