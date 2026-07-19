# ShareFrame App-Store Package

`npm.cmd run package:desktop` generates a public-safe manifest next to the Windows
installer:

```text
D:\open-source\opencast\release\desktop\ShareFrame-<version>-win-x64.app.json
```

The manifest is intended as the stable hand-off between ShareFrame and a catalogue or
app-store service. `schemaVersion` is incremented only for incompatible changes.

## Installer Contract

- `id`: stable application identifier, `uk.co.twohandsnetwork.shareframe`.
- `version`: package version from `package.json`.
- `architecture`: currently `x64`.
- `installer.file`: NSIS installer filename in the same release directory.
- `installer.sha256`: SHA-256 of that exact installer.
- `installer.sizeBytes`: exact installer size.
- `installer.silentArguments`: unattended installation argument for an app-store client.
- `installer.defaultInstallLocation`: `D:\ShareFrame\App`.
- `runtime`: D-drive roots used for recordings, desktop state, and temporary files.
- `license`: public source-available/commercial-use posture and licensing contact.
- `source`: commit and dirty-worktree evidence for the build.

The installer is current-user scoped, creates normal Windows shortcuts and an uninstall
entry, and preserves the recording library during uninstall. Development manifests use
the `development` channel. Do not promote a manifest to a release channel until its
installer is signed and the manual desktop capture checklist has passed.
