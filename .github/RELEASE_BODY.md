## Downloads

### Desktop app
Draw rooms, place doors and stairs, write per-layer notes, and export both a GM map and a player map in one click.

| File | Platform |
|---|---|
| **`Cartographer_<version>_aarch64.dmg`** | macOS — Apple Silicon (M1 / M2 / M3 / M4) |
| **`cartographer-desktop_<version>_amd64.AppImage`** | Linux — universal (run `chmod +x` then double-click) |
| **`cartographer-desktop_<version>_amd64.deb`** | Debian / Ubuntu |
| **`Cartographer_<version>_x64-setup.exe`** | Windows — recommended installer (NSIS) |
| **`Cartographer_<version>_x64_en-US.msi`** | Windows — MSI installer (better for Group Policy / silent installs) |

### Command-line binary
For terminal users, batch rendering, and LLM pipelines. `cartographer render <map.yaml> -o map.png` turns a YAML map into an image.

| File | Platform |
|---|---|
| **`cartographer-aarch64-apple-darwin`** | macOS — Apple Silicon |
| **`cartographer-x86_64-unknown-linux-gnu`** | Linux |
| **`cartographer-x86_64-pc-windows-msvc.exe`** | Windows |

Each binary ships with a `.sha256` companion file for integrity verification. On Unix systems make the binary executable with `chmod +x` before running.

### macOS note
The desktop app is ad-hoc signed but **not** notarized (notarization requires a paid Apple Developer account). The first time you open it, macOS may say it's from an unidentified developer — right-click the app and choose **Open** to bypass, or run:

```sh
xattr -cr "/Applications/Cartographer.app"
```

The CLI binary has no signature and may need the same `xattr` treatment.

---
