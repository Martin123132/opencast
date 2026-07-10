# Manual QA Checklist

Use this public-safe checklist for human-only capture flows that automated browser tests cannot fully prove. Keep notes free of credentials, private customer data, private URLs, and recording contents.

## Before Testing

- Confirm the app identifies itself as ShareFrame.
- Confirm the visible data root and all screenshots/logs/evidence are on `D:\`.
- Confirm the licence posture is source-available for personal and non-commercial use, with commercial use requiring a written licence.
- Confirm test recordings use throwaway content only.

## Portable Windows Package

- Run `npm.cmd run package:windows` and confirm the build and packaged smoke test pass.
- Verify the generated folder, ZIP, checksum, runtime cache, and smoke-test data stay on `D:\`.
- Extract the ZIP to a fresh D-drive folder and double-click `ShareFrame.exe`.
- Confirm ShareFrame opens in the default browser without asking for Node.js, npm, an account, or an installation path.
- Confirm the packaged app reports `D:\ShareFrame\data` and creates no runtime output outside `D:\ShareFrame`.
- Close the ShareFrame console window and confirm the local app URL stops responding.
- Record whether Windows identifies the development build as unsigned; do not treat it as a signed release candidate.

## Browser Capture

- Open the app in a current desktop browser.
- Start from the first-run Ready Room and complete setup.
- Press Record and confirm the browser capture permission prompt appears.
- Approve a screen or window and confirm countdown, visible timer/status, Pause, Stop, and Cancel controls are reachable.
- Cancel the picker and confirm the app returns to a safe setup state without saving a draft.
- Deny permission and confirm the app shows a safe recovery path without saving a draft.

## Inputs

- Toggle mic off and on before capture and confirm the preflight/status copy changes.
- Toggle camera off and on before capture and confirm the preflight/status copy changes.
- Record with mic off and camera off.
- Record with mic on and camera on when local hardware is available.

## Draft And Library

- Pause, resume, then stop a recording and confirm the review draft is unsaved.
- Save the draft and confirm it appears in the library.
- Rename the saved recording and confirm keyboard submit still works.
- Delete a recording, use Undo, then delete again and let the undo expire.

## Sharing And Privacy

- Create a guest link and confirm the guest page plays the current recording.
- Copy the guest link and confirm the fallback copy guidance is readable if clipboard access is blocked.
- Revoke the guest link and confirm the old guest URL shows only non-leaky unavailable copy.
- Recreate a guest link and confirm the new link works while the old link stays unavailable.
- Test password, expiry, and playback-only settings on a throwaway recording.
- Enter wrong share passwords repeatedly and confirm the temporary rate-limit copy stays non-leaky.

## Evidence

- Date:
- Tester:
- Browser and version:
- OS:
- Commit SHA:
- Local commands run:
- GitHub CI URL:
- Notes:
