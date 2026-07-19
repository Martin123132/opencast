import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
  type DesktopCapturerSource,
} from 'electron'
import { assertDDrivePath } from '../scripts/path-guards.js'
import { resolveFreePort } from '../server/runtime.js'

const desktopRoot = assertDDrivePath(
  process.env.SHAREFRAME_DESKTOP_ROOT ?? 'D:\\ShareFrame\\desktop',
  'ShareFrame desktop root',
)
const dataRoot = assertDDrivePath(
  process.env.OPENCAST_DATA_ROOT ?? 'D:\\ShareFrame\\data',
  'ShareFrame data root',
)
const runtimePaths = {
  cache: path.join(desktopRoot, 'cache'),
  crashDumps: path.join(desktopRoot, 'crash-dumps'),
  downloads: 'D:\\ShareFrame\\downloads',
  logs: path.join(desktopRoot, 'logs'),
  sessionData: path.join(desktopRoot, 'session'),
  temp: 'D:\\ShareFrame\\temp',
  userData: path.join(desktopRoot, 'user-data'),
}

for (const runtimePath of Object.values(runtimePaths)) {
  mkdirSync(assertDDrivePath(runtimePath, 'ShareFrame runtime path'), { recursive: true })
}

Object.assign(process.env, {
  OPENCAST_DATA_ROOT: dataRoot,
  OPENCAST_HOST: '127.0.0.1',
  OPENCAST_OPEN_BROWSER: '0',
  TEMP: runtimePaths.temp,
  TMP: runtimePaths.temp,
})

app.setPath('userData', runtimePaths.userData)
app.setPath('sessionData', runtimePaths.sessionData)
app.setPath('temp', runtimePaths.temp)
app.setPath('crashDumps', runtimePaths.crashDumps)
app.setAppLogsPath(runtimePaths.logs)
app.commandLine.appendSwitch('user-data-dir', runtimePaths.userData)
app.commandLine.appendSwitch('disk-cache-dir', runtimePaths.cache)

let mainWindow: BrowserWindow | null = null
let activePicker: ActivePicker | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  registerPickerIpc()

  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(startDesktopApp).catch((error: unknown) => {
    process.stderr.write(`ShareFrame desktop startup failed: ${formatError(error)}\n`)
    app.exit(1)
  })
}

async function startDesktopApp() {
  const preferredPort = parsePort(process.env.OPENCAST_PORT, 4174)
  const selectedPort = await resolveFreePort('127.0.0.1', preferredPort)
  process.env.OPENCAST_PORT = String(selectedPort)
  const appUrl = `http://127.0.0.1:${selectedPort}/`

  await import('../server/index.js')
  await waitForHealth(`${appUrl}api/health`)

  configureDesktopSession(appUrl)
  mainWindow = createMainWindow(appUrl)
  await mainWindow.loadURL(appUrl)

  if (process.env.SHAREFRAME_DESKTOP_SMOKE === '1') {
    await writeSmokeResult(appUrl, mainWindow)
    mainWindow.destroy()
    app.exit(0)
    return
  }

  mainWindow.show()
  mainWindow.focus()
}

function configureDesktopSession(appUrl: string) {
  const trustedOrigin = new URL(appUrl).origin
  const desktopSession = session.defaultSession
  const allowedPermissions = new Set([
    'clipboard-sanitized-write',
    'display-capture',
    'fullscreen',
    'media',
  ])

  desktopSession.setDownloadPath(runtimePaths.downloads)
  desktopSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return allowedPermissions.has(permission) && isTrustedOrigin(requestingOrigin, trustedOrigin)
  })
  desktopSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestDetails = details as { requestingUrl?: string }
    const requestingUrl = requestDetails.requestingUrl ?? webContents.getURL()
    callback(allowedPermissions.has(permission) && isTrustedOrigin(requestingUrl, trustedOrigin))
  })
  desktopSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!request.userGesture || !isTrustedOrigin(request.securityOrigin, trustedOrigin)) {
      callback({})
      return
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 360, height: 220 },
      })
      const selectedId = await showSourcePicker(mainWindow, sources)
      const selectedSource = sources.find((source) => source.id === selectedId)

      if (!selectedSource) {
        callback({})
        return
      }

      callback({
        video: selectedSource,
        audio: request.audioRequested && process.platform === 'win32' ? 'loopbackWithMute' : undefined,
      })
    } catch (error) {
      process.stderr.write(`ShareFrame source picker failed: ${formatError(error)}\n`)
      callback({})
    }
  })
}

function createMainWindow(appUrl: string) {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#eef1f1',
    height: 920,
    icon: path.join(import.meta.dirname, 'shareframe.png'),
    minHeight: 700,
    minWidth: 1040,
    show: false,
    title: 'ShareFrame',
    width: 1480,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const trustedOrigin = new URL(appUrl).origin

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedOrigin(url, trustedOrigin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          parent: window,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }

    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedOrigin(url, trustedOrigin)) {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => {
    if (process.env.SHAREFRAME_DESKTOP_SMOKE !== '1') {
      window.show()
    }
  })
  window.on('closed', () => {
    mainWindow = null
  })

  return window
}

function showSourcePicker(parent: BrowserWindow | null, sources: DesktopCapturerSource[]) {
  activePicker?.finish(null)

  const pickerWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f5',
    height: 700,
    icon: path.join(import.meta.dirname, 'shareframe.png'),
    modal: Boolean(parent),
    parent: parent ?? undefined,
    resizable: true,
    show: false,
    title: 'Choose what to record',
    width: 1040,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, 'picker-preload.cjs'),
      sandbox: true,
    },
  })
  const sourceIds = new Set(sources.map((source) => source.id))

  pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pickerWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (sourceId: string | null) => {
      if (settled) {
        return
      }

      settled = true
      activePicker = null
      resolve(sourceId && sourceIds.has(sourceId) ? sourceId : null)

      if (!pickerWindow.isDestroyed()) {
        pickerWindow.close()
      }
    }

    activePicker = { finish, sourceIds, window: pickerWindow }
    pickerWindow.on('closed', () => finish(null))
    pickerWindow.webContents.once('did-finish-load', () => {
      pickerWindow.webContents.send(
        'shareframe:picker-sources',
        sources.map((source) => ({
          appIcon: source.appIcon?.toDataURL() ?? null,
          id: source.id,
          kind: source.id.startsWith('screen:') ? 'screen' : 'window',
          name: source.name,
          thumbnail: source.thumbnail.toDataURL(),
        })),
      )
      pickerWindow.show()
      pickerWindow.focus()
    })
    void pickerWindow.loadFile(path.join(import.meta.dirname, 'picker.html'))
  })
}

function registerPickerIpc() {
  ipcMain.on('shareframe:picker-select', (event, sourceId: unknown) => {
    if (
      !activePicker ||
      event.sender.id !== activePicker.window.webContents.id ||
      typeof sourceId !== 'string' ||
      !activePicker.sourceIds.has(sourceId)
    ) {
      return
    }

    activePicker.finish(sourceId)
  })
  ipcMain.on('shareframe:picker-cancel', (event) => {
    if (activePicker && event.sender.id === activePicker.window.webContents.id) {
      activePicker.finish(null)
    }
  })
}

async function waitForHealth(healthUrl: string) {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl)

      if (response.ok) {
        return
      }
    } catch {
      // The local API is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error('Timed out waiting for the private ShareFrame API.')
}

async function writeSmokeResult(appUrl: string, window: BrowserWindow) {
  const resultPath = assertDDrivePath(
    process.env.SHAREFRAME_DESKTOP_SMOKE_RESULT ??
      path.join(desktopRoot, 'desktop-smoke-result.json'),
    'Desktop smoke result',
  )
  const rendererState = await waitForRendererReady(window)

  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        appUrl,
        dataRoot,
        desktopRoot,
        mode: 'desktop',
        ok: true,
        runtimePaths,
        title: rendererState.title,
        uiReady: rendererState.uiReady,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function waitForRendererReady(window: BrowserWindow) {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const rendererState = (await window.webContents.executeJavaScript(`({
      title: document.title,
      uiReady: Boolean(document.querySelector('#root')?.childElementCount) &&
        document.body.innerText.includes('Ready Room')
    })`)) as { title: string; uiReady: boolean }

    if (rendererState.uiReady) {
      return rendererState
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error('ShareFrame desktop renderer did not reach the Ready Room.')
}

function isTrustedOrigin(candidate: string, trustedOrigin: string) {
  try {
    return new URL(candidate).origin === trustedOrigin
  } catch {
    return false
  }
}

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type ActivePicker = {
  finish: (sourceId: string | null) => void
  sourceIds: Set<string>
  window: BrowserWindow
}
