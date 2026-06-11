# Copy Text Companion

Windows-first native companion for `copy-text-without-selecting`.

This directory contains the Windows-first native companion MVP. It speaks the
Chrome Native Messaging protocol over stdio, runs a Wails desktop UI in normal
mode, and persists clipboard history to
`%APPDATA%\CopyTextWithoutSelecting\history.json`.

## Modes

- `copy-text-companion.exe --native-messaging`: launched by Chrome through the
  registered native messaging host manifest.
- `copy-text-companion.exe`: Wails desktop history manager.

## Protocol

Requests use this envelope:

```json
{ "id": "uuid", "version": 1, "type": "PING", "payload": {} }
```

Responses use this envelope:

```json
{ "id": "uuid", "ok": true, "payload": {} }
```

Implemented message types:

- `PING`
- `CLIPBOARD_EVENT`
- `HISTORY_LIST`
- `HISTORY_DELETE`
- `HISTORY_CLEAR`
- `HISTORY_PIN`
- `FORMAT_PREVIEW`
- `SETTINGS_GET`
- `SETTINGS_UPDATE`
- `OPEN_APP`
- `PRIVACY_GET`

## History Synchronization

The Companion JSON store is the source of truth while the native host is
connected. The extension keeps its own local history as an offline fallback
and stores native mutations in an IndexedDB outbox before sending them. Existing
legacy `copyHistorySyncOutbox` entries are migrated into IndexedDB
non-destructively on first use, and `chrome.storage.local` remains only a small
history cache plus a fallback if IndexedDB is unavailable. Pending operations
survive extension service-worker and browser restarts and are flushed FIFO after
reconnect.

- `CLIPBOARD_EVENT` is an idempotent upsert because Companion IDs are derived
  from copied text.
- Extension-local IDs may differ from Companion IDs. Delete and pin requests
  therefore include text; Companion tries the supplied ID first and falls back
  to the text-derived ID.
- Pin, unpin, delete, and later upserts carry `operationAt` timestamps.
  Companion schema v3 stores `updatedAt`, `pinUpdatedAt`, `clearedAt`, and
  delete tombstones so older cross-writer mutations cannot override newer ones.
- Clear discards all older pending operations in the extension. Companion clear
  removes only entries older than the clear operation, so items created after a
  clear are preserved and stale upserts are not resurrected.
- A failed native response leaves the operation in the outbox for retry.

## Build

From the repository root:

```powershell
npm run native:build
```

Register the Chrome native messaging host for the current user:

```powershell
npm run native:install-host
```

For unpacked Chrome testing, include the unpacked extension ID:

```powershell
$env:COPY_TEXT_DEV_EXTENSION_ID="your_unpacked_extension_id"
npm run native:install-host
```

Remove the registration:

```powershell
npm run native:uninstall-host
```

The install script copies the built executable under `%LOCALAPPDATA%`, writes
the host manifest under `%LOCALAPPDATA%`, and registers it under
the current user's Google Chrome and Chromium native-messaging registry keys.

## Notes

- Wails v2 menu accelerators are wired for show/hide/quit. Windows global
  hotkey registration is enabled from the local hotkey setting at startup.
- Windows tray support is implemented with direct Win32 `Shell_NotifyIconW`
  calls because Wails v2.12 does not expose a stable public tray option on
  `options.App`. The tray icon reuses the embedded companion app icon and
  provides Show, Minimize, and Quit actions.
- The companion has no cloud sync, telemetry, or network transport.
