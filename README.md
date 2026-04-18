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

* [Add-ons for Firefox](https://addons.mozilla.org/ja/firefox/addon/copy-text-without-selecting/ "Copy Text with Alt-Click :: Add-ons for Firefox")
* [Chrome Web Store](https://chrome.google.com/webstore/detail/copy-text-with-alt-click/obhagoegpnbklgknnmbglghkfdidegkl?authuser=0&hl=en "Copy text with Alt-Click - Chrome Web Store")

## Description

If you install this add-on, you do not need to select a text.
What is needed, just "Alt key & Click" on the text! That's all!

This alone, the text of the point you click will be copied.

## How It Works

- `background.js` dynamically registers the content script and respects excluded domains
- `menu.js` handles hover preview, smart extraction, copy, native-copy tracking, and visual feedback
- `popup.html` / `popup.js` provide quick controls for the current site and common settings
- `options.html` / `options.js` expose the full tabbed settings management experience
- `shared.js` contains reusable settings and hostname utilities shared by runtime, popup, options, and tests
- local history and analytics are stored in `chrome.storage.local`

## Settings

- **Copy modifier**: `Alt`, `Ctrl`, or `Shift`
- **Hover preview**: toggles the dashed target overlay
- **Skip editable apps**: avoids contenteditable editors and rich text surfaces
- **Feedback duration**: controls how long the copy feedback remains visible, with fully custom timing
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
- `docs/browser-manual-test-checklist.md`

Serve the fixtures over HTTP before testing:

```bash
python -m http.server 4173
```

## Development

Run the repository tests with Node.js:

```bash
npm test
```

The test suite uses the built-in `node:test` runner, so there are no external development dependencies to install.

![Screenshot](https://addons.mozilla.org/user-media/previews/full/193/193185.png?modified=1622132342)

( Icon designed by: [Mouse Runner.com](http://www.mouserunner.com/ "Mouse Runner.com, Good Content, Free Resources") )
