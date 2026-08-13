# Free GitHub Release Checklist

This checklist prepares a free GitHub release without using or paying for the
Chrome Web Store. Do not publish until every required item passes.

## Release scope

- [ ] Confirm the release contains only the Chrome MV3 extension.
- [ ] Confirm no Companion, native host, project-operated cloud sync, telemetry, or installer is included.
- [ ] Review user-visible changes and choose the next semantic version.
- [ ] Update `package.json` and `manifest.json` to the same version.
- [ ] Update release notes from `docs/github-release-listing.md` as needed.

## Assets and documentation

- [ ] Confirm manifest icons exist at 16, 32, 48, and 128 pixels.
- [ ] Run `npm run icons:generate` after changing `assets/icon.svg`.
- [ ] Run `npm run screenshots:release` after UI changes.
- [ ] Inspect the full-page `docs/screenshots/popup.png` at full resolution.
- [ ] Inspect `docs/screenshots/options-general.png` and
      `docs/screenshots/options-history.png` for clipping, private data, and stale text.
- [ ] Review `INSTALL.md`, `PRIVACY.md`, `README.md`, and `LICENSE.txt`.
- [ ] Confirm the release description states that installation and updates are manual.

## Automated gate

```powershell
npm ci
npm audit
npm run verify:release
git diff --check
```

- [ ] Unit tests pass.
- [ ] Syntax and manifest checks pass.
- [ ] Chrome build succeeds.
- [ ] Playwright E2E tests pass.
- [ ] `dist\copy-text-with-alt-click-chrome-vX.Y.Z.zip` exists.
- [ ] `dist\SHA256SUMS.txt` exists and names the same zip.
- [ ] A second `npm run pack:chrome` produces the same zip SHA-256.

## Manual Chrome smoke

- [ ] Extract the zip to a clean permanent folder.
- [ ] Load that folder with **Load unpacked** in a clean Chrome profile.
- [ ] Copy plain text, a link, an input value, a textarea, a select value, and a table.
- [ ] Confirm hover preview, feedback toast, excluded domains, and safe editable mode.
- [ ] Confirm popup controls, recent history, re-copy, delete, and clear.
- [ ] Confirm options tabs, search/filter, language, analytics, and smart actions.
- [ ] Confirm `Alt+Shift+C` copies the hovered or focused target.
- [ ] Perform an in-place update over the same folder and select **Reload**.
- [ ] Confirm settings, excluded domains, and local history remain intact.

## Draft release only

- [ ] Create a GitHub release as **Draft** for the intended tag.
- [ ] Attach only the Chrome zip and `SHA256SUMS.txt`.
- [ ] Copy the reviewed release description and installation warning.
- [ ] Download both draft assets and independently verify the checksum.
- [ ] Confirm the draft is not marked published or latest.

## Publish gate

- [ ] GitHub Actions for the tagged commit pass.
- [ ] No open P0/P1/P2 finding remains.
- [ ] Manual Chrome smoke passes on the final downloaded artifact.
- [ ] Publish only after an explicit release instruction.

## Post-publish attestation

- [ ] Confirm **Release Artifact Attestation** passes for the published tag.
- [ ] Download the published Chrome zip and verify it with GitHub CLI:

  ```powershell
  gh attestation verify .\copy-text-with-alt-click-chrome-vX.Y.Z.zip --repo anhtahaylove/copy-text-without-selecting
  ```

- [ ] If the automatic release event did not run, dispatch the workflow
      manually with the exact published tag.
