# OpenCast

OpenCast is a local-first screen recorder and private sharing prototype. It records in the browser, stores uploads on a D-drive data root, and serves private share links from a local Fastify API.

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
npm.cmd run build
```
