# Copy Text with Alt-Click

Easy and fast copy tool for Chrome MV3.

## Features

- Copy text from page elements with a configurable modifier key
- Hover preview overlay while holding the modifier
- Smart copy formatting for links and images
- Domain blacklist that disables both preview and copy behavior
- Quick popup controls for the current site
- Full tabbed settings center for General, Sites, Feedback, Language, and History
- User-selectable UI language override with English and Vietnamese
- Copy history panel with quick re-copy and delete actions
- Search and filter controls for local copy history
- Local analytics dashboard for copy, shortcut, block, domain, and selection activity
- Keyboard shortcut mode for hovered or focused targets
- Safe mode to skip rich-text editors and editable app surfaces
- Developer smart actions for JSON, SQL, JWT, timestamps, case transforms, and Base64

## Download

- [Chrome Web Store](https://chrome.google.com/webstore/detail/copy-text-with-alt-click/obhagoegpnbklgknnmbglghkfdidegkl?authuser=0&hl=en "Copy text with Alt-Click - Chrome Web Store")

## Description

Install the extension, hold the configured modifier key, and click the target text.

The clicked text is copied immediately without manual selection in the common case.

## Architecture

- `src/background/` contains the MV3 startup, registration, shortcut, and local history-maintenance source modules
- `src/content/` contains content-script source for hover preview, extraction, copy behavior, history, and analytics
- `src/popup/` contains quick-control popup source modules
- `src/options/` contains settings and history-management source modules
- `src/shared/` contains shared settings, history, analytics, i18n, and runtime-safe Chrome API helpers
- `dist/chrome/` is the generated unpacked extension artifact

## Settings

- **Copy modifier**: `Alt`, `Ctrl`, or `Shift`
- **Hover preview**: toggles the dashed target overlay
- **Skip editable apps**: avoids contenteditable editors and rich text surfaces
- **Feedback duration**: controls how long copy feedback remains visible
- **Excluded domains**: one hostname per line, matched against the host and its subdomains
- **Extension language**: `Auto`, `English`, or `Vietnamese`
- **Copy history size**: controls how many recent copied items remain available
- **History search/filter**: filter by source, mode, and domain from the options page
- **Local analytics**: summary cards and top domains, stored locally only
- **Keyboard shortcut mode**: lets browser shortcuts trigger copy without requiring a click

## Development Target

- The repository is maintained for **Chrome MV3**
- `manifest.json` is the only supported shipping manifest
- Authored JavaScript source lives under `src/`
- Load unpacked from `dist/chrome/`, not from the repository root

## Development

Run the fast contract checks:

```bash
npm run validate
```

Run the browser automation smoke suite:

```bash
npm run test:e2e
```

Create a release zip:

```bash
npm run pack:chrome
```

## Manual Test Fixtures

The repo includes fixture pages and a checklist for manual browser verification:

- `fixtures/basic-copy.html`
- `fixtures/editable-surfaces.html`
- `fixtures/keyboard-shortcut.html`
- `fixtures/selection-copy.html`
- `fixtures/table-copy.html`
- `docs/browser-manual-test-checklist.md`

Serve the fixtures over HTTP before testing:

```bash
python -m http.server 4173
```

The build output is written to `dist/chrome/` and the packaged archive is written to `dist/`.

![Screenshot](https://addons.mozilla.org/user-media/previews/full/193/193185.png?modified=1622132342)

( Icon designed by: [Mouse Runner.com](http://www.mouserunner.com/ "Mouse Runner.com, Good Content, Free Resources") )
