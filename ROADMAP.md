# ShareFrame Roadmap

ShareFrame aims to be a local-first, source-available screen recorder and private sharing tool that feels guided, fast, and forgiving.

## Product Loop

1. Setup: confirm capture support and D-drive storage.
2. Record: choose source, capture screen, pause, resume, stop, or cancel.
3. Review: preview the draft, rename it, save it, download it, or discard it.
4. Share: create private links with password, expiry, download, revoke, and guest-view controls.
5. Library: manage saved recordings without losing the path back to record or share.

## Near-Term Milestones

### 0.2 Guided Studio

- First-run readiness path.
- Countdown, pause, resume, cancel, and source status.
- Post-recording review state.
- Share dialog with privacy controls.
- D-drive storage tests and Windows CI.

### 0.3 Editing Basics

- Lossless trim workflow.
- Thumbnail generation.
- Chapter markers.
- Recording title and metadata polish.

### 0.4 Distribution

- Self-contained portable Windows build with D-drive defaults and smoke test.
- Native Electron window with guided capture-source picker and D-drive runtime state.
- NSIS installer with Start Menu/desktop shortcuts, uninstall entry, and app-store manifest.
- Friendly executable icon and Windows metadata.
- Local network sharing mode.
- Signed release artifacts.
- Import/export settings.

### 0.5 Contributor Standard

- Architecture notes.
- Accessibility pass.
- E2E browser smoke tests.
- Issue labels and branch protection.

## Non-Negotiables

- No runtime storage on C:.
- Private by default.
- Useful without a cloud account.
- Main path stays obvious; advanced controls stay close but quiet.
