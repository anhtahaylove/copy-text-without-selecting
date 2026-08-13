# Privacy Disclosure

Copy Text Without Selecting is a local-first Chrome extension. The project does
not operate a server and the extension does not include accounts, advertising,
telemetry, cloud history, or a desktop companion application.

## Data handled

- Text copied by the user, source URLs/hostnames, timestamps, and history action
  metadata are stored in `chrome.storage.local` for copy history.
- Usage counters shown in the local analytics view are stored in
  `chrome.storage.local`.
- Preferences and excluded domains are stored in `chrome.storage.sync`. Chrome
  may synchronize this settings data through the user's browser account when
  Chrome Sync is enabled. This synchronization is provided and controlled by
  Chrome, not by this project.
- Clipboard content is written only when the user invokes a copy action.

Apart from Chrome's optional settings synchronization described above, the
extension does not intentionally transmit copied text, browsing history,
settings, or analytics to the project maintainer or third-party services.

## Permissions

- `activeTab`: identify and act on the current tab when the user uses popup or
  keyboard-shortcut controls.
- `scripting`: register the extension's content script on supported web pages.
- `storage`: save preferences, excluded domains, local history, and local
  analytics.
- `clipboardWrite`: write the text selected by the user's copy action.
- `alarms`: perform periodic local history maintenance.
- `http://*/*` and `https://*/*`: make modifier-assisted copying available on
  ordinary websites. The extension does not use these permissions to send page
  content to an external service.

## Retention and deletion

Users control the history limit and can clear history or analytics from the
extension settings. Removing the extension lets Chrome remove its stored data.
Synced settings may remain subject to Chrome's own synchronization and account
retention behavior.

## Changes and questions

Material privacy changes will be documented in release notes and this file.
Questions can be opened at
<https://github.com/anhtahaylove/copy-text-without-selecting/issues>.
