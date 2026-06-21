import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const e2eDataRoot = process.env.OPENCAST_E2E_DATA_ROOT ?? 'D:\\open-source\\opencast-e2e-data'
const screenshotRoot = path.join(
  process.env.OPENCAST_E2E_ARTIFACTS ?? 'D:\\open-source\\.temp\\opencast-e2e',
  'screenshots',
)

test.beforeEach(async ({ request }) => {
  await resetE2eData()
  await deleteRecordings(request)
})

test('loads config and advances from setup into the recorder path', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)

  await page.goto('/')
  await expect(page).toHaveTitle(/OpenCast/)
  await expect(page.getByRole('heading', { name: 'OpenCast' })).toBeVisible()
  await expect(page.getByText('Capture ready')).toBeVisible()
  await expect(page.getByText('D:\\open-source\\opencast-e2e-data')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()

  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
  await expect(page.getByText('Start recording')).toBeVisible()
  await expect(page.getByText('No recordings yet')).toBeVisible()

  await saveSmokeScreenshot(page, 'setup-transition.png')
  expect(consoleMessages()).toEqual([])
})

test('shows library recordings, validates rename, and opens the share modal', async ({
  page,
  request,
}) => {
  const consoleMessages = collectConsoleIssues(page)
  const recording = await createRecording(request, 'Golden path fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('button', { name: /Golden path fixture/ })).toBeVisible()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Recording title' })).toHaveValue(
    'Golden path fixture',
  )
  await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled()

  await page.getByRole('textbox', { name: 'Recording title' }).fill('Golden path fixture renamed')
  await expect(page.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('button', { name: /Golden path fixture renamed/ })).toBeVisible()

  await page.getByRole('button', { name: 'Share' }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('Private')).toBeVisible()
  await page.getByRole('button', { name: 'Create link' }).click()
  await expect(page.getByText('/s/')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View as guest' })).toBeVisible()

  await saveSmokeScreenshot(page, 'share-modal.png')
  expect(recording.id).toBeTruthy()
  expect(consoleMessages()).toEqual([])
})

async function resetE2eData() {
  await rm(e2eDataRoot, { force: true, recursive: true })
  await mkdir(e2eDataRoot, { recursive: true })
}

async function deleteRecordings(request: APIRequestContext) {
  const response = await request.get('/api/recordings')

  if (!response.ok()) {
    return
  }

  const body = (await response.json()) as { recordings?: Array<{ id: string }> }

  for (const recording of body.recordings ?? []) {
    await request.delete(`/api/recordings/${recording.id}`)
  }
}

async function createRecording(request: APIRequestContext, title: string) {
  const response = await request.post('/api/recordings', {
    multipart: {
      title,
      durationMs: '2000',
      video: {
        name: 'fixture.webm',
        mimeType: 'video/webm',
        buffer: Buffer.from('OpenCast E2E fixture'),
      },
    },
  })

  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { recording: { id: string; title: string } }
  return body.recording
}

function collectConsoleIssues(page: Page) {
  const messages: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`)
    }
  })

  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`)
  })

  return () => messages
}

async function saveSmokeScreenshot(page: Page, name: string) {
  await mkdir(screenshotRoot, { recursive: true })
  await page.screenshot({ path: path.join(screenshotRoot, name), fullPage: false })
}
