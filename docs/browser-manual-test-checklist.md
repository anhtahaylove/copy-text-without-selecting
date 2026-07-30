# Browser Manual Test Checklist

## Setup

1. Run `npm run validate`.
2. Load the extension unpacked in Chrome from this repository's `dist\chrome` directory.
3. Open `chrome://extensions/shortcuts` and confirm the extension commands are visible.
4. Serve the fixtures with a local HTTP server:

```bash
python -m http.server 4173
```

5. Open:
   - `http://localhost:4173/fixtures/basic-copy.html`
   - `http://localhost:4173/fixtures/editable-surfaces.html`
   - `http://localhost:4173/fixtures/keyboard-shortcut.html`
   - `http://localhost:4173/fixtures/selection-copy.html`
   - `http://localhost:4173/fixtures/table-copy.html`

## Options Page

- [ ] Tabs switch correctly: General, Sites, Feedback, Language, History
- [ ] `Feedback duration` slider and number input stay synchronized
- [ ] `Feedback duration` accepts custom values outside the old preset-only flow
- [ ] `Extension language` switches between Auto, English, and Tiếng Việt
- [ ] Excluded domains can be added one-by-one
- [ ] Bulk domain apply updates the rendered domain list
- [ ] Domain remove action works
- [ ] Copy history limit saves correctly
- [ ] Search history finds entries by text and hostname
- [ ] Source filter works for click / shortcut / history replay
- [ ] Mode filter works for copy
- [ ] Domain filter is populated from stored history hosts
- [ ] Analytics cards update after new copy actions
- [ ] Reset analytics clears summary metrics
- [ ] Clear history button removes all history rows

## Popup

- [ ] Popup shows current hostname for normal websites
- [ ] Popup shows unsupported state on non-scriptable pages
- [ ] Toggle current site excludes/includes the active domain
- [ ] Popup recent history list renders entries after copying
- [ ] `Copy again` re-copies a history item
- [ ] Popup status text confirms successful actions

## Basic Copy

- Automated by Playwright: plain paragraph, link Markdown, input, textarea, and select copy flows.
- [ ] Plain paragraph copies visible text
- [ ] Native `Ctrl+C` / browser copy on selected text creates a history item with native source
- [ ] Link copies as Markdown `[text](href)`
- [ ] Image copies `src` or `alt`
- [ ] Input copies `value`
- [ ] Textarea copies multiline value
- [ ] Select copies selected option text
- [ ] Copy feedback highlight appears
- [ ] Floating feedback toast appears and respects the configured duration

## Selection-first

- Automated by Playwright: selected paragraph text wins over the broad target.
- [ ] Selecting part of a paragraph copies only the selected text
- [ ] Selecting part of a link copies only the selected text, not the whole link container
- [ ] Selecting part of a code block ignores decorative line-number UI
- [ ] Hover preview hugs the selection/deep target rather than a broad parent container
- [ ] Selection in editable surfaces is skipped when safe mode is enabled

## Table TSV

- Automated by Playwright: table TSV export excludes hidden cells and preserves tab separators in history.
- [ ] Clicking inside a table without a text selection exports the whole table as TSV
- [ ] Hidden cells are excluded from TSV output
- [ ] Multiline content inside a cell is normalized into spreadsheet-friendly text

## Hover Preview

- [ ] Holding the configured modifier shows preview overlay
- [ ] Releasing the modifier hides preview instantly
- [ ] Scroll and resize keep the preview aligned
- [ ] Excluded domains suppress hover preview

## Safe Mode / Editable Surfaces

- [ ] With `Skip editable apps` enabled, contenteditable areas do not preview or copy
- [ ] With `Skip editable apps` disabled, contenteditable areas can be targeted
- [ ] Regular text outside editable surfaces still works in both modes

## Keyboard Shortcut Mode

- Automated by Playwright: shortcut message path copies the hovered fixture target.
- [ ] Shortcut copies hovered target without clicking
- [ ] Shortcut copies focused element when nothing is hovered
- [ ] Disabling keyboard shortcut mode in settings suppresses command behavior

## Reload / Update

- Automated by Playwright: extension reload + page refresh still copies and does not spam `Extension context invalidated`.
- [ ] In the existing Chrome profile, click **Reload** on the unpacked extension without removing it first
- [ ] Existing settings, excluded domains, and local history remain intact after the in-place reload
- [ ] Reloading the extension does not cause repeated `Extension context invalidated` console spam on refreshed pages
- [ ] After extension reload + page refresh, copy still works on all fixture pages
- [ ] Popup, history, and shortcut behavior still work after extension reload

## History

- [ ] New copy actions create local history entries
- [ ] Native copy actions are labeled as native source
- [ ] History respects the configured item limit
- [ ] Shortcut-triggered copies are labeled as shortcut source
- [ ] History replay actions are labeled as history source
- [ ] Clearing history empties both popup and options history views
- [ ] History replay actions also refresh analytics

## Excluded Domains

- Automated by Playwright: excluding the fixture host blocks copy.
- [ ] Excluding `localhost` (or another test host) disables both preview and copy
- [ ] Including the host again restores normal behavior
- [ ] Subdomain matching works as expected for excluded roots

## Language

- [ ] English override updates popup and options strings
- [ ] Vietnamese override updates popup and options strings
- [ ] Auto mode falls back cleanly without broken labels

## Analytics

- [ ] Total actions increases after normal copies
- [ ] Native copies increases after selected-text `Ctrl+C`
- [ ] Selection-first copies increases after selection-priority copy flows
- [ ] Shortcut usage increases after shortcut copy
- [ ] Blocked attempts increases after excluded-domain or editable-surface blocks
- [ ] Toast events increases after copy/status feedback is shown
- [ ] Top domains list reflects the busiest hosts
