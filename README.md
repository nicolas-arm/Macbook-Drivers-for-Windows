# MDfW – MacBook Drivers for Windows

Running Windows on an Intel MacBook with Boot Camp? You need Apple's Windows drivers. MDfW fetches them for your model directly from Apple's servers and unpacks them into a `Setup.exe` you can run on Windows.

**Website:** https://macbook-drivers-for-windows-site.vercel.app

## Quick start (website)

1. Open the website and enter your Mac's model ID (e.g. `MacBookPro14,3`). You can find it under *About This Mac* or with `sysctl hw.model` in Terminal.
2. Download the driver package (`BootCampESD.pkg`).
3. Unpack the package as described below, or let the website do it for you.
4. Copy the unpacked folder to your Windows installation drive or a USB stick.
5. On Windows, run `Setup.exe` from that folder.

## Command line (optional)

If you prefer to work locally:

### Requirements

- Python 3 (no additional packages needed)
- **macOS:** `pkgutil`, `tar` and `hdiutil` are already installed.
- **Windows / Linux:** [7-Zip](https://www.7-zip.org) (`7z`, `7zz` or `7za` on PATH, or `7z.exe` in `C:\Program Files\7-Zip`).

### 1. Find the download URL

```bash
python3 bootcamp_esd_url.py <model>
```

Example:

```bash
python3 bootcamp_esd_url.py MacBookPro14,3
```

The script prints the model, the Boot Camp product ID, the posting date and the download URL. Apple Silicon Macs do not support Boot Camp, so no package will be found for them.

### 2. Download the package

Open the URL from step 1 in a browser or download it with `curl`. Save the file as `BootCampESD.pkg`.

### 3. Extract the drivers

```bash
python3 mdfw_extract.py BootCampESD.pkg [output_folder]
```

Without an output folder, the drivers go to `./WindowsSupport`. The script prints the path to `Setup.exe` when it finishes.

## How it works

**Finding the package** (`bootcamp_esd_url.py`)

1. Downloads Apple's software catalog.
2. Filters for Boot Camp packages and reads their distribution files.
3. Matches your model exactly. `MacBookPro1,1` will not match `MacBookPro11,1`.
4. If several packages list your model, the most recently posted one is chosen.

The logic is based on [brigadier](https://github.com/timsutton/brigadier) 0.2.6, ported to Python 3.

**Extracting the drivers** (`mdfw_extract.py`)

The package is nested like this:

```
BootCampESD.pkg (xar)
└── Payload (gzip cpio)
    └── WindowsSupport.dmg
        └── BootCamp/Setup.exe
```

- **macOS:** `pkgutil` expands the package, `tar` unpacks the payload, and `hdiutil` mounts the disk image read-only.
- **Windows / Linux:** 7-Zip unpacks each layer in turn.

## Files in this repo

| File / folder | Purpose |
|---|---|
| `bootcamp_esd_url.py` | Looks up the Boot Camp download URL for a Mac model |
| `mdfw_extract.py` | Unpacks `BootCampESD.pkg` into a folder containing `Setup.exe` |
| `build_models.py` | Builds the model list used by the website |
| `build_site.py` | Builds the static website |
| `i18n_data.py` | Translation strings for the website |
| `site/` | Website source |
| `showcase/` | Screenshots |

## Notes

- Apple's catalog URL is hard-coded in `bootcamp_esd_url.py`. If Apple changes or removes it, the lookup will fail until the URL is updated.
- Which drivers are available is up to Apple. Newer Macs may have no Boot Camp package at all.
- Check that the drivers match your Windows version and Mac model before installing. The tool does not verify compatibility.

## License

MIT, see [LICENSE.md](LICENSE.md).

*This project is not affiliated with or endorsed by Apple or Microsoft. Apple and Boot Camp are trademarks of Apple Inc.*
