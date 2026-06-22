import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const e2eDataRoot = process.env.OPENCAST_E2E_DATA_ROOT ?? 'D:\\open-source\\opencast-e2e-data'
const screenshotRoot = path.join(
  process.env.OPENCAST_E2E_ARTIFACTS ?? 'D:\\open-source\\.temp\\opencast-e2e',
  'screenshots',
)

async function installRecorderStub(page: Page) {
  await page.addInitScript(() => {
    const mediaDevices = window.navigator.mediaDevices as
      & MediaDevices
      & {
        getDisplayMedia: (...args: unknown[]) => Promise<MediaStream>
        getUserMedia: (...args: unknown[]) => Promise<MediaStream>
      }

    const createDisplayStream = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const context = canvas.getContext('2d')
      const captureStream = canvas.captureStream(30)
      const tracks = captureStream.getVideoTracks()
      const stream = new MediaStream()

      for (const track of tracks) {
        stream.addTrack(track)
      }

      let tick = 0

      const render = () => {
        if (context) {
          context.fillStyle = `hsl(${tick % 360}, 75%, 12%)`
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = 'rgba(255, 255, 255, 0.9)'
          context.fillText(`${tick}`, 24, 40)
          tick += 1
        }

        window.requestAnimationFrame(render)
      }

      render()
      return stream
    }

    mediaDevices.getDisplayMedia = async () => createDisplayStream()
    mediaDevices.getUserMedia = async () => new MediaStream()
  })
}

test.beforeEach(async ({ request }) => {
  await resetE2eData()
  await deleteRecordings(request)
})

test('loads config and advances from setup into the recorder path', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)

  await page.goto('/')
  await expect(page).toHaveTitle(/ShareFrame/)
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByText('Capture ready')).toBeVisible()
  await expect(page.getByText('D:\\open-source\\opencast-e2e-data')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await expect(page.getByText('Your path: Setup, Record, Save, Share.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Complete room setup' })).toBeVisible()
  await expect(page.getByText('Set up room')).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Confirm the room')).toBeVisible()

  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  await expect(page.getByText('Start recording')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Choose what to capture')).toBeVisible()
  await expect(page.getByText('No recordings yet')).toBeVisible()

  await saveSmokeScreenshot(page, 'setup-transition.png')
  expect(consoleMessages()).toEqual([])
})

test('guides first-run onboarding from setup to first saved recording and share', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const firstRunTitle = 'First run take'
  await createRecording(request, firstRunTitle)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh' }).click()

  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByRole('button', { name: firstRunTitle })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Manage the archive')).toBeVisible()
  await expect(page.getByText('Your path: Setup, Record, Save, Share.')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Complete room setup' }),
  ).toBeHidden()

  const selected = page.getByLabel('Selected recording')
  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(selected).toBeVisible()
  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()

  await saveSmokeScreenshot(page, 'first-run-share-flow.png')
  expect(consoleMessages()).toEqual([])
})

test('guides first-run from record draft to save then share', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)
  await installRecorderStub(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Save this draft')).toBeVisible()

  const draftTitle = 'Unsaved flow draft'
  await page.getByRole('textbox', { name: 'Title' }).fill(draftTitle)
  await page.getByLabel('Review recording').getByRole('button', { name: 'Save' }).click()

  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('Saved. Share link ready when you are.')).toBeVisible()
  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByLabel('Current guidance').getByText('Lock the link')).toBeVisible()
  await expect(page.getByRole('button', { name: draftTitle })).toBeVisible()

  const selected = page.getByLabel('Selected recording')
  await expect(selected).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  const copyButton = shareDialog.getByRole('button', { name: 'Copy link' })
  await expect(copyButton).toBeVisible()
  await copyButton.click()
  await expect(shareDialog.getByText('Share link copied.')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(shareDialog).toBeHidden()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expect(page.getByRole('button', { name: draftTitle })).toBeVisible()

  await saveSmokeScreenshot(page, 'first-run-record-draft-to-share.png')
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

  const selected = page.getByLabel('Selected recording')
  await expect(page.getByRole('button', { name: /Golden path fixture/ })).toBeVisible()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expect(selected.getByRole('textbox', { name: 'Recording title' })).toHaveValue(
    'Golden path fixture',
  )
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeDisabled()

  const renamedTitle = 'Golden path fixture renamed'
  const titleInput = selected.getByRole('textbox', { name: 'Recording title' })
  await titleInput.fill(renamedTitle)
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await titleInput.press('Enter')
  await expect(page.getByRole('button', { name: renamedTitle })).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeDisabled()

  await page.getByRole('button', { name: 'Share' }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await page.getByRole('button', { name: 'Create link' }).click()
  await expect(page.getByText('/s/')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View as guest' })).toBeVisible()

  await saveSmokeScreenshot(page, 'share-modal.png')
  expect(recording.id).toBeTruthy()
  expect(consoleMessages()).toEqual([])
})

test('revokes a shared link, blocks old guest links, and recreates', async ({ page, request }) => {
  const recording = await createRecording(request, 'Revoke lifecycle fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  await selected.getByRole('button', { name: 'Share' }).click()

  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  const guestHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(guestHref).toContain('/s/')

  await shareDialog.getByRole('button', { name: 'Revoke' }).click()
  await expect(shareDialog.getByText('Share link revoked.')).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await expect(shareDialog.getByRole('link', { name: 'View as guest' })).toBeHidden()

  await page.goto(guestHref!)
  await expect(page.getByText('This share link is unavailable.')).toBeVisible()

  await page.goto('/')
  await expect(selected.getByRole('button', { name: 'Share' })).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Unshare' })).toBeHidden()
  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog.getByRole('button', { name: 'Create link' })).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()

  const recreatedHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(recreatedHref).toBeTruthy()
  expect(recreatedHref).not.toBe(guestHref)

  await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(shareDialog).toBeHidden()
  await expect(selected.getByRole('button', { name: 'Unshare' })).toBeVisible()
  await selected.getByRole('button', { name: 'Unshare' }).click()
  await expect(page.getByText('Share link revoked.')).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Unshare' })).toBeHidden()

  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog.getByRole('button', { name: 'Create link' })).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()

  const reupdatedHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')

  await shareDialog.getByRole('button', { name: 'Update link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  const postUpdateHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(postUpdateHref).toBe(reupdatedHref)
  await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(shareDialog).toBeHidden()
  expect(postUpdateHref).toBeTruthy()
  await page.goto(postUpdateHref!)
  await expect(page.locator('.shared-video')).toBeVisible()
  await expect(page.getByText('This share link is unavailable.')).toBeHidden()
  await expect(page.getByText('This share link is no longer available.')).toBeHidden()

  await page.goto('/')
  await saveSmokeScreenshot(page, 'share-revoke-lifecycle.png')
  expect(recording.id).toBeTruthy()
})

test('confirms delete explicitly and keeps keyboard rename flow for library recording', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)

  await createRecording(request, 'Delete fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  const titleInput = selected.getByRole('textbox', { name: 'Recording title' })
  const renameButton = selected.getByRole('button', { name: 'Rename' })
  const deleteButton = selected.getByRole('button', { name: 'Delete' })
  const keepButton = selected.getByRole('button', { name: 'Keep' })

  await expect(titleInput).toHaveValue('Delete fixture')
  await titleInput.fill('Delete fixture renamed')
  await expect(renameButton).toBeEnabled()
  await titleInput.press('Enter')
  await expect(page.getByRole('button', { name: 'Delete fixture renamed' })).toBeVisible()

  await deleteButton.click()
  await expect(selected.getByText('Delete this recording permanently?')).toBeVisible()
  await expect(keepButton).toBeVisible()
  await keepButton.click()
  await expect(selected.getByRole('button', { name: 'Delete' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Delete fixture renamed/ })).toBeVisible()

  await selected.getByRole('button', { name: 'Delete' }).click()
  await selected.getByRole('button', { name: 'Confirm delete' }).click()
  const undoButton = page.getByRole('button', { name: 'Undo' })
  await expect(undoButton).toBeVisible()
  await expect(undoButton).toBeEnabled()

  await undoButton.click()
  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Delete fixture renamed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden()
  await expect(selected.getByRole('button', { name: 'Delete' })).toBeVisible()

  await selected.getByRole('button', { name: 'Delete' }).click()
  await selected.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(undoButton).toBeVisible()
  await page.waitForTimeout(4200)
  await expect(page.getByText('No recordings yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()
  await expect(undoButton).toBeHidden()

  await saveSmokeScreenshot(page, 'library-delete-confirmation.png')
  expect(consoleMessages()).toEqual([])
})

test('keeps the guided path usable on a mobile viewport', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await createRecording(request, 'Mobile fixture')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByLabel('Workflow').getByText('Browser OK')).toBeVisible()
  await expect(page.getByLabel('Workflow').getByText('D:')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Confirm the room')).toBeVisible()

  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Manage the archive')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const mobileFixtureRow = page.getByRole('button', { name: /Mobile fixture/ })
  await mobileFixtureRow.scrollIntoViewIfNeeded()
  await expect(mobileFixtureRow).toBeVisible()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const mobileShareButton = page.getByRole('button', { name: 'Share' })
  await mobileShareButton.scrollIntoViewIfNeeded()
  await expect(mobileShareButton).toBeVisible()
  await mobileShareButton.click()

  const mobileShareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(mobileShareDialog).toBeVisible()
  await expect(mobileShareDialog.getByText('No shared link yet')).toBeVisible()
  await mobileShareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(mobileShareDialog.getByText('/s/')).toBeVisible()
  await expect(mobileShareDialog.getByRole('button', { name: 'Copy link' })).toBeVisible()
  const guestLink = mobileShareDialog.getByRole('link', { name: 'View as guest' })
  await expect(guestLink).toBeVisible()
  const guestHref = await guestLink.getAttribute('href')
  expect(guestHref).toContain('/s/')
  await expectNoHorizontalOverflow(page)

  await saveSmokeScreenshot(page, 'mobile-share-modal.png')

  await page.goto(guestHref!)
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByText('Shared recording')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mobile fixture' })).toBeVisible()
  await expect(page.locator('video.shared-video')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await saveSmokeScreenshot(page, 'mobile-guest-share.png')
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

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))

  expect(Math.max(dimensions.bodyScrollWidth, dimensions.documentScrollWidth)).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  )
}
