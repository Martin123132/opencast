# ShareFrame

ShareFrame is a local-first screen recorder and private sharing prototype. It records in the browser, stores uploads on a D-drive data root, and serves private share links from a local Fastify API.

## Current MVP

- Browser screen capture through `getDisplayMedia`
- Optional mic capture
- Optional camera overlay composited into the recording canvas
- WebM output through `MediaRecorder`
- Local library backed by `D:\open-source\opencast-data`
- Tokenized share links at `/s/:token`
- Range-enabled video streaming for playback

## D-Drive Storage Rule

The server defaults to:

```text
D:\open-source\opencast-data
```

It refuses to start if `OPENCAST_DATA_ROOT` resolves outside `D:\`.

Recommended shell environment for development:

```powershell
$env:TEMP="D:\open-source\.temp"
$env:TMP="D:\open-source\.temp"
$env:npm_config_cache="D:\open-source\.cache\npm"
$env:PNPM_HOME="D:\open-source\.cache\pnpm-home"
$env:COREPACK_HOME="D:\open-source\.cache\corepack"
$env:OPENCAST_DATA_ROOT="D:\open-source\opencast-data"
```

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

The API listens on `http://127.0.0.1:4174`. Vite starts on the first available local port, usually `http://127.0.0.1:5173/`.

## Checks

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run evidence:share-lifecycle
```

Shared privacy contract:

- [`SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md`](./SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md)

Keep this checklist in scope when touching share create/revoke/recreate behavior or guest access handling.

The browser E2E suite runs Edge against isolated local ports and writes its reports,
screenshots, traces, and test data under D-drive paths:

```text
D:\open-source\.temp\opencast-e2e
D:\open-source\opencast-e2e-data
```

Sharing behavior PR review checklist:

- [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)
- Use this checklist when changing sharing creation/revoke/recreate or guest flow logic.

Share lifecycle release review evidence:

- [`.github/SHARE_LIFECYCLE_RELEASE_REVIEW_TEMPLATE.md`](./.github/SHARE_LIFECYCLE_RELEASE_REVIEW_TEMPLATE.md)
- Use this for release-ready sharing changes and to record proof links/results in one place.

Share lifecycle evidence draft generator:

- `npm.cmd run evidence:share-lifecycle`
- Generates `.evidence/share-lifecycle-evidence-<timestamp>.md` (git-ignored) for sharing behavior release notes.
- Optional flags:
  - `--output <path>`: custom output directory
  - `--source-sha <sha>`: include source commit/branch
  - `--ci-url <url>`: CI run URL placeholder or value

## License

ShareFrame/opencast is source-available software, not open-source software.

Personal, hobby, research, educational, public-interest, and other non-commercial uses are permitted under the PolyForm Noncommercial License 1.0.0 in [`LICENSE`](./LICENSE).

Commercial use requires a separate written license from TWO HANDS NETWORK LTD. Contact the COO of TWO HANDS NETWORK LTD to discuss commercial licensing before using this code, its tests, documentation, data formats, or derived materials in a paid product, hosted service, managed service, enterprise product, commercial developer tool, commercial AI system, or commercial AI training/evaluation pipeline.
