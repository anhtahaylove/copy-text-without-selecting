# Copy Text with Alt-Click

Easy and fast copy tool.

## Features

- Copy text from page elements with a configurable modifier key
- Hover preview overlay while holding the modifier
- Smart copy formatting for links and images
- Domain blacklist that disables both preview and copy behavior
- Quick popup controls for the current site
- Full tabbed settings center for General, Sites, Feedback, Language, and History
- User-selectable UI language override with English and Vietnamese
- Copy history panel with quick re-copy, pin, and delete actions
- Search and filter controls for local copy history
- Local analytics dashboard for copy, shortcut, block, domain, and selection activity
- Keyboard shortcut mode for hovered or focused targets
- Safe mode to skip rich-text editors and editable app surfaces

## Download

- [Chrome Web Store](https://chrome.google.com/webstore/detail/copy-text-with-alt-click/obhagoegpnbklgknnmbglghkfdidegkl?authuser=0&hl=en "Copy text with Alt-Click - Chrome Web Store")

## Description

If you install this extension, you do not need to select text first.
Just hold the configured modifier and click the target text.

The clicked text is copied immediately.

## How It Works

- `background.js` manages MV3 startup, content-script registration, shortcut handling, and storage cleanup
- `menu.js` handles hover preview, extraction, copy behavior, history, analytics, and runtime invalidation safety in page context
- `popup.html` / `popup.js` provide quick controls for the current site and the most common settings
- `options.html` / `options.js` expose the full tabbed settings and history management UI
- `shared.js` contains shared settings, history, analytics, and runtime-safe Chrome API helpers
- Local history and analytics are stored in `chrome.storage.local`

## Settings

- **Copy modifier**: `Alt`, `Ctrl`, or `Shift`
- **Hover preview**: toggles the dashed target overlay
- **Skip editable apps**: avoids contenteditable editors and rich text surfaces
- **Feedback duration**: controls how long copy feedback remains visible
- **Excluded domains**: one hostname per line, matched against the host and its subdomains
- **Extension language**: `Auto`, `English`, or `Tiếng Việt`
- **Copy history size**: controls how many recent copied items remain available
- **History search/filter**: filter by source, mode, and domain from the options page
- **Local analytics**: summary cards and top domains, stored locally only
- **Keyboard shortcut mode**: lets browser shortcuts trigger copy without requiring a click

## Test Fixtures

The repo includes browser fixtures and a manual checklist:

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

## Development Target

- The repository is maintained for **Chrome MV3**
- `manifest.json` is the only supported shipping manifest

## Development

Run the repository checks with Node.js:

```bash
npm run validate
```

Create a release zip:

```bash
npm run pack:chrome
```

The build output is written to `dist/chrome/` and the packaged archive is written to `dist/`.

![Screenshot](https://addons.mozilla.org/user-media/previews/full/193/193185.png?modified=1622132342)

( Icon designed by: [Mouse Runner.com](http://www.mouserunner.com/ "Mouse Runner.com, Good Content, Free Resources") )
