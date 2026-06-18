# Windows Companion Standalone Installer Design

## Goals

- Ship one per-user Windows installer executable for Copy Text Companion.
- Install without Node.js, npm, Go, Wails, or administrator privileges on the
  user's machine.
- Register the Native Messaging host for Chrome and Chromium under HKCU.
- Preserve local history and settings by default during install, upgrade, and
  uninstall.
- Keep all clipboard/history data local. Do not add cloud sync, telemetry, or
  network calls.

## Recommendation

Build a small Go-based installer executable with the existing Go toolchain.
The installer embeds the built companion executable and performs the same
Native Messaging registration that the current npm script does.

Use this before adopting Wails `-nsis`.

Reasoning:

- Wails 2.12 exposes `wails build -nsis`, but this still needs an NSIS
  toolchain and custom installer lifecycle hooks for Native Messaging registry
  writes.
- A Go installer adds no new repository dependency and can be tested in the
  existing Windows CI lane.
- The current install path is already per-user and HKCU-based, so a lightweight
  installer is enough for the MVP.

## Artifact

- `dist/native/CopyTextCompanionSetup-v<version>.exe`

The setup executable should embed:

- `copy-text-companion.exe`
- installer metadata: product name, version, host name, production extension ID

The companion executable remains available separately for debugging, but the
release path should prefer the setup executable.

## Install Layout

Default install root:

```text
%LOCALAPPDATA%\CopyTextWithoutSelecting
```

Installed files:

```text
%LOCALAPPDATA%\CopyTextWithoutSelecting\copy-text-companion.exe
%LOCALAPPDATA%\CopyTextWithoutSelecting\CopyTextCompanionSetup.exe
%LOCALAPPDATA%\CopyTextWithoutSelecting\NativeMessagingHosts\com.copy_text_without_selecting.companion.json
```

The copied setup executable acts as the uninstaller entry point with an
`--uninstall` flag.

## Registry Writes

Native Messaging host keys:

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.copy_text_without_selecting.companion
HKCU\Software\Chromium\NativeMessagingHosts\com.copy_text_without_selecting.companion
```

Default value:

```text
%LOCALAPPDATA%\CopyTextWithoutSelecting\NativeMessagingHosts\com.copy_text_without_selecting.companion.json
```

Windows uninstall entry:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CopyTextWithoutSelectingCompanion
```

Recommended values:

- `DisplayName`: `Copy Text Companion`
- `DisplayVersion`: package version
- `Publisher`: `copy-text-without-selecting`
- `InstallLocation`: install root
- `DisplayIcon`: installed companion exe
- `UninstallString`: installed setup exe with `--uninstall`
- `QuietUninstallString`: installed setup exe with `--uninstall --silent`
- `NoModify`: `1`
- `NoRepair`: `1`

The installer should not manage the app's auto-start preference during normal
install. During uninstall it should remove the companion Run key so Windows does
not keep a startup entry pointing to a deleted executable.

## Native Manifest

Manifest name remains:

```text
com.copy_text_without_selecting.companion
```

Default allowed origin:

```text
chrome-extension://obhagoegpnbklgknnmbglghkfdidegkl/
```

Developer install should allow an extra unpacked extension ID:

```powershell
CopyTextCompanionSetup-v2.4.0.exe --extension-id pahmaphhgccgealefimmgjcfmobgofpp
```

The installer must validate extension IDs with the same Chrome ID rule as the
current npm script: 32 characters from `a` through `p`.

## CLI Contract

Supported flags:

- `--silent`: no message boxes; fail with process exit code and stderr.
- `--uninstall`: remove installed files and registry keys.
- `--extension-id <id>`: add an unpacked Chrome extension origin.
- `--install-root <path>`: test/dev override for install root.
- `--no-launch`: install without opening the companion.
- `--purge-data`: uninstall and delete user history/settings.

Optional aliases for Windows installer conventions:

- `/S` as an alias for `--silent`
- `/D=<path>` as an alias for `--install-root <path>`

## Install Flow

1. Validate Windows platform and flags.
2. Resolve install root.
3. Snapshot current installed exe, manifest, Native Messaging registry values,
   uninstall registry values, and companion Run key.
4. If `copy-text-companion.exe` is running from the install root:
   - interactive mode: ask the user to close it and retry
   - silent mode: fail with a clear error
5. Create install directories.
6. Copy embedded companion exe to a temporary file in the install root.
7. Atomically replace `copy-text-companion.exe`.
8. Copy the setup exe to the install root for uninstall.
9. Write Native Messaging manifest.
10. Register Chrome and Chromium Native Messaging keys.
11. Write Windows uninstall entry.
12. Optionally launch the companion unless `--no-launch` is set.

If any install step fails after snapshotting, rollback files and registry values
best-effort and return a non-zero exit code.

## Uninstall Flow

1. Validate Windows platform and flags.
2. Snapshot current install state for cleanup diagnostics.
3. If the companion is running from the install root:
   - interactive mode: ask the user to close it and retry
   - silent mode: fail with a clear error
4. Delete Chrome and Chromium Native Messaging registry keys.
5. Delete Windows uninstall entry.
6. Delete companion Run key.
7. Delete Native Messaging manifest and installed companion exe.
8. Delete copied setup/uninstaller.
9. Keep `%APPDATA%\CopyTextWithoutSelecting` by default.
10. Delete `%APPDATA%\CopyTextWithoutSelecting` only when `--purge-data` is set.

## Build Integration

Add scripts:

```json
{
  "native:package-installer": "node scripts/build-native-installer.cjs",
  "native:test-installer": "node scripts/smoke-native-installer.cjs"
}
```

Build sequence:

1. `npm run native:build`
2. Copy `dist/native/copy-text-companion.exe` into
   `companion/installer/payload/copy-text-companion.exe`
3. Build installer:

```powershell
Push-Location companion
go build `
  -ldflags "-X main.version=<version> -X main.commit=<sha>" `
  -o ..\dist\native\CopyTextCompanionSetup-v<version>.exe `
  ./installer
Pop-Location
```

The MVP setup is a CLI-style executable so CI and silent installs can capture
stderr/stdout reliably. A polished GUI wrapper remains future work.

`companion/installer/payload/` should be ignored by git.

## Test Plan

Unit tests:

- extension ID validation
- manifest generation
- install-root resolution
- registry value planning
- uninstall preserves data by default
- `--purge-data` removes data only when requested

Windows smoke test:

1. Build companion and installer.
2. Use a temp `--install-root`.
3. Snapshot real HKCU Native Messaging and uninstall registry keys.
4. Run installer with `--silent --extension-id <test id> --no-launch`.
5. Verify installed exe exists.
6. Verify manifest path and allowed origins.
7. Verify Chrome and Chromium Native Messaging registry keys.
8. Verify Windows uninstall entry.
9. Run installed companion in `--native-messaging` mode with a fake envelope.
10. Run uninstaller with `--silent`.
11. Verify registry keys and installed files are gone.
12. Restore any prior registry state even on failure.

CI:

- Add `npm run native:package-installer`.
- Add `npm run native:test-installer` to the Windows native GitHub Actions job.
- Do not run tray visual checks in hosted CI.

## Release Checklist Updates

Release artifacts should include:

- Chrome zip
- Companion exe
- Companion setup exe
- `SHA256SUMS.txt`

Manual release smoke should install via the setup exe, not
`npm run native:install-host`.

## Future Hardening

- Code signing certificate and signed setup exe.
- NSIS/Inno Setup wizard if a polished GUI installer becomes worth the extra
  toolchain dependency.
- MSIX only if Chrome Native Messaging registration and certificate management
  are explicitly solved.
