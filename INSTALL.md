# Install Copy Text Without Selecting

The extension is distributed free through GitHub Releases. It is not published
to the Chrome Web Store, so Chrome must load it as an unpacked extension.

## First install

1. Download the Chrome zip and `SHA256SUMS.txt` from the latest GitHub release.
2. Verify the zip checksum:

   ```powershell
   Get-FileHash .\copy-text-with-alt-click-chrome-vX.Y.Z.zip -Algorithm SHA256
   ```

   The result must match the hash in `SHA256SUMS.txt`.
3. If GitHub CLI is installed, also verify the GitHub artifact attestation:

   ```powershell
   gh attestation verify .\copy-text-with-alt-click-chrome-vX.Y.Z.zip --repo anhtahaylove/copy-text-without-selecting
   ```

   This confirms that the published zip matches the checksum-verified artifact
   attested by this repository's GitHub Actions workflow.
4. Extract the zip to a permanent folder that will not be moved or deleted.
5. Open `chrome://extensions` in Chrome.
6. Enable **Developer mode**.
7. Select **Load unpacked** and choose the extracted folder containing
   `manifest.json`.

Chrome may periodically show a developer-mode warning because the extension is
installed outside the Chrome Web Store.

## Update without losing local data

1. Download and verify the new release.
2. Close the extension popup and options page.
3. Remove the old extension files inside the permanent folder without deleting
   the folder itself, then extract the new release into that same folder. Do not
   load the new version from a different path.
4. Open `chrome://extensions` and select **Reload** for Copy Text Without Selecting.
5. Confirm the displayed version, settings, excluded sites, and recent history.

Keeping the same folder path preserves the unpacked extension identity used by
the current Chrome profile. Removing the extension before updating may remove
its local history and analytics.

## Uninstall

Open `chrome://extensions`, find Copy Text Without Selecting, and select
**Remove**. Chrome controls deletion of the extension's stored data.

## Source and support

- Source: <https://github.com/anhtahaylove/copy-text-without-selecting>
- Releases: <https://github.com/anhtahaylove/copy-text-without-selecting/releases>
- Issues: <https://github.com/anhtahaylove/copy-text-without-selecting/issues>
