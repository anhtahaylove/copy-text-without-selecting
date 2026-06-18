# Companion MVP Release Checklist

## Build

- `npm run validate`
- `npm run test:e2e`
- `npm run native:build`
- `npm run native:test-host`
- `npm run native:package-installer`
- `npm run native:test-installer`
- `npm run native:test-tray` from an interactive Windows desktop.
- Stop any running `copy-text-companion.exe` process if `native:install-host`
  cannot replace the installed executable.
- Install release builds with
  `dist/native/CopyTextCompanionSetup-v<version>.exe --extension-id <unpacked extension id>`.
  Keep `npm run native:install-host` only as a developer fallback.
- `npm run test:e2e:native`
- `git diff --check`
- Confirm GitHub Actions is green for both Ubuntu Chrome CI and Windows native
  CI. Windows CI covers companion build, native host protocol smoke, and native
  extension E2E; tray visual checks still require an interactive Windows desktop.
- Load `dist/chrome/` as an unpacked extension in Chrome.
- For unpacked testing, rerun install with `COPY_TEXT_DEV_EXTENSION_ID` set to
  the unpacked extension ID shown by Chrome.

## Smoke Test

- Popup shows `Companion: connected`.
- `Open app` opens the companion window.
- Copy text from a web page and confirm the item appears in the companion.
- Copy JSON from `fixtures/native-companion.html` and confirm native history
  stores it with `format: "json"`.
- Copy a companion history item back to the clipboard.
- Search filters companion history by text/source/domain.
- Smart preview works for JSON, SQL, JWT, timestamp, and Base64 samples.
- Pin, unpin, delete, and clear update the local JSON store correctly; after
  clear, `history` remains an empty array, not `null`.
- With the host removed, copy two fixture items, pin one, and delete the other.
  Restart Chrome with the same profile, reinstall the host, and confirm the
  pinned item reaches Companion while the deleted item does not.
- Remove the host again, clear local history, copy a new item, restart Chrome,
  and reinstall the host. Confirm the new item remains and no item older than
  the clear is resurrected.
- Confirm pending outbox status reaches zero only after Companion acknowledges
  every queued operation. The primary outbox is IndexedDB; legacy
  `copyHistorySyncOutbox` is only a migration/fallback path.
- Minimize restores via the configured global hotkey.
- App menu quit exits the companion process.
- Companion title bar, executable, and tray icons match the extension icon.
- Tray icon is visible while the companion is running.
- Tray left-click or double-click opens the companion when it is minimized.
- Tray context menu supports Show, Minimize, and Quit.
- `npm run native:test-tray` verifies Shell tray registration and tray actions
  with real mouse/UI Automation calls when input injection is available.
  Restricted desktop sessions use Win32 message injection after checking the
  real icon rectangle and menu labels. Still do one visual notification-area
  pass when the fallback path is reported or Windows hides the icon in overflow.
- Toggle auto-start on and off; verify the
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CopyTextCompanion`
  value is restored to its original state after the test.

## Fallback

- Run `npm run native:uninstall-host`.
- Reload the unpacked extension and confirm the popup shows
  `Companion: local mode`.
- Copy from the fixture again and confirm extension local history still works.
- Confirm pending outbox operations remain queued while the host is unavailable
  instead of being discarded. In current Chrome this queue is IndexedDB-backed;
  `chrome.storage.local` should only hold the local history cache and any
  legacy migration fallback.
- Reinstall the host with the unpacked extension ID before continuing connected
  smoke or leaving the developer machine in a ready state.

## Permission Disclosure

- `nativeMessaging` is used only to connect to the local Windows companion.
- Clipboard/history data is stored locally under `%APPDATA%\CopyTextWithoutSelecting`.
- The extension still works in local mode when the companion is absent.

## Uninstall

- Run `npm run native:uninstall-host`.
- Confirm the Chrome native host registry key is removed from
  `HKCU\Software\Google\Chrome\NativeMessagingHosts` and
  `HKCU\Software\Chromium\NativeMessagingHosts`.
- Confirm the Windows uninstall entry is removed from
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CopyTextWithoutSelectingCompanion`.
